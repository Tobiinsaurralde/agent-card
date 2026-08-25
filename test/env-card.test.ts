import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CardCredentials } from "../src/credentials.js";
import { createMcpServer } from "../src/mcp/server.js";
import { EnvCardProvider } from "../src/providers/env-card.js";
import { AgentCardService } from "../src/service.js";

/**
 * Lo que se prueba acá es una sola cosa: que el PAN salga por donde tiene que
 * salir y por ningún otro lado.
 *
 * El grant es la única puerta del número. Si se pudiera canjear dos veces, o sin
 * token, o si el PAN apareciera en la respuesta de la tool, la separación del
 * §3.1 sería decorativa. Son los tests que quiero que fallen ruidosamente el día
 * que alguien "simplifique" el provider.
 */

const CARD = CardCredentials.forTesting({
  pan: "4242424242424242",
  cvc: "123",
  expMonth: "09",
  expYear: "2028",
  name: "TOBIAS INSAURRALDE",
});

function providerAndCard(): Promise<{ provider: EnvCardProvider; id: string }> {
  const provider = EnvCardProvider.forTesting(CARD);
  return provider
    .issue({ fundedCents: 1_000, currency: "USD", providerPerTransactionCents: null })
    .then((card) => ({ provider, id: card.id }));
}

test("el grant no trae el PAN: solo un endpoint y un token", async () => {
  const { provider, id } = await providerAndCard();
  const grant = await provider.credentialGrant(id);

  const serialized = JSON.stringify(grant);
  assert.ok(!serialized.includes("4242424242424242"), "el PAN se filtró en el grant");
  assert.ok(!serialized.includes("123"), "el CVC se filtró en el grant");
  assert.match(grant.endpoint, /^http:\/\/127\.0\.0\.1:\d+\/pan\/[0-9a-f]+$/);
  assert.ok(grant.token.length >= 24);
});

test("el canje devuelve el número una vez y solo una", async () => {
  const { provider, id } = await providerAndCard();
  const grant = await provider.credentialGrant(id);
  const auth = { authorization: `Bearer ${grant.token}` };

  const first = await fetch(grant.endpoint, { headers: auth });
  assert.equal(first.status, 200);
  const secret = (await first.json()) as Record<string, string>;
  assert.equal(secret.pan, "4242424242424242");
  assert.equal(secret.cvc, "123");
  assert.equal(secret.last4, "4242");

  // El servidor se apaga tras el primer canje, así que el segundo intento no
  // llega a hablar con nadie. Que falle la conexión es el resultado correcto.
  const second = await fetch(grant.endpoint, { headers: auth }).catch(() => null);
  assert.ok(
    second === null || second.status === 410,
    "el grant se pudo canjear dos veces",
  );
});

test("sin el token no hay número, y el grant sigue vivo", async () => {
  const { provider, id } = await providerAndCard();
  const grant = await provider.credentialGrant(id);

  const wrong = await fetch(grant.endpoint, { headers: { authorization: "Bearer nope" } });
  assert.equal(wrong.status, 401);

  // Un request con token equivocado no puede quemar el grant: si lo quemara,
  // cualquiera podría dejar al agente sin forma de pagar con un request basura.
  const right = await fetch(grant.endpoint, {
    headers: { authorization: `Bearer ${grant.token}` },
  });
  assert.equal(right.status, 200);
  await right.json();
});

test("una tarjeta cerrada no entrega credenciales", async () => {
  const { provider, id } = await providerAndCard();
  await provider.close(id);
  await assert.rejects(() => provider.credentialGrant(id), /cerrada/);
});

test("el agente ve los últimos cuatro reales, no cuatro dígitos al azar", async () => {
  const service = new AgentCardService({ provider: EnvCardProvider.forTesting(CARD) });
  service.deposit(20_00);

  const card = await service.requestCard({
    merchant: "spaceship.com",
    budgetCents: 5_00,
    taskId: "t1",
  });

  assert.equal(card.last4, "4242");
});

/**
 * El recorrido completo por el protocolo, que es el punto de todo esto: el
 * agente pide la tarjeta, pide el permiso, canjea el número y paga. Nadie carga
 * un `.env` a mano en el medio.
 */
test("de request_card al número, sin humano en el medio", async () => {
  const service = new AgentCardService({ provider: EnvCardProvider.forTesting(CARD) });
  service.deposit(20_00);

  const server = createMcpServer({ service, agentId: "test-agent" });
  const client = new Client({ name: "test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const issued = await client.callTool({
    name: "request_card",
    arguments: {
      amount_usd: 5,
      merchant: "spaceship.com",
      task_id: "dominio-1",
      reason: "comprar un dominio de prueba",
      single_use: true,
    },
  });

  const issuedText = flatten(issued);
  assert.ok(!issuedText.includes("4242424242424242"), "request_card devolvió el PAN");
  const handle = /crd_[0-9a-f]+/.exec(issuedText)?.[0];
  assert.ok(handle !== undefined, `no vino el handle:\n${issuedText}`);

  const granted = await client.callTool({
    name: "get_card_credentials",
    arguments: { handle },
  });

  const grantText = flatten(granted);
  assert.ok(!grantText.includes("4242424242424242"), "get_card_credentials devolvió el PAN");

  const grant = JSON.parse(
    grantText.slice(grantText.indexOf("{"), grantText.lastIndexOf("}") + 1),
  ) as { endpoint: string; token: string };

  // El canje sale del cliente MCP, no del servidor: el número nunca pasa por
  // el proceso que atiende las tools.
  const response = await fetch(grant.endpoint, {
    headers: { authorization: `Bearer ${grant.token}` },
  });
  assert.equal(response.status, 200);
  const secret = (await response.json()) as Record<string, string>;
  assert.equal(secret.pan, "4242424242424242");

  await client.close();
});

/** Texto plano de un resultado de tool, que es lo que el agente realmente lee. */
function flatten(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content), "el resultado no trae content");
  return content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
}
