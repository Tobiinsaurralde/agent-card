import { evaluate, committedCents, fmt } from "./policy.js";
import type { CardProvider, ProviderResult } from "./provider.js";
import type {
  AuthAttempt,
  CardPolicy,
  CardState,
  Cents,
  Decision,
  RecordedCharge,
} from "./types.js";

export interface AttemptOutcome {
  attempt: AuthAttempt;
  /** Decisión de nuestra policy. Se evalúa antes de tocar el rail. */
  decision: Decision;
  /** Respuesta del rail. `null` si la policy rechazó y nunca se llamó. */
  provider: ProviderResult | null;
  /** Verdadero solo si policy y rail aprobaron. */
  approved: boolean;
}

/**
 * Una tarjeta con la policy adelante del rail.
 *
 * El orden importa: primero evaluamos, y solo si permitimos llamamos al
 * proveedor. Un rechazo nuestro no llega nunca a la red, así que no aparece como
 * decline en el historial del emisor ni cuenta para sus métricas de fraude.
 */
export class ControlledCard {
  readonly state: CardState;
  private readonly outcomes: AttemptOutcome[] = [];

  private constructor(
    readonly providerCardId: string,
    private readonly provider: CardProvider,
    readonly policy: CardPolicy,
    openedAt: Date,
  ) {
    this.state = {
      openedAt,
      closed: false,
      taskComplete: false,
      killed: false,
      charges: [],
    };
  }

  static async open(opts: {
    provider: CardProvider;
    policy: CardPolicy;
    fundedCents: Cents;
    currency?: string;
    /** Cap propio del emisor. `null` = sin límite del lado del rail. */
    providerPerTransactionCents?: Cents | null;
    now?: Date;
  }): Promise<ControlledCard> {
    const currency = opts.currency ?? "USD";
    const card = await opts.provider.issue({
      fundedCents: opts.fundedCents,
      currency,
      providerPerTransactionCents: opts.providerPerTransactionCents ?? null,
    });
    return new ControlledCard(
      card.id,
      opts.provider,
      opts.policy,
      opts.now ?? new Date(),
    );
  }

  /**
   * Qué diría la policy si este intento llegara ahora, sin tocar el rail ni
   * dejar rastro. Es el preflight que le deja al agente preguntar antes de ir al
   * checkout, y no puede mutar nada: si lo hiciera, consultar gastaría.
   */
  wouldAllow(attempt: AuthAttempt): Decision {
    return evaluate(attempt, this.state, this.policy);
  }

  async attempt(attempt: AuthAttempt): Promise<AttemptOutcome> {
    const decision = evaluate(attempt, this.state, this.policy);

    let provider: ProviderResult | null = null;
    if (decision.allow) {
      provider = await this.provider.authorize(this.providerCardId, attempt);
    }

    const approved = decision.allow && provider !== null && provider.approved;
    const charge: RecordedCharge = {
      ...attempt,
      allowed: approved,
      code: decision.code,
    };
    this.state.charges.push(charge);

    // Una tarjeta de un solo uso se cierra en el rail, no solo en nuestra
    // policy: si el PAN se filtró, el cierre local no alcanza.
    if (approved && this.policy.singleUse) {
      await this.close();
    }

    const outcome: AttemptOutcome = { attempt, decision, provider, approved };
    this.outcomes.push(outcome);
    return outcome;
  }

  /** Marca la tarea terminada. Con `closeOnTaskComplete`, mata la tarjeta. */
  async completeTask(): Promise<void> {
    this.state.taskComplete = true;
    if (this.policy.closeOnTaskComplete) await this.close();
  }

  async kill(): Promise<void> {
    this.state.killed = true;
    await this.close();
  }

  async close(): Promise<void> {
    if (this.state.closed) return;
    this.state.closed = true;
    await this.provider.close(this.providerCardId);
  }

  get committed(): Cents {
    return committedCents(this.state, this.policy);
  }

  /** Recibos: cada cargo aprobado con la tarea que lo originó. */
  receipts(): Array<{
    at: string;
    merchant: string;
    amount: string;
    taskId: string;
    code: string;
  }> {
    return this.state.charges
      .filter((c) => c.allowed)
      .map((c) => ({
        at: c.at.toISOString(),
        merchant: c.merchant,
        amount: fmt(c.amountCents),
        taskId: c.taskId ?? "(sin tarea)",
        code: c.code,
      }));
  }

  history(): readonly AttemptOutcome[] {
    return this.outcomes;
  }
}
