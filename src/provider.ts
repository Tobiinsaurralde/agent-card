import type { AuthAttempt, Cents } from "./types.js";

export interface IssueOptions {
  /** Fondos disponibles en el rail para esta tarjeta. */
  fundedCents: Cents;
  currency: string;
  /**
   * Cap por transacción que el proveedor va a enforcear por su cuenta.
   * `null` modela una tarjeta sin límite propio, que gasta contra el balance:
   * es el caso peor, y el que hay que asumir mientras el emisor no ofrezca
   * límites por tarjeta.
   */
  providerPerTransactionCents?: Cents | null;
}

export interface ProviderCard {
  id: string;
  fundedCents: Cents;
  currency: string;
  closed: boolean;
  /**
   * Últimos cuatro del plástico, si el emisor los da. Es lo único del número que
   * puede viajar por acá: alcanza para conciliar contra el resumen y no sirve
   * para cobrar.
   */
  last4?: string;
}

export interface ProviderResult {
  approved: boolean;
  /** Código del rail, no de nuestra policy. */
  code: "APPROVED" | "INSUFFICIENT_FUNDS" | "OVER_PROVIDER_LIMIT" | "CARD_CLOSED";
}

/**
 * Permiso para que el cliente MCP le pida el PAN al proveedor **directo**.
 *
 * No contiene el PAN y nunca va a contenerlo: es un endpoint más un token de
 * vida corta. El número viaja del emisor al agente sin escala en nuestro
 * backend, que es lo que nos mantiene fuera de scope PCI. Ver docs/spec.md §3.1.
 */
export interface ProviderCredentialGrant {
  provider: string;
  endpoint: string;
  token: string;
  expiresAt: Date;
}

/** Una tarjeta del emisor tal como la guardamos para sobrevivir un reinicio. */
export interface ProviderCardSnapshot {
  id: string;
  fundedCents: Cents;
  currency: string;
  limit: Cents | null;
  spent: Cents;
  closed: boolean;
}

export interface ProviderSnapshot {
  seq: number;
  cards: ProviderCardSnapshot[];
}

/**
 * Lo que necesitamos de cualquier emisor. La implementación real va detrás de
 * esta interfaz para que la policy no dependa del rail.
 *
 * Ojo con lo que NO está acá: no hay `getPan()`. El PAN va del proveedor al
 * cliente MCP directo, sin pasar por nuestro backend. Ver docs/spec.md §3.1.
 */
export interface CardProvider {
  readonly name: string;
  issue(opts: IssueOptions): Promise<ProviderCard>;
  authorize(cardId: string, attempt: AuthAttempt): Promise<ProviderResult>;
  close(cardId: string): Promise<void>;
  /**
   * Permiso de vida corta para que el cliente le pida el PAN al emisor.
   * Opcional: un proveedor que no lo soporte deja al agente sin forma de pagar,
   * pero no rompe la policy.
   */
  credentialGrant?(cardId: string): Promise<ProviderCredentialGrant>;
  /**
   * Estado local del emisor, para que sobreviva a un reinicio.
   *
   * Opcional a propósito: un emisor de verdad lleva la cuenta de su lado y no
   * hay nada local que guardar. Esto existe para los proveedores que viven en
   * memoria, donde perder el estado significa que una tarjeta restaurada apunte
   * a un id que el proveedor ya no conoce y el cobro explote.
   */
  snapshot?(): ProviderSnapshot;
  restore?(snap: ProviderSnapshot): void;
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

  async credentialGrant(cardId: string): Promise<ProviderCredentialGrant> {
    const card = this.cards.get(cardId);
    if (card === undefined) throw new Error(`Tarjeta desconocida: ${cardId}`);
    if (card.closed) throw new Error("La tarjeta está cerrada: no se emiten credenciales.");
    return {
      provider: this.name,
      endpoint: `https://mock.invalid/cards/${cardId}/pan`,
      token: `tok_mock_${Math.random().toString(36).slice(2, 14)}`,
      expiresAt: new Date(Date.now() + 60_000),
    };
  }

  snapshot(): ProviderSnapshot {
    return {
      seq: this.seq,
      cards: [...this.cards.values()].map((c) => ({
        id: c.id,
        fundedCents: c.fundedCents,
        currency: c.currency,
        limit: c.limit,
        spent: c.spent,
        closed: c.closed,
      })),
    };
  }

  restore(snap: ProviderSnapshot): void {
    this.seq = snap.seq;
    this.cards = new Map(
      snap.cards.map((c) => [
        c.id,
        {
          id: c.id,
          fundedCents: c.fundedCents,
          currency: c.currency,
          closed: c.closed,
          limit: c.limit,
          spent: c.spent,
        },
      ]),
    );
  }
}
