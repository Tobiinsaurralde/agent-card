import { ControlledCard } from "../src/card.js";
import { MockProvider } from "../src/provider.js";
import type { AuthKind, CardPolicy, Cents } from "../src/types.js";

export interface ScriptStep {
  amountCents: Cents;
  merchant: string;
  /** Días desde la emisión. Sirve para probar el TTL sin esperar. */
  dayOffset: number;
  currency?: string;
  kind?: AuthKind;
  /** Marcar la tarea como terminada justo antes de este intento. */
  completeTaskBefore?: boolean;
}

export interface LogRow {
  n: number;
  amountCents: Cents;
  merchant: string;
  currency: string;
  kind: AuthKind;
  dayOffset: number;
  approved: boolean;
  code: string;
  reason: string;
}

export interface Simulation {
  card: ControlledCard;
  rows: LogRow[];
  approvedCents: Cents;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function usdToCents(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (normalized === "") return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

export async function openCard(
  policy: CardPolicy,
  fundedCents: Cents,
  openedAt: Date,
): Promise<ControlledCard> {
  return ControlledCard.open({
    provider: new MockProvider(),
    policy,
    fundedCents,
    // El emisor no impone nada por su cuenta: la tarjeta gasta contra el balance.
    providerPerTransactionCents: null,
    now: openedAt,
  });
}

/** Corre un intento sobre una tarjeta viva y devuelve la fila para el timeline. */
export async function runStep(
  card: ControlledCard,
  step: ScriptStep,
  n: number,
): Promise<LogRow> {
  if (step.completeTaskBefore === true) await card.completeTask();

  const kind: AuthKind = step.kind ?? "capture";
  const currency = step.currency ?? "USD";
  const outcome = await card.attempt({
    amountCents: step.amountCents,
    currency,
    merchant: step.merchant,
    kind,
    at: new Date(card.state.openedAt.getTime() + step.dayOffset * DAY_MS),
    taskId: "task-demo",
  });

  return {
    n,
    amountCents: step.amountCents,
    merchant: step.merchant,
    currency,
    kind,
    dayOffset: step.dayOffset,
    approved: outcome.approved,
    code: outcome.decision.code,
    reason: outcome.decision.allow
      ? `The rail replied ${outcome.provider?.code ?? "no code"}.`
      : outcome.decision.reason,
  };
}

export async function simulate(
  policy: CardPolicy,
  fundedCents: Cents,
  script: ScriptStep[],
  openedAt = new Date("2026-08-21T15:00:00Z"),
): Promise<Simulation> {
  const card = await openCard(policy, fundedCents, openedAt);
  const rows: LogRow[] = [];
  let approvedCents = 0;

  for (const [index, step] of script.entries()) {
    const row = await runStep(card, step, index + 1);
    rows.push(row);
    if (row.approved && row.kind !== "refund") approvedCents += row.amountCents;
  }

  return { card, rows, approvedCents };
}

export interface ScenarioDef {
  id: "structuring" | "zombie";
  name: string;
  hypothesis: string;
  /** Lo que la config pretendía que fuera el techo de gasto. */
  intendedCapCents: Cents;
  budgetCents: Cents;
  perTransactionCents: Cents;
  merchant: string;
  fundedCents: Cents;
  ttlHours: number;
  script: ScriptStep[];
}

export const scenarioDefs: ScenarioDef[] = [
  {
    id: "structuring",
    name: "Structuring",
    hypothesis:
      "With a USD 10 per-transaction cap and no lifetime cap, two USD 9 charges spend USD 18.",
    intendedCapCents: 1000,
    budgetCents: 1000,
    perTransactionCents: 1000,
    merchant: "api-credits",
    fundedCents: 2000,
    ttlHours: 24,
    script: [
      { amountCents: 900, merchant: "api-credits", dayOffset: 0 },
      { amountCents: 900, merchant: "api-credits", dayOffset: 0 },
    ],
  },
  {
    id: "zombie",
    name: "Zombie subscription",
    hypothesis:
      "The task ends, the card stays alive and the SaaS keeps charging the next month.",
    intendedCapCents: 900,
    budgetCents: 900,
    perTransactionCents: 900,
    merchant: "saas-x",
    fundedCents: 5000,
    ttlHours: 24,
    script: [
      { amountCents: 900, merchant: "saas-x", dayOffset: 0 },
      {
        amountCents: 900,
        merchant: "saas-x",
        dayOffset: 30,
        completeTaskBefore: true,
      },
    ],
  },
];
