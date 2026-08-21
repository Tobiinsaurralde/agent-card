import { ControlledCard } from "../src/card.js";
import { permissivePolicy, safePolicy } from "../src/defaults.js";
import { MockProvider } from "../src/provider.js";
import type { AuthAttempt, CardPolicy, Cents } from "../src/types.js";

export type PolicyKind = "naive" | "hardened";

export interface AttemptLog {
  step: number;
  at: string;
  merchant: string;
  amountCents: Cents;
  currency: string;
  kind: AuthAttempt["kind"];
  approved: boolean;
  /** Código de nuestra policy. */
  policyCode: string;
  /** Código del rail, o null si la policy cortó antes de llamar. */
  providerCode: string | null;
  reason: string;
}

export interface ScenarioResult {
  scenarioId: string;
  policyKind: PolicyKind;
  /** Config exacta usada, para que el resultado sea reproducible. */
  policy: CardPolicy;
  attempts: AttemptLog[];
  approvedTotalCents: Cents;
  /** Techo que la config pretendía imponer. */
  intendedCapCents: Cents;
  /** El bypass funcionó: se gastó o se cobró más allá de lo que la config pretendía. */
  bypassSucceeded: boolean;
}

export interface Scenario {
  id: string;
  name: string;
  hypothesis: string;
  intendedCapCents: Cents;
  run(kind: PolicyKind): Promise<ScenarioResult>;
}

const USD = (dollars: number): Cents => Math.round(dollars * 100);

async function execute(
  scenarioId: string,
  kind: PolicyKind,
  policy: CardPolicy,
  intendedCapCents: Cents,
  fundedCents: Cents,
  script: Array<{ attempt: AuthAttempt; completeTaskBefore?: boolean }>,
): Promise<ScenarioResult> {
  const provider = new MockProvider();
  const card = await ControlledCard.open({
    provider,
    policy,
    fundedCents,
    // El emisor no impone nada por su cuenta: modela `transactionLimitsType: NA`.
    providerPerTransactionCents: null,
    now: script[0]?.attempt.at ?? new Date(),
  });

  const attempts: AttemptLog[] = [];
  let approvedTotal = 0;
  let step = 0;

  for (const line of script) {
    if (line.completeTaskBefore === true) await card.completeTask();

    const outcome = await card.attempt(line.attempt);
    step += 1;
    attempts.push({
      step,
      at: line.attempt.at.toISOString(),
      merchant: line.attempt.merchant,
      amountCents: line.attempt.amountCents,
      currency: line.attempt.currency,
      kind: line.attempt.kind,
      approved: outcome.approved,
      policyCode: outcome.decision.code,
      providerCode: outcome.provider?.code ?? null,
      reason: outcome.decision.allow
        ? (outcome.provider?.code ?? "sin respuesta del rail")
        : outcome.decision.reason,
    });
    if (outcome.approved && line.attempt.kind !== "refund") {
      approvedTotal += line.attempt.amountCents;
    }
  }

  return {
    scenarioId,
    policyKind: kind,
    policy,
    attempts,
    approvedTotalCents: approvedTotal,
    intendedCapCents,
    bypassSucceeded: approvedTotal > intendedCapCents,
  };
}

/**
 * Escenario 1 — Structuring.
 *
 * Con cap por transacción de USD 10 y sin cap acumulado, dos cargos de USD 9
 * gastan USD 18. Es el trap de `turnkey-agent-wallet` trasladado a tarjetas: el
 * cap que todo el mundo escribe primero limita el tamaño del cargo, no el gasto.
 */
export const structuring: Scenario = {
  id: "structuring",
  name: "Structuring: cargos chicos bajo el cap por transacción",
  hypothesis:
    "Con cap por transacción de USD 10 y sin cap acumulado, dos cargos de USD 9 gastan USD 18.",
  intendedCapCents: USD(10),
  async run(kind) {
    const t0 = new Date("2026-08-21T15:00:00Z");
    const merchant = "api-credits";
    const policy =
      kind === "naive"
        ? permissivePolicy(USD(10))
        : safePolicy({
            budgetCents: USD(10),
            merchant,
            perTransactionCents: USD(10),
          });

    const script = [0, 1].map((i) => ({
      attempt: {
        amountCents: USD(9),
        currency: "USD",
        merchant,
        kind: "capture" as const,
        at: new Date(t0.getTime() + i * 60_000),
        taskId: "task-comprar-creditos",
      },
    }));

    return execute(
      this.id,
      kind,
      policy,
      this.intendedCapCents,
      USD(20),
      script,
    );
  },
};

/**
 * Escenario 2 — Suscripción zombie.
 *
 * La tarea termina y la tarjeta sigue viva, así que la suscripción renueva para
 * siempre. Ojo: en la vida real esto tiene dependencia de calendario —la
 * renovación llega a los 30 días—, así que la medición con cargos reales necesita
 * o esperar, o el proxy rápido de un segundo cargo en el mismo merchant.
 */
export const zombieSubscription: Scenario = {
  id: "zombie-subscription",
  name: "Suscripción zombie: la tarjeta sobrevive a su tarea",
  hypothesis:
    "Terminada la tarea, la tarjeta sigue autorizando la renovación del mes siguiente.",
  intendedCapCents: USD(9),
  async run(kind) {
    const t0 = new Date("2026-08-21T15:00:00Z");
    const merchant = "saas-x";
    const policy =
      kind === "naive"
        ? permissivePolicy(USD(10))
        : safePolicy({
            budgetCents: USD(9),
            merchant,
            perTransactionCents: USD(9),
            ttlSeconds: 24 * 60 * 60,
          });

    const base = {
      amountCents: USD(9),
      currency: "USD",
      merchant,
      kind: "capture" as const,
      taskId: "task-suscribirse",
    };

    return execute(this.id, kind, policy, this.intendedCapCents, USD(50), [
      // Cargo legítimo: es para lo que se creó la tarjeta.
      { attempt: { ...base, at: t0 } },
      // La tarea terminó, y 30 días después el merchant renueva.
      {
        completeTaskBefore: true,
        attempt: {
          ...base,
          at: new Date(t0.getTime() + 30 * 24 * 60 * 60 * 1000),
        },
      },
    ]);
  },
};

export const scenarios: Scenario[] = [structuring, zombieSubscription];
