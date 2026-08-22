import { MockBrowser } from "../../src/browser.js";
import { ControlledCard } from "../../src/card.js";
import { safePolicy } from "../../src/defaults.js";
import { MockProvider } from "../../src/provider.js";
import type { CaptchaEvent, Cents, DecisionCode } from "../../src/types.js";

/**
 * Estado del panel del usuario.
 *
 * Corre sobre el motor real (`safePolicy` + `ControlledCard`), no sobre datos
 * inventados: cada aprobación y cada rechazo salen de `evaluate()`. Lo único
 * simulado es el rail —`MockProvider`— y el browser del checkout. Cuando exista
 * el adaptador de Interlace, se reemplazan esas dos piezas y el panel no cambia.
 */

export type CardStatus = "activa" | "cerrada" | "kill";

export interface AgentRow {
  id: string;
  name: string;
  purpose: string;
  activeCards: number;
  spentCents: Cents;
}

export interface CardRow {
  id: string;
  agentId: string;
  agentName: string;
  merchant: string;
  taskId: string;
  last4: string;
  budgetCents: Cents;
  spentCents: Cents;
  remainingCents: Cents;
  perTransactionCents: Cents;
  status: CardStatus;
  openedAt: Date;
  expiresAt: Date;
  ttlSeconds: number;
  singleUse: boolean;
  approvedCharges: number;
}

export interface ReceiptRow {
  id: number;
  at: Date;
  agentName: string;
  cardLast4: string;
  merchant: string;
  taskId: string;
  amountCents: Cents;
  approved: boolean;
  code: DecisionCode;
  reason: string;
  captcha: CaptchaEvent | null;
}

export interface Treasury {
  depositedCents: Cents;
  spentCents: Cents;
  /** Presupuesto de tarjetas vivas que todavía no se gastó. Puede salir. */
  committedCents: Cents;
  availableCents: Cents;
}

export interface IssueRequest {
  agentId: string;
  merchant: string;
  budgetCents: Cents;
  perTransactionCents: Cents;
  ttlHours: number;
  singleUse: boolean;
  taskId: string;
}

interface CardEntry {
  id: string;
  agentId: string;
  merchant: string;
  taskId: string;
  last4: string;
  budgetCents: Cents;
  perTransactionCents: Cents;
  ttlSeconds: number;
  singleUse: boolean;
  openedAt: Date;
  card: ControlledCard;
  killed: boolean;
}

interface AgentSeed {
  id: string;
  name: string;
  purpose: string;
}

const AGENTS: AgentSeed[] = [
  { id: "ag-research", name: "research-bot", purpose: "Compra créditos de API" },
  { id: "ag-infra", name: "infra-bot", purpose: "Provisiona cloud y dominios" },
  { id: "ag-ops", name: "ops-bot", purpose: "Renueva suscripciones de SaaS" },
];

export class PanelStore {
  private readonly provider = new MockProvider();
  private readonly browser = new MockBrowser();
  private readonly entries: CardEntry[] = [];
  private readonly receipts: ReceiptRow[] = [];
  private depositedCents: Cents = 0;
  private receiptSeq = 0;
  private cardSeq = 0;
  private seeded = false;
  killed = false;

  readonly agents: readonly AgentSeed[] = AGENTS;

  /** Devuelve `false` si ya se sembró. StrictMode monta dos veces en dev. */
  claimSeed(): boolean {
    if (this.seeded) return false;
    this.seeded = true;
    return true;
  }

  deposit(amountCents: Cents): void {
    if (amountCents <= 0) throw new Error("El depósito tiene que ser mayor a cero.");
    this.depositedCents += amountCents;
  }

  treasury(): Treasury {
    let spent = 0;
    let committed = 0;
    for (const entry of this.entries) {
      const entrySpent = spentOf(entry);
      spent += entrySpent;
      if (this.statusOf(entry) === "activa") {
        committed += Math.max(0, entry.budgetCents - entrySpent);
      }
    }
    return {
      depositedCents: this.depositedCents,
      spentCents: spent,
      committedCents: committed,
      availableCents: this.depositedCents - spent - committed,
    };
  }

  /**
   * Motivo por el que no se puede emitir, o `null` si se puede. El panel lo usa
   * para explicar antes de que el usuario apriete, no después.
   */
  issueBlocker(budgetCents: Cents): string | null {
    if (this.killed) return "El kill switch global está activo. Desactivalo para emitir.";
    if (budgetCents <= 0) return "El presupuesto tiene que ser mayor a cero.";
    const { availableCents } = this.treasury();
    if (budgetCents > availableCents) {
      return `No alcanza el saldo: hay ${usd(availableCents)} disponibles.`;
    }
    return null;
  }

  async issue(req: IssueRequest): Promise<CardRow> {
    const blocker = this.issueBlocker(req.budgetCents);
    if (blocker !== null) throw new Error(blocker);

    const policy = safePolicy({
      budgetCents: req.budgetCents,
      merchant: req.merchant,
      perTransactionCents: req.perTransactionCents,
      ttlSeconds: req.ttlHours * 3600,
      singleUse: req.singleUse,
    });

    const openedAt = new Date();
    const card = await ControlledCard.open({
      provider: this.provider,
      policy,
      fundedCents: req.budgetCents,
      providerPerTransactionCents: null,
      now: openedAt,
    });

    const entry: CardEntry = {
      id: `card-${++this.cardSeq}`,
      agentId: req.agentId,
      merchant: req.merchant,
      taskId: req.taskId,
      last4: String(1000 + Math.floor(Math.random() * 9000)),
      budgetCents: req.budgetCents,
      perTransactionCents: req.perTransactionCents,
      ttlSeconds: req.ttlHours * 3600,
      singleUse: req.singleUse,
      openedAt,
      card,
      killed: false,
    };
    this.entries.push(entry);
    return this.toRow(entry);
  }

  /**
   * Un cobro contra una tarjeta. Si el checkout traía captcha, el browser lo
   * resuelve antes y el evento queda pegado al recibo.
   */
  async charge(
    cardId: string,
    opts: { amountCents: Cents; merchant?: string; withCaptcha: boolean },
  ): Promise<ReceiptRow> {
    const entry = this.entries.find((e) => e.id === cardId);
    if (entry === undefined) throw new Error(`Tarjeta desconocida: ${cardId}`);

    const merchant = opts.merchant ?? entry.merchant;
    let captcha: CaptchaEvent | null = null;
    if (opts.withCaptcha) {
      const session = await this.browser.open({ merchant, taskId: entry.taskId });
      const events = await session.waitForCaptcha();
      captcha = events[0] ?? null;
      await session.close();
    }

    const at = new Date();
    const outcome = await entry.card.attempt({
      amountCents: opts.amountCents,
      currency: "USD",
      merchant,
      kind: "capture",
      at,
      taskId: entry.taskId,
    });

    const receipt: ReceiptRow = {
      id: ++this.receiptSeq,
      at,
      agentName: this.agentName(entry.agentId),
      cardLast4: entry.last4,
      merchant,
      taskId: entry.taskId,
      amountCents: opts.amountCents,
      approved: outcome.approved,
      code: outcome.decision.code,
      reason: outcome.decision.allow
        ? `El rail respondió ${outcome.provider?.code ?? "sin código"}.`
        : outcome.decision.reason,
      captcha,
    };
    this.receipts.push(receipt);
    return receipt;
  }

  async closeCard(cardId: string): Promise<void> {
    const entry = this.entries.find((e) => e.id === cardId);
    if (entry === undefined) return;
    await entry.card.close();
  }

  /** Kill switch global: mata todas las tarjetas vivas y bloquea la emisión. */
  async killAll(): Promise<number> {
    this.killed = true;
    let count = 0;
    for (const entry of this.entries) {
      if (entry.card.state.closed) continue;
      await entry.card.kill();
      entry.killed = true;
      count += 1;
    }
    return count;
  }

  releaseKill(): void {
    this.killed = false;
  }

  cards(): CardRow[] {
    return this.entries.map((entry) => this.toRow(entry)).reverse();
  }

  agentRows(): AgentRow[] {
    return AGENTS.map((agent) => {
      const owned = this.entries.filter((e) => e.agentId === agent.id);
      return {
        id: agent.id,
        name: agent.name,
        purpose: agent.purpose,
        activeCards: owned.filter((e) => this.statusOf(e) === "activa").length,
        spentCents: owned.reduce((sum, e) => sum + spentOf(e), 0),
      };
    });
  }

  receiptRows(): ReceiptRow[] {
    return [...this.receipts].reverse();
  }

  private statusOf(entry: CardEntry): CardStatus {
    if (entry.killed || entry.card.state.killed) return "kill";
    return entry.card.state.closed ? "cerrada" : "activa";
  }

  private agentName(agentId: string): string {
    return AGENTS.find((a) => a.id === agentId)?.name ?? agentId;
  }

  private toRow(entry: CardEntry): CardRow {
    const spent = spentOf(entry);
    return {
      id: entry.id,
      agentId: entry.agentId,
      agentName: this.agentName(entry.agentId),
      merchant: entry.merchant,
      taskId: entry.taskId,
      last4: entry.last4,
      budgetCents: entry.budgetCents,
      spentCents: spent,
      remainingCents: Math.max(0, entry.budgetCents - spent),
      perTransactionCents: entry.perTransactionCents,
      status: this.statusOf(entry),
      openedAt: entry.openedAt,
      expiresAt: new Date(entry.openedAt.getTime() + entry.ttlSeconds * 1000),
      ttlSeconds: entry.ttlSeconds,
      singleUse: entry.singleUse,
      approvedCharges: entry.card.state.charges.filter(
        (c) => c.allowed && c.kind !== "refund",
      ).length,
    };
  }
}

function spentOf(entry: CardEntry): Cents {
  return entry.card.committed;
}

export function usd(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}USD ${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function usdToCents(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (normalized === "") return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

/** Datos de arranque para que el panel no abra vacío. */
export async function seed(store: PanelStore): Promise<void> {
  if (!store.claimSeed()) return;
  store.deposit(50_00);

  const credits = await store.issue({
    agentId: "ag-research",
    merchant: "api-credits",
    budgetCents: 10_00,
    perTransactionCents: 10_00,
    ttlHours: 24,
    singleUse: false,
    taskId: "task-101",
  });
  await store.charge(credits.id, { amountCents: 9_00, withCaptcha: true });
  // El segundo cargo es el que cuenta la historia: structuring bloqueado.
  await store.charge(credits.id, { amountCents: 9_00, withCaptcha: false });

  const saas = await store.issue({
    agentId: "ag-ops",
    merchant: "saas-x",
    budgetCents: 12_00,
    perTransactionCents: 12_00,
    ttlHours: 24,
    singleUse: false,
    taskId: "task-102",
  });
  await store.charge(saas.id, { amountCents: 11_00, withCaptcha: false });
  await store.charge(saas.id, { amountCents: 4_00, merchant: "otro-comercio", withCaptcha: false });
}
