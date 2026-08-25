/**
 * Porkbun por API, que es el camino que sí escala.
 *
 * El test de Spaceship probó que una tarjeta virtual cierra un cobro sin humano,
 * pero lo probó manejando un browser: cuenta, código de mail, contactos WHOIS y
 * tres iframes de Stripe. Eso se rompe con cada rediseño del comercio y vive a un
 * captcha de distancia. Acá no hay formulario: hay `POST /domain/create`.
 *
 * El cambio no es sólo de plomería, y conviene decirlo en voz alta: Porkbun cobra
 * contra **crédito de la cuenta**, no contra la tarjeta en cada compra. La tarjeta
 * carga el crédito una vez; el agente después gasta de ese saldo. El cap deja de
 * ser "cuánto puede pasar esta tarjeta" y pasa a ser "cuánto crédito le pusiste",
 * que es un límite más duro pero de otra forma. Ver docs/spec.md.
 *
 * Dos primitivas de Porkbun hacen la mitad del trabajo de Konex:
 *   · `dryRun` valida y cotiza sin crear la orden ni cobrar.
 *   · `Idempotency-Key` hace que un reintento después de una respuesta ambigua no
 *     registre dos veces. Sin esto, un timeout obliga a elegir entre perder plata
 *     o arriesgar el doble cargo.
 */

const KEY = "PORKBUN_API_KEY";
const SECRET = "PORKBUN_SECRET_API_KEY";

/**
 * Gate para gastar de verdad. Igual que el del PAN: un `create` sin `dryRun`
 * mueve plata, y eso no puede depender de que nadie se olvide de un flag.
 */
const SPEND_GATE = "AGENT_CARD_ALLOW_REAL_PURCHASE";

const BASE = "https://api.porkbun.com/api/json/v3";

/** Porkbun limita a 1 intento cada 10s por cuenta, y contesta 503 si te pasás. */
const ATTEMPT_WINDOW_MS = 10_000;

export interface DomainQuote {
  domain: string;
  available: boolean;
  /** Precio de registro al plazo mínimo, en centavos. `null` si no lo informó. */
  registrationCents: number | null;
  premium: boolean;
}

export interface RegistrationPreview {
  domain: string;
  wouldSucceed: boolean;
  costCents: number;
  balanceCents: number;
  sufficientFunds: boolean;
  premium: boolean;
  available: string;
  durationYears: number;
  /** Cap mensual de la cuenta, si está configurado. Es el techo del comercio. */
  monthlySpendLimitCents: number | null;
  monthlySpendSoFarCents: number | null;
  message: string;
}

export interface Registration {
  domain: string;
  /** Lo que realmente se cobró. Puede no ser lo cotizado: hay que mirarlo. */
  costCents: number;
  orderId: number;
  balanceCents: number;
  requestId: string;
}

export class PorkbunError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = "PorkbunError";
  }
}

/**
 * Se lanza cuando la cotización supera el techo autorizado.
 *
 * Es su propio tipo a propósito: "salió más caro de lo que te dejaron gastar" no
 * es un error de red ni del comercio, y el agente tiene que poder distinguirlo
 * para volver a pedir autorización en lugar de reintentar.
 */
export class OverAuthorizedError extends Error {
  constructor(
    readonly quotedCents: number,
    readonly maxCents: number,
  ) {
    super(
      `La cotización es ${usd(quotedCents)} y el techo autorizado es ${usd(maxCents)}. ` +
        "No compro: pedí autorización por el monto nuevo.",
    );
    this.name = "OverAuthorizedError";
  }
}

export class PorkbunApi {
  private lastAttemptAt = 0;

  private constructor(
    private readonly apikey: string,
    private readonly secretapikey: string,
  ) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): PorkbunApi {
    const apikey = (env[KEY] ?? "").trim();
    const secret = (env[SECRET] ?? "").trim();
    if (apikey === "" || secret === "") {
      throw new Error(
        `Faltan ${KEY} y/o ${SECRET}. Se crean en https://porkbun.com/account/api ` +
          "y van en .env, que está en .gitignore.",
      );
    }
    return new PorkbunApi(apikey, secret);
  }

  /** Verifica credenciales y devuelve la IP con la que nos ve Porkbun. */
  async ping(): Promise<{ ip: string }> {
    const body = await this.post("/ping", {});
    return { ip: String(body.yourIp ?? body.ip ?? "") };
  }

  async checkDomain(domain: string): Promise<DomainQuote> {
    const body = await this.post(`/domain/checkDomain/${encodeURIComponent(domain)}`, {});
    const res = (body.response ?? {}) as Record<string, unknown>;
    return {
      domain,
      available: String(res.avail ?? res.available ?? "").toLowerCase() === "yes"
        || String(res.avail ?? res.available ?? "").toLowerCase() === "available",
      registrationCents: dollarsToCents(res.price ?? res.registration ?? null),
      premium: res.premium === true || String(res.premium ?? "") === "yes",
    };
  }

  /**
   * ¿Este TLD se puede registrar por API?
   *
   * Algunos (.us, .ca, .eu, .au) tienen reglas de elegibilidad que la API no
   * puede enviar y son sólo-web. Preguntarlo antes evita descubrirlo con un
   * `create` fallado, que consume rate limit y no explica bien por qué.
   */
  async apiRegisterable(tld: string): Promise<boolean> {
    const body = await this.get(`/domain/getRegistrationRequirements/${encodeURIComponent(tld)}`);
    return body.apiRegisterable === true;
  }

  /**
   * Cotiza y valida sin crear la orden ni cobrar.
   *
   * Esto es lo que el agente debería llamar siempre antes de gastar: contesta
   * disponibilidad, precio exacto, saldo y si el cap mensual lo deja pasar.
   */
  async preview(domain: string): Promise<RegistrationPreview> {
    const body = await this.post(`/domain/create/${encodeURIComponent(domain)}`, {
      // `cost` es obligatorio pero en dryRun no tiene que coincidir: Porkbun
      // devuelve el precio real en la preview.
      cost: 0,
      agreeToTerms: "yes",
      dryRun: true,
    });
    return {
      domain: String(body.domain ?? domain),
      wouldSucceed: body.wouldSucceed === true,
      costCents: Number(body.cost ?? 0),
      balanceCents: Number(body.balance ?? 0),
      sufficientFunds: body.sufficientFunds === true,
      premium: body.premium === true,
      available: String(body.available ?? ""),
      durationYears: Number(body.duration ?? 1),
      monthlySpendLimitCents:
        body.monthlySpendLimit === undefined ? null : Number(body.monthlySpendLimit),
      monthlySpendSoFarCents:
        body.monthlySpendSoFar === undefined ? null : Number(body.monthlySpendSoFar),
      message: String(body.message ?? ""),
    };
  }

  /**
   * Registra de verdad. Cobra crédito de la cuenta.
   *
   * `maxCents` no es decoración: es el techo que autorizó un humano (o la policy).
   * Se cotiza primero y se compara. Porkbun además exige que `cost` coincida
   * exactamente con el precio vigente, así que un cambio de precio entre la
   * cotización y el cobro falla en lugar de cobrar de más.
   *
   * `idempotencyKey` es obligatoria a propósito. Si esta llamada corta por
   * timeout no vas a saber si registró; con la misma key, reintentar es seguro.
   */
  async register(
    domain: string,
    opts: { maxCents: number; idempotencyKey: string },
  ): Promise<Registration> {
    if (process.env[SPEND_GATE] !== "1") {
      throw new Error(
        `Para gastar de verdad hay que poner ${SPEND_GATE}=1. ` +
          "Es a propósito: sin esto sólo corre preview(), que no cobra.",
      );
    }
    if (opts.idempotencyKey.trim() === "") {
      throw new Error("Falta idempotencyKey: sin eso un reintento puede registrar dos veces.");
    }

    const quote = await this.preview(domain);
    if (!quote.wouldSucceed) {
      throw new PorkbunError(
        `Porkbun dice que no cerraría: ${quote.message || "sin detalle"}`,
        null,
        null,
      );
    }
    if (quote.costCents > opts.maxCents) {
      throw new OverAuthorizedError(quote.costCents, opts.maxCents);
    }

    const body = await this.post(
      `/domain/create/${encodeURIComponent(domain)}`,
      { cost: quote.costCents, agreeToTerms: "yes" },
      { "Idempotency-Key": opts.idempotencyKey },
    );

    return {
      domain: String(body.domain ?? domain),
      costCents: Number(body.cost ?? quote.costCents),
      orderId: Number(body.orderId ?? 0),
      balanceCents: Number(body.balance ?? 0),
      requestId: String(body.requestId ?? ""),
    };
  }

  private async get(path: string): Promise<Record<string, unknown>> {
    return this.request(path, {
      method: "GET",
      headers: { "X-API-Key": this.apikey, "X-Secret-API-Key": this.secretapikey },
    });
  }

  private async post(
    path: string,
    payload: Record<string, unknown>,
    extraHeaders: Record<string, string> = {},
  ): Promise<Record<string, unknown>> {
    await this.pace();
    return this.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...extraHeaders },
      body: JSON.stringify({
        apikey: this.apikey,
        secretapikey: this.secretapikey,
        ...payload,
      }),
    });
  }

  /** Porkbun contesta 503 si van dos intentos en menos de 10s. Esperar es más barato. */
  private async pace(): Promise<void> {
    const since = Date.now() - this.lastAttemptAt;
    if (this.lastAttemptAt !== 0 && since < ATTEMPT_WINDOW_MS) {
      await new Promise((r) => setTimeout(r, ATTEMPT_WINDOW_MS - since));
    }
    this.lastAttemptAt = Date.now();
  }

  private async request(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    const res = await fetch(`${BASE}${path}`, init);
    const text = await res.text();

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new PorkbunError(
        `Porkbun contestó ${res.status} con algo que no es JSON: ${redact(text).slice(0, 200)}`,
        null,
        res.headers.get("x-request-id"),
      );
    }

    if (String(body.status ?? "").toUpperCase() === "ERROR" || !res.ok) {
      throw new PorkbunError(
        String(body.message ?? `HTTP ${res.status}`),
        body.code === undefined ? null : String(body.code),
        body.requestId === undefined ? null : String(body.requestId),
      );
    }
    return body;
  }

  /** Que las claves no se escapen por un console.log distraído. */
  toString(): string {
    return "PorkbunApi(claves ocultas)";
  }

  toJSON(): { provider: string } {
    return { provider: "porkbun" };
  }
}

export function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function dollarsToCents(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** Por si un error trae el body de vuelta con las claves adentro. */
function redact(text: string): string {
  return text.replace(/(pk1_|sk1_)[A-Za-z0-9]+/g, "$1«oculta»");
}
