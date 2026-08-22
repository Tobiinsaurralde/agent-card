import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server.js";
import { AgentCardService } from "../src/service.js";

/**
 * Se prueba a través del protocolo, con un cliente de verdad, no llamando a las
 * funciones por abajo. Los bugs de un servidor MCP viven justo ahí: en el schema
 * que el cliente valida y en la forma del resultado.
 */
async function connect(opts: { budgetUsd?: number; agentId?: string } = {}) {
  const service = new AgentCardService({ maxCardBudgetCents: 20_00 });
  service.deposit(Math.round((opts.budgetUsd ?? 50) * 100));

  const server = createMcpServer({ service, agentId: opts.agentId ?? "test-agent" });
  const client = new Client({ name: "test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, service, close: () => client.close() };
}

/** Texto plano del resultado, para asertar sobre lo que el agente realmente lee. */
function text(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content), "el resultado no trae content");
  return content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
}

function payload(result: unknown): Record<string, unknown> {
  const raw = text(result);
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  assert.ok(start !== -1 && end > start, `no hay JSON en la respuesta:\n${raw}`);
  return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
}

function isError(result: unknown): boolean {
  return (result as { isError?: boolean }).isError === true;
}

test("expone el set de tools esperado y nada que afloje un límite", async () => {
  const { client, close } = await connect();
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();

  assert.deepEqual(names, [
    "card_status",
    "check_charge",
    "close_card",
    "complete_task",
    "get_budget",
    "get_card_credentials",
    "list_cards",
    "list_charges",
    "open_checkout",
    "record_charge",
    "request_card",
  ]);

  // Lo importante es la ausencia: nada de fondear, ni de tocar el kill switch,
  // ni de subir un tope ya emitido.
  for (const forbidden of ["deposit", "kill_all", "release_kill", "set_policy"]) {
    assert.ok(!names.includes(forbidden), `no debería exponer ${forbidden}`);
  }
  await close();
});

test("get_budget informa lo disponible", async () => {
  const { client, close } = await connect({ budgetUsd: 50 });
  const result = await client.callTool({ name: "get_budget", arguments: {} });
  assert.equal(payload(result).available_usd, 50);
  assert.equal(payload(result).deposited_usd, 50);
  await close();
});

test("request_card devuelve un handle y jamás un número de tarjeta", async () => {
  const { client, close } = await connect();
  const result = await client.callTool({
    name: "request_card",
    arguments: {
      amount_usd: 10,
      merchant: "api-credits",
      task_id: "task-1",
      reason: "créditos para la corrida",
    },
  });

  const card = payload(result);
  assert.match(String(card.handle), /^crd_[0-9a-f]{12}$/);
  assert.equal(card.lifetime_cap_usd, 10);
  assert.equal(card.merchant, "api-credits");

  // El PAN no puede estar en la respuesta bajo ninguna forma.
  const raw = text(result);
  assert.ok(!/\b\d{13,19}\b/.test(raw), `parece haber un PAN en la respuesta:\n${raw}`);
  assert.ok(!/\bpan\b/i.test(raw) || /pedilo con get_card_credentials/.test(raw));
  await close();
});

test("el tope acumulado corta el structuring a través del protocolo", async () => {
  const { client, close } = await connect();
  const issued = await client.callTool({
    name: "request_card",
    arguments: { amount_usd: 10, merchant: "api-credits", task_id: "task-1" },
  });
  const handle = String(payload(issued).handle);

  const first = await client.callTool({
    name: "record_charge",
    arguments: { handle, amount_usd: 9 },
  });
  assert.equal(payload(first).approved, true);

  // Segundo cargo de 9: por transacción entra, acumulado no. Es el bypass que
  // el producto existe para cerrar.
  const second = await client.callTool({
    name: "record_charge",
    arguments: { handle, amount_usd: 9 },
  });
  assert.equal(payload(second).approved, false);
  assert.equal(payload(second).code, "LIFETIME_EXCEEDED");
  // Un rechazo de policy es una respuesta válida, no un error de transporte.
  assert.equal(isError(second), false);
  await close();
});

test("check_charge no gasta ni deja rastro", async () => {
  const { client, close } = await connect();
  const issued = await client.callTool({
    name: "request_card",
    arguments: { amount_usd: 10, merchant: "api-credits", task_id: "task-1" },
  });
  const handle = String(payload(issued).handle);

  for (let i = 0; i < 3; i += 1) {
    const check = await client.callTool({
      name: "check_charge",
      arguments: { handle, amount_usd: 9 },
    });
    assert.equal(payload(check).would_allow, true);
  }

  const status = await client.callTool({ name: "card_status", arguments: { handle } });
  assert.equal(payload(status).spent_usd, 0);
  assert.equal(payload(status).attempts, 0);

  const charges = await client.callTool({ name: "list_charges", arguments: {} });
  assert.match(text(charges), /^0 cargos/m);
  await close();
});

test("check_charge explica el motivo antes de ir al checkout", async () => {
  const { client, close } = await connect();
  const issued = await client.callTool({
    name: "request_card",
    arguments: { amount_usd: 10, merchant: "api-credits", task_id: "task-1" },
  });
  const handle = String(payload(issued).handle);

  const other = await client.callTool({
    name: "check_charge",
    arguments: { handle, amount_usd: 5, merchant: "casino-online" },
  });
  assert.equal(payload(other).would_allow, false);
  assert.equal(payload(other).code, "MERCHANT_NOT_ALLOWED");
  await close();
});

test("complete_task cierra la tarjeta y mata la suscripción zombie", async () => {
  const { client, close } = await connect();
  const issued = await client.callTool({
    name: "request_card",
    arguments: { amount_usd: 12, merchant: "saas-x", task_id: "task-sub" },
  });
  const handle = String(payload(issued).handle);

  const first = await client.callTool({
    name: "record_charge",
    arguments: { handle, amount_usd: 5 },
  });
  assert.equal(payload(first).approved, true);

  await client.callTool({ name: "complete_task", arguments: { task_id: "task-sub" } });

  // La renovación del mes siguiente: hay presupuesto de sobra, pero la tarea
  // terminó y por eso se rechaza.
  const renewal = await client.callTool({
    name: "record_charge",
    arguments: { handle, amount_usd: 5 },
  });
  assert.equal(payload(renewal).approved, false);
  assert.equal(payload(renewal).code, "TASK_COMPLETE");
  await close();
});

test("no se puede emitir por encima del presupuesto disponible", async () => {
  const { client, close } = await connect({ budgetUsd: 10 });
  const result = await client.callTool({
    name: "request_card",
    arguments: { amount_usd: 15, merchant: "api-credits", task_id: "task-1" },
  });
  assert.equal(isError(result), true);
  assert.match(text(result), /INSUFFICIENT_BUDGET/);
  await close();
});

test("el techo por tarjeta se respeta", async () => {
  const { client, close } = await connect({ budgetUsd: 500 });
  const result = await client.callTool({
    name: "request_card",
    arguments: { amount_usd: 100, merchant: "api-credits", task_id: "task-1" },
  });
  assert.equal(isError(result), true);
  assert.match(text(result), /OVER_MAX_CARD_BUDGET/);
  await close();
});

test("el kill switch del humano deja al agente sin poder emitir", async () => {
  const { client, service, close } = await connect();
  await service.killAll();

  const result = await client.callTool({
    name: "request_card",
    arguments: { amount_usd: 5, merchant: "api-credits", task_id: "task-1" },
  });
  assert.equal(isError(result), true);
  assert.match(text(result), /KILL_SWITCH_ACTIVE/);
  await close();
});

test("get_card_credentials entrega token y endpoint, no el PAN", async () => {
  const { client, close } = await connect();
  const issued = await client.callTool({
    name: "request_card",
    arguments: { amount_usd: 10, merchant: "api-credits", task_id: "task-1" },
  });
  const handle = String(payload(issued).handle);

  const grant = payload(
    await client.callTool({ name: "get_card_credentials", arguments: { handle } }),
  );
  assert.match(String(grant.token), /^tok_mock_/);
  assert.match(String(grant.endpoint), /^https:\/\//);
  assert.ok(typeof grant.expires_at === "string");
  assert.ok(!("pan" in grant), "el grant no puede traer el PAN");
  await close();
});

test("una tarjeta cerrada no entrega credenciales", async () => {
  const { client, close } = await connect();
  const issued = await client.callTool({
    name: "request_card",
    arguments: { amount_usd: 10, merchant: "api-credits", task_id: "task-1" },
  });
  const handle = String(payload(issued).handle);
  await client.callTool({ name: "close_card", arguments: { handle } });

  const result = await client.callTool({
    name: "get_card_credentials",
    arguments: { handle },
  });
  assert.equal(isError(result), true);
  assert.match(text(result), /CARD_CLOSED/);
  await close();
});

test("un handle inexistente falla con código estable, no con un stack", async () => {
  const { client, close } = await connect();
  const result = await client.callTool({
    name: "card_status",
    arguments: { handle: "crd_noexiste00" },
  });
  assert.equal(isError(result), true);
  assert.match(text(result), /^UNKNOWN_CARD:/);
  await close();
});

test("el agente no puede declarar quién es: no hay parámetro de identidad", async () => {
  const { client, service, close } = await connect({ agentId: "agente-real" });
  const { tools } = await client.listTools();

  for (const tool of tools) {
    const props = (tool.inputSchema as { properties?: Record<string, unknown> }).properties;
    for (const key of Object.keys(props ?? {})) {
      assert.ok(
        !/agent/i.test(key),
        `${tool.name} expone "${key}": la identidad tiene que venir de la config`,
      );
    }
  }

  await client.callTool({
    name: "request_card",
    arguments: { amount_usd: 5, merchant: "api-credits", task_id: "task-1" },
  });
  const [card] = service.listCards();
  assert.equal(card?.agentId, "agente-real");
  await close();
});

test("los montos se piden en dólares y se guardan en centavos enteros", async () => {
  const { client, service, close } = await connect();
  await client.callTool({
    name: "request_card",
    arguments: { amount_usd: 9.99, merchant: "api-credits", task_id: "task-1" },
  });
  const [card] = service.listCards();
  assert.equal(card?.budgetCents, 999);
  assert.equal(Number.isInteger(card?.budgetCents), true);
  await close();
});

test("un monto no positivo se rechaza en el schema, en castellano", async () => {
  const { client, service, close } = await connect();

  for (const amount_usd of [0, -5]) {
    const result = await client.callTool({
      name: "request_card",
      arguments: { amount_usd, merchant: "api-credits", task_id: "task-1" },
    });
    // El SDK devuelve un error result, no una excepción. Y el mensaje llega en
    // castellano hasta el agente, que es la mitad del diferenciador.
    assert.equal(isError(result), true);
    assert.match(text(result), /El monto tiene que ser mayor a cero/);
  }

  assert.equal(service.listCards().length, 0, "no debería haber emitido nada");
  await close();
});

test("open_checkout abre la sesión con el captcha ya resuelto por el browser", async () => {
  const { client, close } = await connect();
  const issued = await client.callTool({
    name: "request_card",
    arguments: { amount_usd: 10, merchant: "api-credits", task_id: "task-1" },
  });
  const handle = String(payload(issued).handle);

  const session = payload(
    await client.callTool({ name: "open_checkout", arguments: { handle } }),
  );
  assert.equal(session.merchant, "api-credits");
  assert.ok(typeof session.session_id === "string" && session.session_id.length > 0);

  // No hay tool para "resolver captcha": se resuelve en la sesión o no sirve.
  const { tools } = await client.listTools();
  for (const tool of tools) {
    assert.doesNotMatch(tool.name, /captcha|solve/i, `${tool.name} no debería existir`);
  }
  await close();
});

test("una tarjeta cerrada no abre checkout", async () => {
  const { client, close } = await connect();
  const issued = await client.callTool({
    name: "request_card",
    arguments: { amount_usd: 10, merchant: "api-credits", task_id: "task-1" },
  });
  const handle = String(payload(issued).handle);
  await client.callTool({ name: "close_card", arguments: { handle } });

  const result = await client.callTool({ name: "open_checkout", arguments: { handle } });
  assert.equal(isError(result), true);
  assert.match(text(result), /CARD_CLOSED/);
  await close();
});

test("un agente no ve los recibos de otro", async () => {
  const service = new AgentCardService({ maxCardBudgetCents: 20_00 });
  service.deposit(50_00);

  const ajeno = await service.requestCard({
    merchant: "api-credits",
    budgetCents: 5_00,
    taskId: "task-ajena",
    agentId: "otro-agente",
  });
  await service.recordCharge({ handle: ajeno.handle, amountCents: 2_00 });

  const server = createMcpServer({ service, agentId: "mi-agente" });
  const client = new Client({ name: "test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const charges = await client.callTool({ name: "list_charges", arguments: {} });
  assert.match(text(charges), /0 cargos/);
  assert.doesNotMatch(text(charges), /task-ajena/);

  const cards = await client.callTool({ name: "list_cards", arguments: {} });
  assert.doesNotMatch(text(cards), /task-ajena/);
  await client.close();
});

test("faltar un campo obligatorio dice cuál falta", async () => {
  const { client, close } = await connect();
  const result = await client.callTool({
    name: "request_card",
    arguments: { amount_usd: 5 },
  });
  assert.equal(isError(result), true);
  assert.match(text(result), /merchant/);
  assert.match(text(result), /task_id/);
  await close();
});
