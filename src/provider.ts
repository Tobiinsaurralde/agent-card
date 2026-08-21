import type { AuthAttempt, Cents } from "./types.js";

export interface IssueOptions {
  /** Fondos disponibles en el rail para esta tarjeta. */
  fundedCents: Cents;
  currency: string;
  /**
   * Cap por transacción que el proveedor va a enforcear por su cuenta.
   * `null` modela el `transactionLimitsType: NA` de Interlace: tarjeta sin
   * límite propio, gastando contra el balance.
   */
  providerPerTransactionCents?: Cents | null;
}

export interface ProviderCard {
  id: string;
  fundedCents: Cents;
  currency: string;
  closed: boolean;
}

export interface ProviderResult {
  approved: boolean;
  /** Código del rail, no de nuestra policy. */
  code: "APPROVED" | "INSUFFICIENT_FUNDS" | "OVER_PROVIDER_LIMIT" | "CARD_CLOSED";
}

/**
 * Lo que necesitamos de cualquier emisor. La implementación real (Interlace,
 * Karma) va detrás de esta interfaz para que la policy no dependa del rail.
 *
 * Ojo con lo que NO está acá: no hay `getPan()`. El PAN va del proveedor al
 * cliente MCP directo, sin pasar por nuestro backend. Ver docs/spec.md §3.1.
 */
export interface CardProvider {
  readonly name: string;
  issue(opts: IssueOptions): Promise<ProviderCard>;
  authorize(cardId: string, attempt: AuthAttempt): Promise<ProviderResult>;
  close(cardId: string): Promise<void>;
}

/**
 * Proveedor en memoria que modela el comportamiento por defecto de un emisor:
 * aprueba cualquier cosa mientras haya fondos. Sirve para correr el harness sin
 * API key y sin gastar plata, y es el grupo de control contra el que se compara
 * la medición con cargos reales.
 */
export class MockProvider implements CardProvider {
  readonly name = "mock";
  private cards = new Map<string, ProviderCard & { limit: Cents | null; spent: Cents }>();
  private seq = 0;

  async issue(opts: IssueOptions): Promise<ProviderCard> {
    const id = `mock_card_${++this.seq}`;
    const card = {
      id,
      fundedCents: opts.fundedCents,
      currency: opts.currency,
      closed: false,
      limit: opts.providerPerTransactionCents ?? null,
      spent: 0,
    };
    this.cards.set(id, card);
    return { id, fundedCents: card.fundedCents, currency: card.currency, closed: false };
  }

  async authorize(cardId: string, attempt: AuthAttempt): Promise<ProviderResult> {
    const card = this.cards.get(cardId);
    if (card === undefined) throw new Error(`Tarjeta desconocida: ${cardId}`);
    if (card.closed) return { approved: false, code: "CARD_CLOSED" };

    if (attempt.kind === "refund") {
      card.spent -= attempt.amountCents;
      return { approved: true, code: "APPROVED" };
    }
    if (card.limit !== null && attempt.amountCents > card.limit) {
      return { approved: false, code: "OVER_PROVIDER_LIMIT" };
    }
    if (card.spent + attempt.amountCents > card.fundedCents) {
      return { approved: false, code: "INSUFFICIENT_FUNDS" };
    }
    card.spent += attempt.amountCents;
    return { approved: true, code: "APPROVED" };
  }

  async close(cardId: string): Promise<void> {
    const card = this.cards.get(cardId);
    if (card !== undefined) card.closed = true;
  }
}
