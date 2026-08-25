import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentCardService, ServiceError } from "../src/service.js";

function svc(depositCents = 50_00, opts: { now?: () => Date } = {}) {
  const service = new AgentCardService(opts);
  service.deposit(depositCents);
  return service;
}

async function card(service: AgentCardService, over: Partial<Parameters<AgentCardService["requestCard"]>[0]> = {}) {
  return service.requestCard({
    merchant: "api-credits",
    budgetCents: 10_00,
    taskId: "task-1",
    ...over,
  });
}

test("no se puede emitir sin merchant: la allowlist es obligatoria", async () => {
  const service = svc();
  await assert.rejects(
    () => card(service, { merchant: "  " }),
    (error: unknown) => {
      assert.ok(error instanceof ServiceError);
      assert.equal(error.code, "INVALID_POLICY");
      return true;
    },
  );
});

test("el presupuesto de la tarjeta no puede superar el saldo disponible", async () => {
  const service = svc(5_00);
  await assert.rejects(
    () => card(service, { budgetCents: 10_00 }),
    (error: unknown) => {
      assert.ok(error instanceof ServiceError);
      assert.equal(error.code, "INSUFFICIENT_BUDGET");
      return true;
    },
  );
});

test("el techo por tarjeta se respeta: ninguna nace con más de USD 20", async () => {
  const service = svc(100_00);
  await assert.rejects(
    () => card(service, { budgetCents: 25_00 }),
    (error: unknown) => {
      assert.ok(error instanceof ServiceError);
      assert.equal(error.code, "OVER_MAX_CARD_BUDGET");
      return true;
    },
  );
});

test("structuring: dos cargos de USD 9 contra un cap de USD 10 no pasan", async () => {
  const service = svc();
  const issued = await card(service);

  const first = await service.recordCharge({ handle: issued.handle, amountCents: 9_00 });
  assert.equal(first.approved, true);

  const second = await service.recordCharge({ handle: issued.handle, amountCents: 9_00 });
  assert.equal(second.approved, false);
  assert.equal(second.code, "LIFETIME_EXCEEDED");
});

test("el preflight no gasta: consultar mil veces no mueve el acumulado", async () => {
  const service = svc();
  const issued = await card(service);

  for (let i = 0; i < 1000; i += 1) {
    const decision = service.checkCharge({ handle: issued.handle, amountCents: 9_00 });
    assert.equal(decision.allow, true);
  }

  assert.equal(service.cardStatus(issued.handle).spentCents, 0);
  assert.equal(service.listCharges().length, 0);

  // Y el cargo real sigue entrando: el preflight no consumió nada.
  const receipt = await service.recordCharge({ handle: issued.handle, amountCents: 9_00 });
  assert.equal(receipt.approved, true);
});

test("el preflight avisa del rechazo sin dejarlo en el historial del emisor", async () => {
  const service = svc();
  const issued = await card(service);
  const decision = service.checkCharge({
    handle: issued.handle,
    amountCents: 9_00,
    merchant: "otro-comercio",
  });
  assert.equal(decision.allow, false);
  assert.equal(decision.code, "MERCHANT_NOT_ALLOWED");
  assert.equal(service.listCharges().length, 0);
});

test("complete_task mata la suscripción zombie", async () => {
  const service = svc();
  const issued = await card(service, { budgetCents: 9_00 });
  await service.recordCharge({ handle: issued.handle, amountCents: 4_00 });

  const closed = await service.completeTask("task-1");
  assert.equal(closed, 1);

  const renewal = await service.recordCharge({ handle: issued.handle, amountCents: 4_00 });
  assert.equal(renewal.approved, false);
  assert.equal(renewal.code, "TASK_COMPLETE");
});

test("el kill switch mata lo vivo y bloquea la emisión", async () => {
  const service = svc();
  const issued = await card(service);
  assert.equal(await service.killAll(), 1);

  assert.equal(service.cardStatus(issued.handle).status, "kill");
  await assert.rejects(
    () => card(service, { taskId: "task-2" }),
    (error: unknown) => {
      assert.ok(error instanceof ServiceError);
      assert.equal(error.code, "KILL_SWITCH_ACTIVE");
      return true;
    },
  );
});

test("el grant de credenciales no trae el PAN y muere con la tarjeta", async () => {
  const service = svc();
  const issued = await card(service);

  const grant = await service.credentialGrant(issued.handle);
  assert.equal(grant.provider, "mock");
  assert.ok(grant.token.length > 0);
  assert.ok(grant.expiresAt.getTime() > Date.now());
  // Nada que se parezca a un número de tarjeta en ningún campo del grant.
  assert.doesNotMatch(JSON.stringify(grant), /\d{13,19}/);

  await service.closeCard(issued.handle);
  await assert.rejects(
    () => service.credentialGrant(issued.handle),
    (error: unknown) => {
      assert.ok(error instanceof ServiceError);
      assert.equal(error.code, "CARD_CLOSED");
      return true;
    },
  );
});

test("la tesorería libera lo comprometido cuando la tarjeta se cierra", async () => {
  const service = svc(50_00);
  const issued = await card(service, { budgetCents: 10_00 });

  let budget = service.budget();
  assert.equal(budget.committedCents, 10_00);
  assert.equal(budget.availableCents, 40_00);

  await service.recordCharge({ handle: issued.handle, amountCents: 4_00 });
  budget = service.budget();
  assert.equal(budget.spentCents, 4_00);
  assert.equal(budget.committedCents, 6_00, "queda comprometido lo no gastado");
  assert.equal(budget.availableCents, 40_00);

  await service.closeCard(issued.handle);
  budget = service.budget();
  assert.equal(budget.committedCents, 0);
  assert.equal(budget.availableCents, 46_00, "vuelve lo que la tarjeta ya no puede gastar");
});

test("el TTL vence la tarjeta sin tocarla", async () => {
  let clock = new Date("2026-08-22T12:00:00Z");
  const service = svc(50_00, { now: () => clock });
  const issued = await card(service, { ttlSeconds: 3600 });

  assert.equal(service.cardStatus(issued.handle).status, "activa");
  clock = new Date("2026-08-22T14:00:00Z");
  assert.equal(service.cardStatus(issued.handle).status, "expirada");

  const late = await service.recordCharge({ handle: issued.handle, amountCents: 1_00 });
  assert.equal(late.approved, false);
  assert.equal(late.code, "EXPIRED");
});

test("card_status guarda el último rechazo con su motivo", async () => {
  const service = svc();
  const issued = await card(service);
  await service.recordCharge({
    handle: issued.handle,
    amountCents: 1_00,
    merchant: "casino-online",
  });

  const status = service.cardStatus(issued.handle);
  assert.equal(status.lastDenial?.code, "MERCHANT_NOT_ALLOWED");
  assert.match(status.lastDenial?.reason ?? "", /casino-online/);
});

test("un handle desconocido es un error con código, no un crash", () => {
  const service = svc();
  assert.throws(
    () => service.cardStatus("crd_noexiste"),
    (error: unknown) => {
      assert.ok(error instanceof ServiceError);
      assert.equal(error.code, "UNKNOWN_CARD");
      return true;
    },
  );
});

test("los recibos atribuyen cada cobro a su tarea", async () => {
  const service = svc();
  const a = await card(service, { taskId: "task-a", budgetCents: 5_00 });
  const b = await card(service, { taskId: "task-b", budgetCents: 5_00, merchant: "saas-x" });

  await service.recordCharge({ handle: a.handle, amountCents: 2_00 });
  await service.recordCharge({ handle: b.handle, amountCents: 3_00 });

  const onlyA = service.listCharges({ taskId: "task-a" });
  assert.equal(onlyA.length, 1);
  assert.equal(onlyA[0]?.merchant, "api-credits");
  assert.equal(service.listCharges().length, 2);
});
