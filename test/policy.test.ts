import assert from "node:assert/strict";
import { test } from "node:test";
import { ControlledCard } from "../src/card.js";
import { permissivePolicy, safePolicy } from "../src/defaults.js";
import { MockProvider } from "../src/provider.js";
import { evaluate } from "../src/policy.js";
import type { AuthAttempt, CardState } from "../src/types.js";

const t0 = new Date("2026-08-21T15:00:00Z");
const USD = (d: number): number => Math.round(d * 100);

function freshState(openedAt = t0): CardState {
  return {
    openedAt,
    closed: false,
    taskComplete: false,
    killed: false,
    charges: [],
  };
}

function charge(overrides: Partial<AuthAttempt> = {}): AuthAttempt {
  return {
    amountCents: USD(9),
    currency: "USD",
    merchant: "api-credits",
    kind: "capture",
    at: t0,
    ...overrides,
  };
}

async function openCard(policy: Parameters<typeof evaluate>[2], funded = USD(50)) {
  return ControlledCard.open({
    provider: new MockProvider(),
    policy,
    fundedCents: funded,
    providerPerTransactionCents: null,
    now: t0,
  });
}

test("safePolicy exige presupuesto y merchant", () => {
  assert.throws(() => safePolicy({ budgetCents: 0, merchant: "x" }));
  assert.throws(() => safePolicy({ budgetCents: USD(10), merchant: "  " }));
  assert.throws(() =>
    safePolicy({
      budgetCents: USD(10),
      merchant: "x",
      perTransactionCents: USD(20),
    }),
  );
});

test("safePolicy siempre pone cap acumulado y TTL", () => {
  const p = safePolicy({ budgetCents: USD(10), merchant: "api-credits" });
  assert.equal(p.lifetimeCents, USD(10));
  assert.ok(p.ttlSeconds !== null && p.ttlSeconds > 0);
  assert.deepEqual(p.merchantAllowlist, ["api-credits"]);
  assert.equal(p.grossSpendAccounting, true);
  assert.equal(p.closeOnTaskComplete, true);
});

test("structuring: la config naive deja gastar el doble del cap", async () => {
  const card = await openCard(permissivePolicy(USD(10)));
  const a = await card.attempt(charge());
  const b = await card.attempt(charge({ at: new Date(t0.getTime() + 60_000) }));
  assert.equal(a.approved, true);
  assert.equal(b.approved, true);
  assert.equal(card.committed, USD(18));
});

test("structuring: el cap acumulado lo bloquea", async () => {
  const card = await openCard(
    safePolicy({
      budgetCents: USD(10),
      merchant: "api-credits",
      perTransactionCents: USD(10),
    }),
  );
  const a = await card.attempt(charge());
  const b = await card.attempt(charge({ at: new Date(t0.getTime() + 60_000) }));
  assert.equal(a.approved, true);
  assert.equal(b.approved, false);
  assert.equal(b.decision.code, "LIFETIME_EXCEEDED");
  assert.equal(card.committed, USD(9));
});

test("suscripción zombie: naive renueva, hardened no", async () => {
  const renewal = charge({
    merchant: "saas-x",
    at: new Date(t0.getTime() + 30 * 24 * 3600 * 1000),
  });

  const naive = await openCard(permissivePolicy(USD(10)));
  await naive.attempt(charge({ merchant: "saas-x" }));
  await naive.completeTask();
  assert.equal((await naive.attempt(renewal)).approved, true);

  const hardened = await openCard(
    safePolicy({ budgetCents: USD(9), merchant: "saas-x" }),
  );
  await hardened.attempt(charge({ merchant: "saas-x" }));
  await hardened.completeTask();
  const blocked = await hardened.attempt(renewal);
  assert.equal(blocked.approved, false);
  assert.equal(blocked.decision.code, "TASK_COMPLETE");
});

test("TTL corta aunque la tarea siga abierta", () => {
  const policy = safePolicy({
    budgetCents: USD(50),
    merchant: "api-credits",
    ttlSeconds: 3600,
  });
  const late = charge({ at: new Date(t0.getTime() + 7200 * 1000) });
  assert.equal(evaluate(late, freshState(), policy).code, "EXPIRED");
});

test("contabilidad bruta: el refund no devuelve margen de gasto", async () => {
  const card = await openCard(
    safePolicy({ budgetCents: USD(10), merchant: "api-credits" }),
  );
  await card.attempt(charge());
  await card.attempt(
    charge({ kind: "refund", at: new Date(t0.getTime() + 60_000) }),
  );
  const rebuy = await card.attempt(
    charge({ at: new Date(t0.getTime() + 120_000) }),
  );
  assert.equal(rebuy.approved, false);
  assert.equal(rebuy.decision.code, "LIFETIME_EXCEEDED");
});

test("merchant fuera de la allowlist se rechaza", () => {
  const policy = safePolicy({ budgetCents: USD(50), merchant: "api-credits" });
  const decision = evaluate(charge({ merchant: "otro" }), freshState(), policy);
  assert.equal(decision.code, "MERCHANT_NOT_ALLOWED");
});

test("moneda distinta se rechaza: un cap en USD no limita otra moneda", () => {
  const policy = safePolicy({ budgetCents: USD(50), merchant: "api-credits" });
  const decision = evaluate(charge({ currency: "EUR" }), freshState(), policy);
  assert.equal(decision.code, "CURRENCY_NOT_ALLOWED");
});

test("MCC ausente se rechaza cuando hay allowlist de categoría", () => {
  const policy = safePolicy({
    budgetCents: USD(50),
    merchant: "api-credits",
    mcc: "5734",
  });
  assert.equal(
    evaluate(charge(), freshState(), policy).code,
    "MCC_NOT_ALLOWED",
  );
  assert.equal(
    evaluate(charge({ mcc: "5734" }), freshState(), policy).code,
    "ALLOWED",
  );
});

test("single-use cierra la tarjeta en el rail tras el primer cargo", async () => {
  const card = await openCard(
    safePolicy({ budgetCents: USD(50), merchant: "api-credits", singleUse: true }),
  );
  assert.equal((await card.attempt(charge())).approved, true);
  assert.equal(card.state.closed, true);
  const second = await card.attempt(
    charge({ at: new Date(t0.getTime() + 60_000) }),
  );
  assert.equal(second.approved, false);
  assert.equal(second.decision.code, "CARD_CLOSED");
});

test("kill switch corta todo", async () => {
  const card = await openCard(
    safePolicy({ budgetCents: USD(50), merchant: "api-credits" }),
  );
  await card.kill();
  const after = await card.attempt(charge());
  assert.equal(after.approved, false);
  assert.equal(after.decision.code, "KILL_SWITCH");
});

test("los recibos atribuyen cada cargo a su tarea", async () => {
  const card = await openCard(
    safePolicy({ budgetCents: USD(20), merchant: "api-credits" }),
  );
  await card.attempt(charge({ taskId: "task-42" }));
  const receipts = card.receipts();
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0]?.taskId, "task-42");
  assert.equal(receipts[0]?.amount, "USD 9.00");
});
