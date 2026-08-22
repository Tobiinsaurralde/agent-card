import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fmt } from "../policy.js";
import { AgentCardService, ServiceError } from "../service.js";
import type { CardStatus, Receipt, Treasury } from "../service.js";

/**
 * La cara MCP del servicio.
 *
 * Lo que define este archivo no es lo que expone sino lo que **no** expone.
 * Falta a propósito:
 *
 * - `deposit`: un agente que se puede fondear solo no tiene presupuesto.
 * - `kill_all` / `release_kill`: el kill switch es del humano. Que un agente
 *   pueda apagarlo lo vuelve decorativo, y que pueda dispararlo le da un
 *   denial-of-service sobre las tarjetas de los demás.
 * - cualquier cosa que afloje un límite ya emitido.
 *
 * Es la misma razón de §3.3: la policy vive fuera del prompt. Si el agente
 * pudiera negociar su techo por una tool call, no habría techo — y el jailbreak
 * no tendría que ser ingenioso, solo pedirlo.
 *
 * El `agentId` viene de la config del servidor, nunca de un parámetro. Si el
 * agente pudiera declarar quién es, podría gastar del presupuesto de otro.
 */

export interface McpServerOptions {
  service: AgentCardService;
  /** Identidad del agente. Sale de la config, no de las tool calls. */
  agentId: string;
}

const USD = z
  .number()
  .positive("El monto tiene que ser mayor a cero.")
  .describe("Monto en dólares, no en centavos. Por ejemplo: 9.5");

const HANDLE = z
  .string()
  .min(1)
  .describe("Handle de la tarjeta que devolvió request_card, con forma crd_…");

export function createMcpServer(opts: McpServerOptions): McpServer {
  const { service, agentId } = opts;

  const server = new McpServer(
    { name: "agent-card", version: "0.1.0" },
    {
      instructions: [
        "Capa de control para que un agente compre online con tarjetas de límite acotado.",
        "",
        "Flujo normal: get_budget → request_card → get_card_credentials → check_charge",
        "→ (comprás) → record_charge → complete_task.",
        "",
        "Tres cosas que conviene saber antes de empezar:",
        "1. request_card nunca devuelve el número de tarjeta. Devuelve un handle.",
        "   El PAN se pide con get_card_credentials y viaja del emisor a vos directo.",
        "2. Toda tarjeta nace con tope acumulado y con vencimiento. No hay forma de",
        "   emitir una sin ellos, y no hay tool para subirlos después.",
        "3. Cuando termines, llamá a complete_task. Cierra las tarjetas de esa tarea",
        "   y es lo que evita que una suscripción siga cobrando el mes que viene.",
      ].join("\n"),
    },
  );

  server.registerTool(
    "get_budget",
    {
      title: "Ver presupuesto",
      description:
        "Cuánta plata hay para gastar. `available` es lo que se puede comprometer en tarjetas nuevas; " +
        "`committed` es presupuesto de tarjetas vivas que todavía no se gastó pero podría salir. " +
        "El agente no puede depositar: eso lo hace el humano desde el panel.",
      inputSchema: {},
    },
    async () => ok(budgetText(service.budget(), service.providerName)),
  );

  server.registerTool(
    "request_card",
    {
      title: "Pedir una tarjeta",
      description:
        "Emite una tarjeta virtual para una tarea concreta. Devuelve un handle, NUNCA el número. " +
        "El monto que pidas es el tope acumulado de toda la vida de la tarjeta: pasado eso se rechaza " +
        "todo, aunque hagas cargos chicos. `merchant` es una allowlist de uno, así que la tarjeta no " +
        "cobra en ningún otro lado. Si no aclarás `ttl_hours`, vive 24 horas.",
      inputSchema: {
        amount_usd: USD.describe(
          "Tope acumulado en dólares. Es el techo total, no el techo por cargo.",
        ),
        merchant: z
          .string()
          .min(1)
          .describe("Único comercio donde va a poder cobrar. Obligatorio."),
        task_id: z
          .string()
          .min(1)
          .describe("Tarea que origina la tarjeta. Va en cada recibo."),
        reason: z
          .string()
          .optional()
          .describe("Para qué la pedís, en una línea. Queda en el recibo."),
        per_charge_usd: USD.optional().describe(
          "Tope por cargo individual. Por defecto, todo el presupuesto en un cargo.",
        ),
        ttl_hours: z
          .number()
          .positive()
          .optional()
          .describe("Horas de vida. Por defecto 24."),
        single_use: z
          .boolean()
          .optional()
          .describe(
            "Si es true, muere después del primer cargo aprobado. Conviene cuando el " +
              "número va a quedar en tu contexto.",
          ),
      },
    },
    async (args) =>
      guard(async () => {
        const card = await service.requestCard({
          merchant: args.merchant,
          budgetCents: toCents(args.amount_usd),
          taskId: args.task_id,
          agentId,
          ...(args.reason !== undefined ? { reason: args.reason } : {}),
          ...(args.per_charge_usd !== undefined
            ? { perTransactionCents: toCents(args.per_charge_usd) }
            : {}),
          ...(args.ttl_hours !== undefined
            ? { ttlSeconds: Math.round(args.ttl_hours * 3600) }
            : {}),
          ...(args.single_use !== undefined ? { singleUse: args.single_use } : {}),
        });

        return ok(
          [
            `Tarjeta ${card.handle} emitida para ${card.merchant}.`,
            `Tope acumulado ${fmt(card.budgetCents)}, tope por cargo ${fmt(card.perTransactionCents)}.`,
            `Vence ${card.expiresAt.toISOString()}.${card.singleUse ? " Un solo uso." : ""}`,
            "El número no está acá: pedilo con get_card_credentials.",
            "",
            json({
              handle: card.handle,
              merchant: card.merchant,
              task_id: card.taskId,
              lifetime_cap_usd: usd(card.budgetCents),
              per_charge_cap_usd: usd(card.perTransactionCents),
              expires_at: card.expiresAt.toISOString(),
              single_use: card.singleUse,
              last4: card.last4,
            }),
          ].join("\n"),
        );
      }),
  );

  server.registerTool(
    "get_card_credentials",
    {
      title: "Pedir el número de tarjeta",
      description:
        "Devuelve un endpoint del emisor y un token de vida corta para que canjees el número de " +
        "tarjeta DIRECTO con él. El PAN no pasa por este servidor, así que no lo pidas acá: " +
        "hacé el request al `endpoint` con el `token`. El token expira en un minuto.",
      inputSchema: { handle: HANDLE },
    },
    async (args) =>
      guard(async () => {
        const grant = await service.credentialGrant(args.handle);
        return ok(
          [
            `Canjeá el token en ${grant.endpoint}. Expira ${grant.expiresAt.toISOString()}.`,
            "",
            json({
              provider: grant.provider,
              endpoint: grant.endpoint,
              token: grant.token,
              expires_at: grant.expiresAt.toISOString(),
            }),
          ].join("\n"),
        );
      }),
  );

  server.registerTool(
    "check_charge",
    {
      title: "Consultar si un cargo pasaría",
      description:
        "Preflight: dice si un cargo pasaría la política, sin cobrar ni dejar rastro. Consultar es " +
        "gratis y no gasta. Conviene llamarlo antes de ir al checkout: si va a rechazar, te ahorra " +
        "el intento y te dice el motivo exacto.",
      inputSchema: {
        handle: HANDLE,
        amount_usd: USD,
        merchant: z
          .string()
          .optional()
          .describe("Por defecto, el comercio de la tarjeta."),
        currency: z
          .string()
          .length(3)
          .optional()
          .describe("ISO 4217. Por defecto USD. Un tope en USD no limita otra moneda."),
      },
    },
    async (args) =>
      guard(async () => {
        const decision = service.checkCharge({
          handle: args.handle,
          amountCents: toCents(args.amount_usd),
          ...(args.merchant !== undefined ? { merchant: args.merchant } : {}),
          ...(args.currency !== undefined ? { currency: args.currency } : {}),
        });
        return ok(
          [
            decision.allow
              ? `Pasaría: ${decision.reason}`
              : `No pasaría (${decision.code}): ${decision.reason}`,
            "",
            json({
              would_allow: decision.allow,
              code: decision.code,
              reason: decision.reason,
            }),
          ].join("\n"),
        );
      }),
  );

  server.registerTool(
    "record_charge",
    {
      title: "Registrar un cargo",
      description:
        "Registra un cargo contra la tarjeta: la política decide, el emisor responde y queda el " +
        "recibo. Un rechazo no es un error, es una respuesta con motivo. Llamalo después de comprar " +
        "para que el gasto quede atribuido a la tarea; si no, el presupuesto queda desalineado.",
      inputSchema: {
        handle: HANDLE,
        amount_usd: USD,
        merchant: z
          .string()
          .optional()
          .describe("Por defecto, el comercio de la tarjeta."),
        currency: z.string().length(3).optional().describe("ISO 4217. Por defecto USD."),
      },
    },
    async (args) =>
      guard(async () => {
        const receipt = await service.recordCharge({
          handle: args.handle,
          amountCents: toCents(args.amount_usd),
          ...(args.merchant !== undefined ? { merchant: args.merchant } : {}),
          ...(args.currency !== undefined ? { currency: args.currency } : {}),
        });
        return ok(
          [
            receipt.approved
              ? `Aprobado: ${fmt(receipt.amountCents)} en ${receipt.merchant}.`
              : `Rechazado (${receipt.code}): ${receipt.reason}`,
            "",
            json(receiptJson(receipt)),
          ].join("\n"),
        );
      }),
  );

  server.registerTool(
    "card_status",
    {
      title: "Estado de una tarjeta",
      description:
        "Estado, gastado, restante y el motivo del último rechazo. Si algo no entró, acá está el " +
        "por qué sin tener que adivinar.",
      inputSchema: { handle: HANDLE },
    },
    async (args) => guard(async () => ok(json(cardJson(service.cardStatus(args.handle))))),
  );

  server.registerTool(
    "list_cards",
    {
      title: "Listar tarjetas",
      description:
        "Tarjetas emitidas, de más nueva a más vieja. Filtrá por tarea, o pedí solo las activas.",
      inputSchema: {
        task_id: z.string().optional(),
        only_active: z.boolean().optional(),
      },
    },
    async (args) =>
      guard(async () => {
        const cards = service.listCards({
          agentId,
          ...(args.task_id !== undefined ? { taskId: args.task_id } : {}),
          ...(args.only_active !== undefined ? { onlyActive: args.only_active } : {}),
        });
        return ok(
          [
            `${cards.length} ${cards.length === 1 ? "tarjeta" : "tarjetas"}.`,
            "",
            json(cards.map(cardJson)),
          ].join("\n"),
        );
      }),
  );

  server.registerTool(
    "list_charges",
    {
      title: "Listar cargos",
      description:
        "Recibos con el motivo exacto de cada decisión, de más nuevo a más viejo. Incluye los " +
        "rechazos, que son la parte útil cuando algo no salió.",
      inputSchema: {
        handle: z.string().optional(),
        task_id: z.string().optional(),
        only_approved: z.boolean().optional(),
      },
    },
    async (args) =>
      guard(async () => {
        const charges = service.listCharges({
          // Scopeado al agente que llama, por la misma razón que list_cards: los
          // recibos de otro agente no son asunto de este.
          agentId,
          ...(args.handle !== undefined ? { handle: args.handle } : {}),
          ...(args.task_id !== undefined ? { taskId: args.task_id } : {}),
          ...(args.only_approved !== undefined
            ? { onlyApproved: args.only_approved }
            : {}),
        });
        return ok(
          [
            `${charges.length} ${charges.length === 1 ? "cargo" : "cargos"}.`,
            "",
            json(charges.map(receiptJson)),
          ].join("\n"),
        );
      }),
  );

  server.registerTool(
    "open_checkout",
    {
      title: "Abrir el checkout",
      description:
        "Abre una sesión de navegador para el comercio de la tarjeta, con resolución de captcha y " +
        "proxy residencial ya prendidos. Si aparece un captcha se resuelve solo, dentro de esta " +
        "misma sesión: no hay nada que pedir ni resolver aparte, y no sirve traer un token de " +
        "afuera. Conectate por CDP a `connect_url` y cerrá la sesión al terminar.",
      inputSchema: { handle: HANDLE },
    },
    async (args) =>
      guard(async () => {
        const session = await service.openCheckout(args.handle);
        return ok(
          [
            `Sesión ${session.id} abierta para ${session.merchant}. El captcha se resuelve solo.`,
            "",
            json({
              session_id: session.id,
              merchant: session.merchant,
              connect_url: session.connectUrl,
              viewer_url: session.viewerUrl,
            }),
          ].join("\n"),
        );
      }),
  );

  server.registerTool(
    "complete_task",
    {
      title: "Terminar la tarea",
      description:
        "Marca la tarea como terminada y cierra sus tarjetas. Llamalo siempre al final: una tarjeta " +
        "que sobrevive a su tarea es como sigue cobrando una suscripción que ya no usás. No se puede " +
        "deshacer, y eso es a propósito.",
      inputSchema: {
        task_id: z.string().min(1).describe("La misma tarea que usaste en request_card."),
      },
    },
    async (args) =>
      guard(async () => {
        const closed = await service.completeTask(args.task_id);
        return ok(
          `Tarea ${args.task_id} terminada. ${closed} ${closed === 1 ? "tarjeta cerrada" : "tarjetas cerradas"}.`,
        );
      }),
  );

  server.registerTool(
    "close_card",
    {
      title: "Cerrar una tarjeta",
      description:
        "Cierra una tarjeta ya. Después de esto rechaza todo. Usalo si sospechás que el número se " +
        "filtró o si la compra se canceló.",
      inputSchema: { handle: HANDLE },
    },
    async (args) =>
      guard(async () => {
        const card = await service.closeCard(args.handle);
        return ok(
          `Tarjeta ${card.handle} cerrada. Gastado ${fmt(card.spentCents)} de ${fmt(card.budgetCents)}.`,
        );
      }),
  );

  return server;
}

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

/**
 * Un fallo del servicio vuelve como error con su código estable, para que el
 * agente ramifique sin parsear castellano. Un rechazo de la policy **no** pasa
 * por acá: es una respuesta válida, no una falla.
 */
async function guard(run: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ServiceError) {
      return {
        content: [{ type: "text", text: `${error.code}: ${error.message}` }],
        isError: true,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text: `ERROR: ${message}` }], isError: true };
  }
}

function budgetText(t: Treasury, provider: string): string {
  return [
    `Disponible ${fmt(t.availableCents)} de ${fmt(t.depositedCents)} depositados.`,
    `Gastado ${fmt(t.spentCents)}, comprometido ${fmt(t.committedCents)}.`,
    "",
    json({
      deposited_usd: usd(t.depositedCents),
      spent_usd: usd(t.spentCents),
      committed_usd: usd(t.committedCents),
      available_usd: usd(t.availableCents),
      provider,
    }),
  ].join("\n");
}

function cardJson(card: CardStatus): Record<string, unknown> {
  return {
    handle: card.handle,
    status: card.status,
    merchant: card.merchant,
    task_id: card.taskId,
    reason: card.reason,
    lifetime_cap_usd: usd(card.budgetCents),
    per_charge_cap_usd: usd(card.perTransactionCents),
    spent_usd: usd(card.spentCents),
    remaining_usd: usd(card.remainingCents),
    approved_charges: card.approvedCharges,
    attempts: card.attempts,
    single_use: card.singleUse,
    last4: card.last4,
    expires_at: card.expiresAt.toISOString(),
    last_denial:
      card.lastDenial === null
        ? null
        : {
            code: card.lastDenial.code,
            reason: card.lastDenial.reason,
            at: card.lastDenial.at.toISOString(),
          },
  };
}

function receiptJson(receipt: Receipt): Record<string, unknown> {
  return {
    id: receipt.id,
    at: receipt.at.toISOString(),
    handle: receipt.handle,
    task_id: receipt.taskId,
    merchant: receipt.merchant,
    amount_usd: usd(receipt.amountCents),
    currency: receipt.currency,
    kind: receipt.kind,
    approved: receipt.approved,
    code: receipt.code,
    reason: receipt.reason,
    captcha:
      receipt.captcha === null
        ? null
        : { kind: receipt.captcha.kind, status: receipt.captcha.status },
  };
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * Los agentes razonan en dólares, así que la frontera acepta dólares y adentro
 * todo es centavos enteros. Es el único lugar donde un float toca dinero.
 */
function toCents(amountUsd: number): number {
  return Math.round(amountUsd * 100);
}

function usd(cents: number): number {
  return Math.round(cents) / 100;
}
