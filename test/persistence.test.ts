import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CardCredentials } from "../src/credentials.js";
import { EnvCardProvider } from "../src/providers/env-card.js";
import { AgentCardService } from "../src/service.js";
import { FileStore, StateFileError } from "../src/store.js";

/**
 * El ledger tiene que sobrevivir a un reinicio.
 *
 * Sin esto los topes son decorativos: bajar el proceso y volver a levantarlo
 * borra lo gastado y recarga el presupuesto, así que el cap se limpia solo. Estos
 * tests existen para que ese agujero no vuelva.
 */

/** Un reinicio: proceso nuevo, emisor nuevo, y sólo el archivo en el medio. */
function restart(service: AgentCardService): AgentCardService {
  const revived = new AgentCardService();
  revived.restore(service.snapshot());
  return revived;
}

function tmpFile(name = "state.json"): string {
  return join(mkdtempSync(join(tmpdir(), "agent-card-")), name);
}

test("reiniciar no borra lo gastado", async () => {
  const before = new AgentCardService();
  before.deposit(50_00);
  const issued = await before.requestCard({
    merchant: "api-credits",
    budgetCents: 10_00,
    taskId: "task-1",
  });
  await before.recordCharge({ handle: issued.handle, amountCents: 6_00 });

  const after = restart(before);

  assert.equal(after.budget().spentCents, 6_00);
  assert.equal(after.cardStatus(issued.handle).spentCents, 6_00);
  assert.equal(after.cardStatus(issued.handle).remainingCents, 4_00);
});

test("reiniciar no recarga el presupuesto", () => {
  const before = new AgentCardService();
  before.deposit(50_00);

  const after = restart(before);

  // El depósito es un hecho del pasado, no algo que pasa en cada arranque.
  assert.equal(after.budget().depositedCents, 50_00);
});

test("structuring no sobrevive a un reinicio: el cap sigue contando lo ya gastado", async () => {
  const before = new AgentCardService();
  before.deposit(50_00);
  const issued = await before.requestCard({
    merchant: "api-credits",
    budgetCents: 10_00,
    taskId: "task-1",
  });
  const first = await before.recordCharge({ handle: issued.handle, amountCents: 9_00 });
  assert.equal(first.approved, true);

  // Reiniciar era la forma de limpiar el cap. Ya no.
  const after = restart(before);

  const second = await after.recordCharge({ handle: issued.handle, amountCents: 9_00 });
  assert.equal(second.approved, false);
  assert.equal(second.code, "LIFETIME_EXCEEDED");
  assert.equal(after.budget().spentCents, 9_00);
});

test("el kill switch sigue activo después de reiniciar", async () => {
  const before = new AgentCardService();
  before.deposit(50_00);
  await before.killAll();

  const after = restart(before);

  assert.equal(after.killed, true);
  await assert.rejects(() =>
    after.requestCard({ merchant: "api-credits", budgetCents: 5_00, taskId: "task-1" }),
  );
});

test("una tarjeta cerrada sigue cerrada después de reiniciar", async () => {
  const before = new AgentCardService();
  before.deposit(50_00);
  const issued = await before.requestCard({
    merchant: "api-credits",
    budgetCents: 10_00,
    taskId: "task-1",
  });
  await before.closeCard(issued.handle);

  const after = restart(before);

  assert.equal(after.cardStatus(issued.handle).status, "cerrada");
  const charge = await after.recordCharge({ handle: issued.handle, amountCents: 1_00 });
  assert.equal(charge.approved, false);
  assert.equal(charge.code, "CARD_CLOSED");
});

test("el emisor también vuelve: una tarjeta restaurada se puede seguir cobrando", async () => {
  const before = new AgentCardService();
  before.deposit(50_00);
  const issued = await before.requestCard({
    merchant: "api-credits",
    budgetCents: 10_00,
    taskId: "task-1",
  });

  const after = restart(before);

  // Si el emisor no se restaurara, el id de la tarjeta le sería desconocido y
  // esto explotaría en vez de contestar una decisión.
  const charge = await after.recordCharge({ handle: issued.handle, amountCents: 3_00 });
  assert.equal(charge.approved, true);
});

test("los recibos sobreviven con su motivo y su fecha", async () => {
  const before = new AgentCardService();
  before.deposit(50_00);
  const issued = await before.requestCard({
    merchant: "api-credits",
    budgetCents: 10_00,
    taskId: "task-1",
  });
  await before.recordCharge({ handle: issued.handle, amountCents: 20_00 });

  const after = restart(before);

  const [receipt] = after.listCharges();
  assert.ok(receipt !== undefined);
  assert.equal(receipt.approved, false);
  assert.equal(receipt.code, "PER_TX_EXCEEDED");
  assert.ok(receipt.at instanceof Date);
  assert.equal(after.cardStatus(issued.handle).lastDenial?.code, "PER_TX_EXCEEDED");
});

test("el archivo guardado no tiene el número de la tarjeta", async () => {
  const pan = "4111111111111111";
  const provider = EnvCardProvider.forTesting(
    CardCredentials.forTesting({
      pan,
      cvc: "123",
      expMonth: "09",
      expYear: "2030",
      name: "Test Titular",
    }),
  );
  const service = new AgentCardService({ provider });
  service.deposit(50_00);
  const issued = await service.requestCard({
    merchant: "api-credits",
    budgetCents: 10_00,
    taskId: "task-1",
  });
  await service.recordCharge({ handle: issued.handle, amountCents: 5_00 });

  const path = tmpFile();
  new FileStore(path).save(service.snapshot());
  const written = readFileSync(path, "utf8");

  assert.ok(!written.includes(pan), "el PAN no puede terminar en disco");
  assert.ok(!written.includes("123"), "el CVC tampoco");
});

test("ida y vuelta por disco: el ledger vuelve igual", async () => {
  const service = new AgentCardService();
  service.deposit(50_00);
  const issued = await service.requestCard({
    merchant: "api-credits",
    budgetCents: 10_00,
    taskId: "task-1",
  });
  await service.recordCharge({ handle: issued.handle, amountCents: 4_00 });

  const path = tmpFile();
  const store = new FileStore(path);
  store.save(service.snapshot());

  const loaded = store.load();
  assert.ok(loaded !== null);
  const revived = new AgentCardService();
  revived.restore(loaded);

  assert.equal(revived.budget().spentCents, 4_00);
  assert.equal(revived.cardStatus(issued.handle).merchant, "api-credits");
  assert.ok(revived.cardStatus(issued.handle).openedAt instanceof Date);
});

test("un ledger corrupto no arranca de cero en silencio", () => {
  const path = tmpFile();
  writeFileSync(path, "{ esto no es json", "utf8");

  // Empezar de cero acá sería recargar el presupuesto y perder lo gastado,
  // justo cuando algo ya salió mal. Mejor no arrancar.
  assert.throws(() => new FileStore(path).load(), StateFileError);
});

test("un ledger de otra versión tampoco se interpreta a la fuerza", () => {
  const path = tmpFile();
  writeFileSync(path, JSON.stringify({ version: 99, savedAt: "", state: {} }), "utf8");

  assert.throws(() => new FileStore(path).load(), StateFileError);
});

test("sin archivo todavía, es un arranque limpio y no un error", () => {
  const path = tmpFile("todavia-no-existe.json");
  assert.equal(new FileStore(path).load(), null);
});

test("cada cambio avisa para que alguien lo guarde", async () => {
  let avisos = 0;
  const service = new AgentCardService({ onChange: () => { avisos += 1; } });

  service.deposit(50_00);
  const issued = await service.requestCard({
    merchant: "api-credits",
    budgetCents: 10_00,
    taskId: "task-1",
  });
  await service.recordCharge({ handle: issued.handle, amountCents: 1_00 });
  await service.closeCard(issued.handle);

  assert.equal(avisos, 4);
});

test("consultar no avisa: un preflight no cambia nada", async () => {
  let avisos = 0;
  const service = new AgentCardService({ onChange: () => { avisos += 1; } });
  service.deposit(50_00);
  const issued = await service.requestCard({
    merchant: "api-credits",
    budgetCents: 10_00,
    taskId: "task-1",
  });
  avisos = 0;

  service.checkCharge({ handle: issued.handle, amountCents: 5_00 });
  service.budget();
  service.listCards();
  service.cardStatus(issued.handle);

  assert.equal(avisos, 0);
});
