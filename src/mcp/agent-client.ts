/**
 * El lado del agente: consigue la tarjeta hablando el protocolo, no leyendo la
 * config.
 *
 * La diferencia no es de estilo. Mientras el comprador hacía
 * `CardCredentials.fromEnv()`, el que decidía el tope era el que editaba el
 * `.env` — o sea yo, antes de cada compra. Con esto el tope lo pide el agente y
 * lo concede el servidor, que es el único que puede negarlo. Ese "no" es el
 * producto; si vive en un archivo que el agente puede leer, no existe.
 *
 * Levanta el servidor MCP como subproceso y habla por stdio, igual que lo haría
 * Claude o Cursor. Se corre así a propósito: si funciona por acá, funciona
 * desde cualquier cliente MCP sin tocar nada.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CardCredentials } from "../credentials.js";

export interface CardGrant {
  handle: string;
  merchant: string;
  taskId: string;
  lifetimeCapUsd: number;
  perChargeCapUsd: number;
  last4: string;
  expiresAt: string;
}

export interface ChargeVerdict {
  approved: boolean;
  code: string;
  reason: string;
}

/** Un rechazo de la policy. No es una falla: es el servidor diciendo que no. */
export class DeniedError extends Error {
  constructor(
    readonly code: string,
    reason: string,
  ) {
    super(reason);
    this.name = "DeniedError";
  }
}

export class AgentCardClient {
  private constructor(
    private readonly client: Client,
    private readonly transport: StdioClientTransport,
  ) {}

  /**
   * Levanta el servidor y se conecta. El entorno se pasa completo porque el
   * servidor necesita la tarjeta y el gate; el agente no ve nada de eso, solo
   * habla tools.
   */
  static async spawn(
    opts: { command?: string; args?: string[]; env?: NodeJS.ProcessEnv } = {},
  ): Promise<AgentCardClient> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(opts.env ?? process.env)) {
      if (value !== undefined) env[key] = value;
    }

    const transport = new StdioClientTransport({
      command: opts.command ?? process.execPath,
      args: opts.args ?? ["--import", "tsx", "src/mcp/bin.ts"],
      env,
      stderr: "inherit",
    });

    const client = new Client({ name: "agent-card-buyer", version: "0.1.0" });
    await client.connect(transport);
    return new AgentCardClient(client, transport);
  }

  async budget(): Promise<{ availableUsd: number; provider: string }> {
    const data = await this.call("get_budget", {});
    return {
      availableUsd: num(data, "available_usd"),
      provider: String(data["provider"] ?? "desconocido"),
    };
  }

  async requestCard(req: {
    amountUsd: number;
    merchant: string;
    taskId: string;
    reason?: string;
    singleUse?: boolean;
    ttlHours?: number;
  }): Promise<CardGrant> {
    const data = await this.call("request_card", {
      amount_usd: req.amountUsd,
      merchant: req.merchant,
      task_id: req.taskId,
      ...(req.reason !== undefined ? { reason: req.reason } : {}),
      ...(req.singleUse !== undefined ? { single_use: req.singleUse } : {}),
      ...(req.ttlHours !== undefined ? { ttl_hours: req.ttlHours } : {}),
    });

    return {
      handle: String(data["handle"]),
      merchant: String(data["merchant"]),
      taskId: String(data["task_id"]),
      lifetimeCapUsd: num(data, "lifetime_cap_usd"),
      perChargeCapUsd: num(data, "per_charge_cap_usd"),
      last4: String(data["last4"]),
      expiresAt: String(data["expires_at"]),
    };
  }

  /** Preflight. Tira `DeniedError` si no pasaría, así el browser no se abre al vacío. */
  async checkCharge(handle: string, amountUsd: number): Promise<void> {
    const data = await this.call("check_charge", { handle, amount_usd: amountUsd });
    if (data["would_allow"] !== true) {
      throw new DeniedError(String(data["code"]), String(data["reason"]));
    }
  }

  /**
   * Canjea el grant y devuelve la tarjeta.
   *
   * El canje lo hace este proceso contra el endpoint del emisor: el número no
   * pasa por el servidor MCP. Es la parte del diseño que hay que no romper.
   */
  async credentials(handle: string): Promise<CardCredentials> {
    const grant = await this.call("get_card_credentials", { handle });
    const endpoint = String(grant["endpoint"]);
    const token = String(grant["token"]);

    const response = await fetch(endpoint, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(
        `El emisor no entregó la tarjeta: HTTP ${response.status}. ` +
          "El token vive un minuto; si venció, pedí otro grant.",
      );
    }

    const secret = (await response.json()) as Record<string, string>;
    return CardCredentials.fromIssuer({
      pan: String(secret["pan"] ?? ""),
      cvc: String(secret["cvc"] ?? ""),
      expMonth: String(secret["exp_month"] ?? ""),
      expYear: String(secret["exp_year"] ?? ""),
      name: String(secret["name"] ?? ""),
    });
  }

  async recordCharge(handle: string, amountUsd: number): Promise<ChargeVerdict> {
    const data = await this.call("record_charge", { handle, amount_usd: amountUsd });
    return {
      approved: data["approved"] === true,
      code: String(data["code"]),
      reason: String(data["reason"]),
    };
  }

  async completeTask(taskId: string): Promise<void> {
    await this.callText("complete_task", { task_id: taskId });
  }

  async close(): Promise<void> {
    await this.client.close().catch(() => undefined);
    await this.transport.close().catch(() => undefined);
  }

  /** El JSON que trae la respuesta. Las tools contestan prosa y después el bloque. */
  private async call(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const raw = await this.callText(name, args);
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end <= start) {
      throw new Error(`${name} no devolvió JSON:\n${raw}`);
    }
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  }

  private async callText(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.client.callTool({ name, arguments: args });
    const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
    const text = content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n");

    if ((result as { isError?: boolean }).isError === true) {
      // Los errores del servicio vienen como `CODIGO: mensaje`, para ramificar
      // sin parsear castellano.
      const [code, ...rest] = text.split(":");
      throw new DeniedError((code ?? "ERROR").trim(), rest.join(":").trim() || text);
    }
    return text;
  }
}

function num(data: Record<string, unknown>, key: string): number {
  const value = Number(data[key]);
  if (!Number.isFinite(value)) throw new Error(`Falta ${key} en la respuesta del servidor.`);
  return value;
}
