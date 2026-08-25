/**
 * Proveedor respaldado por una tarjeta real que ya existe, leída del entorno.
 *
 * Existe porque OmniHood no tiene API: no hay forma de emitir una tarjeta por
 * código, así que no se puede modelar el rail de verdad. Lo que sí se puede
 * medir es el resto de la cadena — que un agente pida la tarjeta por MCP,
 * consiga el número y pague — usando la única tarjeta que ya probamos que cierra
 * un cobro sin humano (ver docs/medir-compra-online.md).
 *
 * Tres límites que hay que decir en voz alta, porque el código no los puede
 * arreglar y confundirlos sería vender humo:
 *
 * 1. `issue()` NO emite nada. Devuelve un id nuevo sobre la MISMA tarjeta
 *    física. Dos handles distintos comparten plástico: cada uno puede respetar
 *    su cap de Konex y entre los dos vaciar la tarjeta real. Con un emisor de
 *    verdad (Interlace) cada handle es una tarjeta aparte y esto desaparece.
 *
 * 2. Los caps los enforcea Konex, no el emisor. Si el agente se saltea el MCP y
 *    usa el número directo, no hay nada que lo frene. Con un emisor real el cap
 *    vive en la tarjeta y la red lo respeta aunque nosotros no existamos.
 *    Ver docs/spec.md §3.3.
 *
 * 3. `authorize()` es contabilidad, no autorización. La decisión real la toma el
 *    emisor cuando el comercio cobra. Acá se lleva la cuenta para que el
 *    presupuesto cierre y el recibo tenga sentido.
 *
 * Lo que sí respeta el diseño: el PAN no viaja en la respuesta de la tool. Se
 * canjea contra un endpoint loopback de un solo uso, igual que haría un emisor
 * real (§3.1). Que el número esté en este proceso es la excepción gateada de
 * `CardCredentials`, no el camino de producción.
 */
import { createServer, type Server } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { CardCredentials } from "../credentials.js";
import type {
  CardProvider,
  IssueOptions,
  ProviderCard,
  ProviderCredentialGrant,
  ProviderResult,
  ProviderSnapshot,
} from "../provider.js";
import type { AuthAttempt, Cents } from "../types.js";

/** Vida del token que canjea el PAN. Corto a propósito. */
const GRANT_TTL_MS = 60_000;

interface Issued {
  id: string;
  fundedCents: Cents;
  currency: string;
  limit: Cents | null;
  spent: Cents;
  closed: boolean;
}

export class EnvCardProvider implements CardProvider {
  readonly name = "env-manual";
  private cards = new Map<string, Issued>();
  private seq = 0;

  private constructor(private readonly card: CardCredentials) {}

  /**
   * Falla ruidosamente si no está el gate o falta un campo. Un error acá cuesta
   * cero; una tarjeta mal cargada se disfraza de "rechazada" en el checkout, que
   * es justo la conclusión que no queremos sacar mal.
   */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): EnvCardProvider {
    return new EnvCardProvider(CardCredentials.fromEnv(env));
  }

  /** Para tests, sin tocar el entorno ni el gate. */
  static forTesting(card: CardCredentials): EnvCardProvider {
    return new EnvCardProvider(card);
  }

  /** Para el banner de arranque, sin filtrar el número. */
  get label(): string {
    return `${this.card.brand} ••${this.card.last4}`;
  }

  async issue(opts: IssueOptions): Promise<ProviderCard> {
    const id = `env_card_${++this.seq}`;
    this.cards.set(id, {
      id,
      fundedCents: opts.fundedCents,
      currency: opts.currency,
      limit: opts.providerPerTransactionCents ?? null,
      spent: 0,
      closed: false,
    });
    return {
      id,
      fundedCents: opts.fundedCents,
      currency: opts.currency,
      closed: false,
      last4: this.card.last4,
    };
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
    if (card === undefined) return;
    card.closed = true;
    // No se puede cerrar de verdad: la tarjeta es de OmniHood y no hay API.
    // Cerrar acá sólo corta el camino por Konex. Si el número ya salió, hay que
    // cerrarla desde la app del emisor. Eso es el kill switch real.
  }

  /**
   * Un endpoint loopback de un solo uso con el PAN.
   *
   * El agente recibe URL + token, no el número. Canjea una vez y el servidor se
   * apaga; si no canjea en un minuto, se apaga igual. Es el mismo contrato que
   * expondría un emisor real, así que el día que entre Interlace el cliente MCP
   * no cambia.
   */
  async credentialGrant(cardId: string): Promise<ProviderCredentialGrant> {
    const card = this.cards.get(cardId);
    if (card === undefined) throw new Error(`Tarjeta desconocida: ${cardId}`);
    if (card.closed) throw new Error("La tarjeta está cerrada: no se emiten credenciales.");

    const token = randomBytes(24).toString("base64url");
    const path = `/pan/${randomBytes(8).toString("hex")}`;
    const secret = this.card.reveal();

    const { server, port } = await serveOnce({
      path,
      token,
      body: JSON.stringify({
        pan: secret.pan,
        cvc: secret.cvc,
        exp_month: secret.expMonth,
        exp_year: secret.expYear,
        name: secret.name,
        last4: this.card.last4,
        brand: this.card.brand,
      }),
    });

    const timer = setTimeout(() => server.close(), GRANT_TTL_MS);
    timer.unref();

    return {
      provider: this.name,
      endpoint: `http://127.0.0.1:${port}${path}`,
      token,
      expiresAt: new Date(Date.now() + GRANT_TTL_MS),
    };
  }

  /**
   * Se guarda el consumo, no la tarjeta: el PAN sale del entorno en cada
   * arranque y nunca toca el disco.
   */
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
          limit: c.limit,
          spent: c.spent,
          closed: c.closed,
        },
      ]),
    );
  }
}

/**
 * Servidor de un solo uso en loopback.
 *
 * Se cierra después del primer canje correcto. Un token equivocado no lo apaga
 * —si no, cualquiera podría quemar el grant con un request basura— pero tampoco
 * dice nada útil: contesta 401 y listo.
 */
async function serveOnce(opts: {
  path: string;
  token: string;
  body: string;
}): Promise<{ server: Server; port: number }> {
  let spent = false;

  const server = createServer((req, res) => {
    if (req.url !== opts.path) {
      res.writeHead(404).end();
      return;
    }
    const header = req.headers.authorization ?? "";
    const offered = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!sameToken(offered, opts.token)) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "token inválido" }));
      return;
    }
    if (spent) {
      res.writeHead(410, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "el grant ya se canjeó" }));
      return;
    }
    spent = true;
    res.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(opts.body);
    // Cerrar después de contestar: el grant vale un solo canje.
    setImmediate(() => server.close());
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  server.unref();

  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return { server, port };
}

function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
