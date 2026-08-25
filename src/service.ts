import { MockBrowser, type CheckoutBrowser, type CheckoutSession } from "./browser.js";
import { ControlledCard } from "./card.js";
import { safePolicy } from "./defaults.js";
import { fmt } from "./policy.js";
import { MockProvider, type CardProvider, type ProviderCredentialGrant } from "./provider.js";
import type { AuthKind, CaptchaEvent, Cents, Decision, DecisionCode } from "./types.js";

/**
 * El servicio: una sola fuente de verdad para el servidor MCP y el panel.
 *
 * Es provider-agnostic a propósito. El rail entra por `CardProvider` y el
 * checkout por `CheckoutBrowser`, así que cambiar de `MockProvider` a Interlace
 * no toca nada de acá.
 *
 * Lo que este servicio **no** puede hacer, y conviene tenerlo claro: no está en
 * el camino de la autorización. Con un emisor real, la red le pregunta al emisor,
 * no a nosotros. El enforcement de verdad son los caps que configuramos en la
 * tarjeta al emitirla; `checkCharge` es un preflight y `recordCharge` es el
 * recibo. Ver docs/spec.md §3.3.
 */

export type CardStatusKind = "activa" | "cerrada" | "kill" | "expirada";

export interface Treasury {
  depositedCents: Cents;
  spentCents: Cents;
  /** Presupuesto de tarjetas vivas todavía sin gastar. Puede salir. */
  committedCents: Cents;
  availableCents: Cents;
}

export interface CardRequest {
  merchant: string;
  budgetCents: Cents;
  taskId: string;
  perTransactionCents?: Cents;
  ttlSeconds?: number;
  singleUse?: boolean;
  mcc?: string;
  agentId?: string;
  /** Por qué el agente pide la tarjeta. Va en el recibo. */
  reason?: string;
}

export interface IssuedCard {
  handle: string;
  agentId: string;
  taskId: string;
  merchant: string;
  reason: string | null;
  budgetCents: Cents;
  perTransactionCents: Cents;
  ttlSeconds: number;
  singleUse: boolean;
  last4: string;
  openedAt: Date;
  expiresAt: Date;
}

export interface ChargeRequest {
  handle: string;
  amountCents: Cents;
  merchant?: string;
  currency?: string;
  mcc?: string;
  kind?: AuthKind;
  at?: Date;
}

export interface Receipt {
  id: number;
  at: Date;
  handle: string;
  agentId: string;
  taskId: string;
  cardLast4: string;
  merchant: string;
  amountCents: Cents;
  currency: string;
  kind: AuthKind;
  approved: boolean;
  code: DecisionCode;
  reason: string;
  captcha: CaptchaEvent | null;
}

export interface CardStatus extends IssuedCard {
  status: CardStatusKind;
  spentCents: Cents;
  remainingCents: Cents;
  approvedCharges: number;
  attempts: number;
  lastDenial: { code: DecisionCode; reason: string; at: Date } | null;
}

export interface ServiceOptions {
  provider?: CardProvider;
  browser?: CheckoutBrowser;
  now?: () => Date;
  /**
   * Techo por tarjeta. La beta de Interlace corta en USD 20 por tarjeta, y en el
   * test conviene que ese techo sea explícito y no una sorpresa del rail.
   */
  maxCardBudgetCents?: Cents;
}

interface Entry {
  handle: string;
  agentId: string;
  taskId: string;
  merchant: string;
  reason: string | null;
  budgetCents: Cents;
  perTransactionCents: Cents;
  ttlSeconds: number;
  singleUse: boolean;
  last4: string;
  openedAt: Date;
  card: ControlledCard;
  killed: boolean;
}

/** Error con un código estable, para que el agente pueda ramificar sin parsear texto. */
export class ServiceError extends Error {
  constructor(
    readonly code:
      | "UNKNOWN_CARD"
      | "KILL_SWITCH_ACTIVE"
      | "INSUFFICIENT_BUDGET"
      | "OVER_MAX_CARD_BUDGET"
      | "INVALID_POLICY"
      | "CARD_CLOSED"
      | "PROVIDER_UNSUPPORTED",
    message: string,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export class AgentCardService {
  private readonly provider: CardProvider;
  private readonly browser: CheckoutBrowser;
  private readonly now: () => Date;
  private readonly maxCardBudgetCents: Cents;
  private readonly entries = new Map<string, Entry>();
  private readonly receipts: Receipt[] = [];
  private depositedCents: Cents = 0;
  private receiptSeq = 0;
  killed = false;

  constructor(opts: ServiceOptions = {}) {
    this.provider = opts.provider ?? new MockProvider();
    this.browser = opts.browser ?? new MockBrowser();
    this.now = opts.now ?? (() => new Date());
    this.maxCardBudgetCents = opts.maxCardBudgetCents ?? 20_00;
  }

  get providerName(): string {
    return this.provider.name;
  }

  deposit(amountCents: Cents): Treasury {
    if (amountCents <= 0) {
      throw new ServiceError("INVALID_POLICY", "El depósito tiene que ser mayor a cero.");
    }
    this.depositedCents += amountCents;
    return this.budget();
  }

  budget(): Treasury {
    let spent = 0;
    let committed = 0;
    for (const entry of this.entries.values()) {
      const entrySpent = entry.card.committed;
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

  async requestCard(req: CardRequest): Promise<IssuedCard> {
    if (this.killed) {
      throw new ServiceError(
        "KILL_SWITCH_ACTIVE",
        "El kill switch global está activo. No se emiten tarjetas hasta que se desactive.",
      );
    }
    if (req.budgetCents > this.maxCardBudgetCents) {
      throw new ServiceError(
        "OVER_MAX_CARD_BUDGET",
        `El presupuesto ${fmt(req.budgetCents)} supera el techo por tarjeta de ${fmt(this.maxCardBudgetCents)}.`,
      );
    }
    const { availableCents } = this.budget();
    if (req.budgetCents > availableCents) {
      throw new ServiceError(
        "INSUFFICIENT_BUDGET",
        `No alcanza el saldo: hay ${fmt(availableCents)} disponibles y se pidieron ${fmt(req.budgetCents)}.`,
      );
    }

    // safePolicy tira si falta el cap acumulado o el merchant. Ese error es el
    // producto: acá no se puede emitir una tarjeta sin techo.
    let policy;
    try {
      policy = safePolicy({
        budgetCents: req.budgetCents,
        merchant: req.merchant,
        ...(req.perTransactionCents !== undefined
          ? { perTransactionCents: req.perTransactionCents }
          : {}),
        ...(req.ttlSeconds !== undefined ? { ttlSeconds: req.ttlSeconds } : {}),
        ...(req.singleUse !== undefined ? { singleUse: req.singleUse } : {}),
        ...(req.mcc !== undefined ? { mcc: req.mcc } : {}),
      });
    } catch (error) {
      throw new ServiceError(
        "INVALID_POLICY",
        error instanceof Error ? error.message : String(error),
      );
    }

    const openedAt = this.now();
    const card = await ControlledCard.open({
      provider: this.provider,
      policy,
      fundedCents: req.budgetCents,
      // El emisor no impone nada por su cuenta: modela transactionLimitsType NA.
      providerPerTransactionCents: null,
      now: openedAt,
    });

    const entry: Entry = {
      handle: newHandle(),
      agentId: req.agentId ?? "default",
      taskId: req.taskId,
      merchant: req.merchant,
      reason: req.reason ?? null,
      budgetCents: req.budgetCents,
      perTransactionCents: policy.perTransactionCents ?? req.budgetCents,
      ttlSeconds: policy.ttlSeconds ?? 24 * 60 * 60,
      singleUse: policy.singleUse,
      // Si el emisor da los últimos cuatro, son los del plástico de verdad y el
      // recibo se puede conciliar contra el resumen. El azar es solo el fallback
      // del mock, donde no hay nada que conciliar.
      last4: card.providerLast4 ?? newLast4(),
      openedAt,
      card,
      killed: false,
    };
    this.entries.set(entry.handle, entry);
    return this.toIssued(entry);
  }

  /**
   * Permiso para pedirle el PAN al emisor. Devuelve un endpoint y un token de
   * vida corta, nunca el número: el PAN no pasa por nuestro backend.
   */
  async credentialGrant(handle: string): Promise<ProviderCredentialGrant> {
    const entry = this.require(handle);
    if (this.statusOf(entry) !== "activa") {
      throw new ServiceError(
        "CARD_CLOSED",
        `La tarjeta ${handle} no está activa (${this.statusOf(entry)}).`,
      );
    }
    if (this.provider.credentialGrant === undefined) {
      throw new ServiceError(
        "PROVIDER_UNSUPPORTED",
        `El proveedor ${this.provider.name} no expone entrega directa del PAN.`,
      );
    }
    return this.provider.credentialGrant(entry.card.providerCardId);
  }

  /**
   * Preflight: qué diría la policy si este cargo llegara ahora. No toca el rail
   * ni deja recibo, así que el agente puede preguntar antes de ir al checkout.
   */
  checkCharge(req: ChargeRequest): Decision {
    const entry = this.require(req.handle);
    return entry.card.wouldAllow({
      amountCents: req.amountCents,
      currency: req.currency ?? "USD",
      merchant: req.merchant ?? entry.merchant,
      kind: req.kind ?? "capture",
      at: req.at ?? this.now(),
      ...(req.mcc !== undefined ? { mcc: req.mcc } : {}),
      taskId: entry.taskId,
    });
  }

  /** El cargo de verdad: la policy decide, el rail responde y queda el recibo. */
  async recordCharge(
    req: ChargeRequest & { captcha?: CaptchaEvent | null },
  ): Promise<Receipt> {
    const entry = this.require(req.handle);
    const at = req.at ?? this.now();
    const currency = req.currency ?? "USD";
    const kind = req.kind ?? "capture";
    const merchant = req.merchant ?? entry.merchant;

    const outcome = await entry.card.attempt({
      amountCents: req.amountCents,
      currency,
      merchant,
      kind,
      at,
      ...(req.mcc !== undefined ? { mcc: req.mcc } : {}),
      taskId: entry.taskId,
    });

    const receipt: Receipt = {
      id: ++this.receiptSeq,
      at,
      handle: entry.handle,
      agentId: entry.agentId,
      taskId: entry.taskId,
      cardLast4: entry.last4,
      merchant,
      amountCents: req.amountCents,
      currency,
      kind,
      approved: outcome.approved,
      code: outcome.decision.code,
      reason: outcome.decision.allow
        ? `El rail respondió ${outcome.provider?.code ?? "sin código"}.`
        : outcome.decision.reason,
      captcha: req.captcha ?? null,
    };
    this.receipts.push(receipt);
    return receipt;
  }

  /** Abre el checkout en el browser, con el captcha prendido. Ver spec §3.4. */
  async openCheckout(handle: string): Promise<CheckoutSession> {
    const entry = this.require(handle);
    if (this.statusOf(entry) !== "activa") {
      throw new ServiceError(
        "CARD_CLOSED",
        `La tarjeta ${handle} no está activa (${this.statusOf(entry)}).`,
      );
    }
    return this.browser.open({ merchant: entry.merchant, taskId: entry.taskId });
  }

  cardStatus(handle: string): CardStatus {
    return this.toStatus(this.require(handle));
  }

  listCards(filter: { taskId?: string; agentId?: string; onlyActive?: boolean } = {}): CardStatus[] {
    const out: CardStatus[] = [];
    for (const entry of this.entries.values()) {
      if (filter.taskId !== undefined && entry.taskId !== filter.taskId) continue;
      if (filter.agentId !== undefined && entry.agentId !== filter.agentId) continue;
      if (filter.onlyActive === true && this.statusOf(entry) !== "activa") continue;
      out.push(this.toStatus(entry));
    }
    return out.reverse();
  }

  listCharges(
    filter: { handle?: string; taskId?: string; agentId?: string; onlyApproved?: boolean } = {},
  ): Receipt[] {
    return this.receipts
      .filter((r) => {
        if (filter.handle !== undefined && r.handle !== filter.handle) return false;
        if (filter.taskId !== undefined && r.taskId !== filter.taskId) return false;
        if (filter.agentId !== undefined && r.agentId !== filter.agentId) return false;
        if (filter.onlyApproved === true && !r.approved) return false;
        return true;
      })
      .reverse();
  }

  async closeCard(handle: string): Promise<CardStatus> {
    const entry = this.require(handle);
    await entry.card.close();
    return this.toStatus(entry);
  }

  /**
   * La tarea terminó. Con `closeOnTaskComplete` esto mata las tarjetas de esa
   * tarea, que es lo que corta la suscripción zombie.
   */
  async completeTask(taskId: string): Promise<number> {
    let closed = 0;
    for (const entry of this.entries.values()) {
      if (entry.taskId !== taskId) continue;
      if (entry.card.state.closed) continue;
      await entry.card.completeTask();
      closed += 1;
    }
    return closed;
  }

  async killAll(): Promise<number> {
    this.killed = true;
    let count = 0;
    for (const entry of this.entries.values()) {
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

  private require(handle: string): Entry {
    const entry = this.entries.get(handle);
    if (entry === undefined) {
      throw new ServiceError("UNKNOWN_CARD", `No existe la tarjeta ${handle}.`);
    }
    return entry;
  }

  private statusOf(entry: Entry): CardStatusKind {
    if (entry.killed || entry.card.state.killed) return "kill";
    if (entry.card.state.closed) return "cerrada";
    const ageSeconds = (this.now().getTime() - entry.openedAt.getTime()) / 1000;
    if (ageSeconds > entry.ttlSeconds) return "expirada";
    return "activa";
  }

  private toIssued(entry: Entry): IssuedCard {
    return {
      handle: entry.handle,
      agentId: entry.agentId,
      taskId: entry.taskId,
      merchant: entry.merchant,
      reason: entry.reason,
      budgetCents: entry.budgetCents,
      perTransactionCents: entry.perTransactionCents,
      ttlSeconds: entry.ttlSeconds,
      singleUse: entry.singleUse,
      last4: entry.last4,
      openedAt: entry.openedAt,
      expiresAt: new Date(entry.openedAt.getTime() + entry.ttlSeconds * 1000),
    };
  }

  private toStatus(entry: Entry): CardStatus {
    const spent = entry.card.committed;
    const denials = entry.card
      .history()
      .filter((o) => !o.decision.allow)
      .at(-1);
    return {
      ...this.toIssued(entry),
      status: this.statusOf(entry),
      spentCents: spent,
      remainingCents: Math.max(0, entry.budgetCents - spent),
      approvedCharges: entry.card.state.charges.filter(
        (c) => c.allowed && c.kind !== "refund",
      ).length,
      attempts: entry.card.state.charges.length,
      lastDenial:
        denials === undefined
          ? null
          : {
              code: denials.decision.code,
              reason: denials.decision.reason,
              at: denials.attempt.at,
            },
    };
  }
}

function newHandle(): string {
  return `crd_${randomHex(12)}`;
}

function newLast4(): string {
  return String(1000 + Math.floor(Math.random() * 9000));
}

function randomHex(chars: number): string {
  let out = "";
  while (out.length < chars) out += Math.random().toString(16).slice(2);
  return out.slice(0, chars);
}
