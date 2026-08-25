import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentCardClient, DeniedError } from "../src/mcp/agent-client.js";

/**
 * El recorrido completo contra el binario de verdad, levantado como subproceso y
 * hablando stdio, igual que lo haría Cursor o Claude.
 *
 * Se prueba así y no llamando al servicio por abajo porque lo que queremos saber
 * es otra cosa: que el cableado del entrypoint esté bien, que el gate prenda el
 * emisor real, y que el número llegue al comprador sin que nadie edite un
 * archivo. Un test que importa `AgentCardService` directo no vería nada de eso.
 *
 * La tarjeta es de mentira pero pasa Luhn, así que el camino es idéntico al de
 * la real hasta el momento de cobrar.
 */

const FAKE_CARD = {
  AGENT_CARD_ALLOW_MANUAL_PAN: "1",
  AGENT_CARD_TEST_PAN: "4242424242424242",
  AGENT_CARD_TEST_CVC: "123",
  AGENT_CARD_TEST_EXP: "09/2028",
  AGENT_CARD_TEST_NAME: "AGENTE DE PRUEBA",
  AGENT_CARD_BUDGET_USD: "20",
  AGENT_CARD_MAX_CARD_USD: "20",
};

/**
 * Cada binario arranca con su propio ledger en un temporal.
 *
 * Sin esto los tests comparten el ledger real del usuario: el primero gasta, el
 * segundo arranca con lo que quedó y falla por un presupuesto que nadie tocó en
 * el test. Un ledger que persiste es justo lo que queremos en producción y justo
 * lo que no queremos entre tests.
 */
async function spawn(overrides: Record<string, string> = {}): Promise<AgentCardClient> {
  const state = join(mkdtempSync(join(tmpdir(), "agent-card-test-")), "state.json");
  return AgentCardClient.spawn({
    env: {
      ...process.env,
      ...FAKE_CARD,
      AGENT_CARD_STATE: state,
      ...overrides,
      STEEL_API_KEY: "",
    },
  });
}

test("el agente pide la tarjeta al binario y consigue el número", async () => {
  const mcp = await spawn();
  try {
    const budget = await mcp.budget();
    assert.equal(budget.provider, "env-manual");
    assert.equal(budget.availableUsd, 20);

    const grant = await mcp.requestCard({
      amountUsd: 3,
      merchant: "spaceship.com",
      taskId: "t-integracion",
      reason: "test de integración",
      singleUse: true,
    });

    assert.match(grant.handle, /^crd_[0-9a-f]+$/);
    assert.equal(grant.merchant, "spaceship.com");
    assert.equal(grant.lifetimeCapUsd, 3);
    // Los últimos cuatro son los del plástico, no cuatro dígitos inventados.
    assert.equal(grant.last4, "4242");

    await mcp.checkCharge(grant.handle, 3);

    const card = await mcp.credentials(grant.handle);
    assert.equal(card.last4, "4242");
    assert.equal(card.brand, "visa");
    assert.equal(card.reveal().pan, "4242424242424242");
    assert.equal(card.reveal().expMonth, "09");

    const verdict = await mcp.recordCharge(grant.handle, 3);
    assert.ok(verdict.approved, `el cargo no entró: ${verdict.code} ${verdict.reason}`);

    await mcp.completeTask("t-integracion");
  } finally {
    await mcp.close();
  }
});

test("el preflight frena antes de abrir el navegador", async () => {
  const mcp = await spawn();
  try {
    const grant = await mcp.requestCard({
      amountUsd: 2,
      merchant: "spaceship.com",
      taskId: "t-preflight",
    });

    // USD 5 contra un tope de USD 2. Enterarse acá cuesta una tool call; el
    // camino alternativo es un formulario a medio llenar con un número real.
    await assert.rejects(
      () => mcp.checkCharge(grant.handle, 5),
      (error: unknown) => error instanceof DeniedError,
    );

    // Y el preflight no gasta: el cargo dentro del tope sigue entrando.
    const verdict = await mcp.recordCharge(grant.handle, 2);
    assert.ok(verdict.approved);
  } finally {
    await mcp.close();
  }
});

test("el techo por tarjeta lo pone el servidor, no el que pide", async () => {
  const mcp = await spawn();
  try {
    await assert.rejects(
      () =>
        mcp.requestCard({
          amountUsd: 50,
          merchant: "spaceship.com",
          taskId: "t-techo",
        }),
      (error: unknown) =>
        error instanceof DeniedError && error.code === "OVER_MAX_CARD_BUDGET",
    );
  } finally {
    await mcp.close();
  }
});

test("sin el gate el emisor es el mock y no hay número real", async () => {
  const mcp = await AgentCardClient.spawn({
    env: { ...process.env, AGENT_CARD_ALLOW_MANUAL_PAN: "", STEEL_API_KEY: "" },
  });
  try {
    const budget = await mcp.budget();
    assert.equal(budget.provider, "mock");

    const grant = await mcp.requestCard({
      amountUsd: 2,
      merchant: "spaceship.com",
      taskId: "t-mock",
    });

    // El mock apunta a un host inexistente a propósito: es lo que hace imposible
    // confundir una corrida sin gate con una que cobra de verdad.
    await assert.rejects(() => mcp.credentials(grant.handle));
  } finally {
    await mcp.close();
  }
});
