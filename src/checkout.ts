/**
 * Leer el resultado de un checkout desde la página.
 *
 * Esto es la medición del proyecto. Todo lo demás asume que un agente puede
 * comprar online; acá se comprueba, y cuando falla, se registra **por qué**.
 * Ese motivo es el que decide si el problema se arregla cambiando de emisor o
 * si no se arregla.
 *
 * Regla que ordena todo el archivo: `aprobado` exige evidencia positiva. Si no
 * la hay, el resultado es `desconocido`, no `rechazado`. Un falso "rechazado"
 * invita a reintentar, y reintentar un cobro que en realidad pasó es cobrarle
 * dos veces al usuario; encima el patrón de reintentos es la firma del card
 * testing. Ante la duda, la respuesta correcta es "no sé", y que la mire alguien.
 */

/** Lo que se puede observar de la página, sin saber de navegadores. */
export interface PageEvidence {
  url: string;
  /** Texto visible. No el HTML: los atributos meten ruido y falsos positivos. */
  text: string;
  title?: string;
}

export type OutcomeKind = "aprobado" | "rechazado" | "desafio_3ds" | "desconocido";

export type DeclineReason =
  | "fondos_insuficientes"
  | "3ds_requerido"
  | "domicilio_no_verificado"
  | "bin_no_aceptado"
  | "datos_invalidos"
  | "tarjeta_vencida"
  | "rechazo_generico"
  | "motivo_no_declarado";

export interface CheckoutOutcome {
  kind: OutcomeKind;
  /** Solo cuando `kind` es "rechazado". */
  reason: DeclineReason | null;
  /**
   * `alta` cuando la evidencia es inequívoca (una URL de confirmación, una frase
   * de rechazo explícita). `media` cuando se apoya en texto que podría estar en
   * la página por otro motivo. Nada se decide solo con confianza media sin que
   * quede el rastro para auditarlo.
   */
  confidence: "alta" | "media";
  /** El fragmento que disparó la decisión, para poder discutirla después. */
  evidence: string;
}

/**
 * Qué significa cada rechazo para el proyecto.
 *
 * `structural` es la única columna que importa de verdad: marca los rechazos que
 * **no** se arreglan del lado nuestro ni del emisor, porque son propiedades de la
 * tarjeta frente a la red. Son los tres que hunden a una tarjeta sin KYC en
 * compras online: no está enrolada en 3-D Secure, no tiene verificación de
 * domicilio, y su rango de BIN está marcado.
 */
export const DECLINE_MEANING: Record<
  DeclineReason,
  { structural: boolean; meaning: string }
> = {
  fondos_insuficientes: {
    structural: false,
    meaning: "Falta saldo en la tarjeta. Es nuestro: cargá más y reintentá.",
  },
  datos_invalidos: {
    structural: false,
    meaning: "Número, vencimiento o CVV mal completados. Es un bug del llenado del formulario.",
  },
  tarjeta_vencida: {
    structural: false,
    meaning: "La tarjeta venció. Emitir otra alcanza.",
  },
  "3ds_requerido": {
    structural: true,
    meaning:
      "El comercio exige 3-D Secure y la tarjeta no está enrolada. No se arregla del lado nuestro: " +
      "hace falta un emisor que enrole, y eso implica KYC del titular.",
  },
  domicilio_no_verificado: {
    structural: true,
    meaning:
      "El comercio pide verificación de domicilio y la tarjeta no la tiene. Sin KYC no hay domicilio " +
      "que verificar.",
  },
  bin_no_aceptado: {
    structural: true,
    meaning:
      "El comercio bloquea el rango de BIN de la tarjeta, típico con prepagas. No se negocia por API: " +
      "hace falta otro programa de emisión.",
  },
  rechazo_generico: {
    structural: true,
    meaning:
      '"Do not honor" sin más detalle. Es el rechazo más común de las prepagas sin KYC y hay que ' +
      "tratarlo como estructural hasta que la misma compra pase con una tarjeta KYC-eada.",
  },
  motivo_no_declarado: {
    structural: true,
    meaning:
      "Rechazó y no dijo por qué. Se asume estructural: si el motivo no se puede leer, no se puede " +
      "arreglar, y suponer que es pasajero lleva a reintentar de gusto.",
  },
};

/** Rutas de confirmación. Evidencia fuerte: nadie aterriza acá sin haber pagado. */
const SUCCESS_PATHS = [
  "/success",
  "/thank-you",
  "/thankyou",
  "/thanks",
  "/order-confirmation",
  "/order-complete",
  "/order-received",
  "/orden-confirmada",
  "/compra-exitosa",
  "/pago-exitoso",
  "/receipt",
  "/complete",
];

const SUCCESS_TEXT = [
  "thank you for your order",
  "thanks for your order",
  "order confirmed",
  "order complete",
  "payment successful",
  "payment received",
  "your order number",
  "gracias por tu compra",
  "gracias por su compra",
  "compra exitosa",
  "pago aprobado",
  "pago exitoso",
  "orden confirmada",
  "número de orden",
];

/**
 * Frases de rechazo, con su motivo. El orden importa: el más específico primero,
 * porque "your card was declined because the billing address does not match" es
 * un AVS y no un rechazo genérico, y meterlo en la bolsa genérica pierde justo el
 * dato que fuimos a buscar.
 *
 * Las frases son de varias palabras a propósito. "declined" sola aparece en
 * ayudas y pies de página de comercios que no rechazaron nada.
 */
const DECLINE_PATTERNS: Array<{ pattern: RegExp; reason: DeclineReason }> = [
  {
    pattern:
      /insufficient funds|not enough funds|fondos insuficientes|saldo insuficiente|sin saldo suficiente/i,
    reason: "fondos_insuficientes",
  },
  {
    pattern:
      /billing address (does not|doesn't|did not) match|incorrect billing address|address verification (failed|mismatch)|avs (mismatch|failure)|domicilio de facturación no coincide|dirección de facturación (no coincide|incorrecta)/i,
    reason: "domicilio_no_verificado",
  },
  {
    pattern:
      /(3-?d ?secure|3ds) (is )?(required|not enrolled|enrollment|authentication failed)|not enrolled in 3-?d ?secure|card (is )?not enrolled|authentication (failed|required|unavailable)|requiere autenticación|autenticación (fallida|requerida)|no está adherida/i,
    reason: "3ds_requerido",
  },
  {
    pattern:
      /card type (is )?not (supported|accepted)|we (do not|don't) accept (this|prepaid)|prepaid cards? (are )?not (supported|accepted)|not supported for this|unsupported card|no aceptamos (esta|tarjetas prepagas)|tipo de tarjeta no (soportado|aceptado)/i,
    reason: "bin_no_aceptado",
  },
  {
    pattern:
      /(card|tarjeta) (has )?expired|expired card|tarjeta vencida|fecha de vencimiento (inválida|pasada)/i,
    reason: "tarjeta_vencida",
  },
  {
    pattern:
      /(incorrect|invalid|wrong) (card )?(number|cvc|cvv|security code|expiry|expiration)|check your card (number|details)|número de tarjeta (inválido|incorrecto)|código de seguridad (inválido|incorrecto)|datos de la tarjeta (inválidos|incorrectos)/i,
    reason: "datos_invalidos",
  },
  {
    pattern:
      /do not honor|do_not_honor|generic decline|transaction (was )?(declined|not authorized|refused)|issuer declined|bank declined|(card|payment) (was |has been )?(declined|refused|rejected)|no fue autorizada|(tarjeta|pago) (fue )?(rechazad[ao]|rechazo)|rechazada por el (banco|emisor)/i,
    reason: "rechazo_generico",
  },
  {
    // Última red: dice que falló y no dice más. Vale como rechazo, no como motivo.
    pattern:
      /payment (failed|could not be processed|unsuccessful)|could not process your (payment|card)|unable to process payment|el pago (falló|no pudo procesarse)|no pudimos procesar (el pago|tu tarjeta)/i,
    reason: "motivo_no_declarado",
  },
];

/**
 * Un desafío 3-D Secure **en curso** no es un rechazo: es un paso intermedio que
 * puede terminar bien. Se separa porque confundirlo con rechazo hace abandonar
 * una compra que estaba por aprobarse.
 */
const CHALLENGE_HOSTS = /(^|\.)(acs|3ds|secure-?auth|challenge|authentication)[.-]/i;
const CHALLENGE_PATHS = /\/(3ds|acs|challenge|authenticate|verify-?card|secure-?auth)(\/|$|\?)/i;
const CHALLENGE_TEXT =
  /(one-?time|verification) (code|password)|enter the code (we )?sent|sent (a code )?to your (phone|mobile|device)|código (de verificación|de un solo uso)|te enviamos un código|verificá tu identidad|verificación del banco/i;

export function classifyOutcome(evidence: PageEvidence): CheckoutOutcome {
  const url = evidence.url;
  const text = evidence.text;
  const haystack = evidence.title === undefined ? text : `${evidence.title}\n${text}`;

  // Una URL de confirmación gana sobre cualquier texto suelto. Es lo más difícil
  // de falsear: el comercio te manda ahí después de cobrar, no antes.
  const successPath = matchSuccessPath(url);
  if (successPath !== null) {
    return {
      kind: "aprobado",
      reason: null,
      confidence: "alta",
      evidence: `URL de confirmación: ${successPath}`,
    };
  }

  for (const { pattern, reason } of DECLINE_PATTERNS) {
    const hit = pattern.exec(haystack);
    if (hit !== null) {
      return {
        kind: "rechazado",
        reason,
        confidence: "alta",
        evidence: quote(haystack, hit.index, hit[0].length),
      };
    }
  }

  const challenge = matchChallenge(url, haystack);
  if (challenge !== null) {
    return {
      kind: "desafio_3ds",
      reason: null,
      confidence: challenge.confidence,
      evidence: challenge.evidence,
    };
  }

  for (const phrase of SUCCESS_TEXT) {
    const at = haystack.toLowerCase().indexOf(phrase);
    if (at !== -1) {
      // Media, no alta: "gracias por tu compra" puede ser de una compra anterior
      // en el mismo carrito, o del mail que la página muestra de ejemplo.
      return {
        kind: "aprobado",
        reason: null,
        confidence: "media",
        evidence: quote(haystack, at, phrase.length),
      };
    }
  }

  return {
    kind: "desconocido",
    reason: null,
    confidence: "media",
    evidence:
      "La página no dice ni que pasó ni que falló. Hay que mirarla a mano: no se " +
      "asume rechazo, porque el cobro puede haber entrado.",
  };
}

/** ¿Este rechazo se arregla cambiando de emisor, o no se arregla? */
export function isStructural(outcome: CheckoutOutcome): boolean {
  if (outcome.kind !== "rechazado" || outcome.reason === null) return false;
  return DECLINE_MEANING[outcome.reason].structural;
}

/** El veredicto en una línea, que es lo que se lee al final de la corrida. */
export function explain(outcome: CheckoutOutcome): string {
  switch (outcome.kind) {
    case "aprobado":
      return outcome.confidence === "alta"
        ? "Aprobado. La tarjeta sirve para comprar online en este comercio."
        : "Parece aprobado, pero la evidencia es débil. Confirmá el cobro en el emisor antes de darlo por bueno.";
    case "desafio_3ds":
      return "El comercio pidió verificación del banco. No es un rechazo: la compra sigue abierta y necesita resolver el desafío.";
    case "rechazado": {
      const reason = outcome.reason ?? "motivo_no_declarado";
      const { structural, meaning } = DECLINE_MEANING[reason];
      return structural
        ? `Rechazado (${reason}). ${meaning} No reintentes con esta tarjeta.`
        : `Rechazado (${reason}). ${meaning}`;
    }
    case "desconocido":
      return "No se pudo determinar el resultado. Revisá a mano en el emisor si el cobro entró, y no reintentes hasta saberlo.";
  }
}

function matchSuccessPath(url: string): string | null {
  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    path = url.toLowerCase();
  }
  return SUCCESS_PATHS.find((candidate) => path.includes(candidate)) ?? null;
}

function matchChallenge(
  url: string,
  haystack: string,
): { confidence: "alta" | "media"; evidence: string } | null {
  let host = "";
  let path = "";
  try {
    const parsed = new URL(url);
    host = parsed.hostname;
    path = parsed.pathname;
  } catch {
    path = url;
  }

  if (CHALLENGE_HOSTS.test(host)) {
    return { confidence: "alta", evidence: `Host de autenticación del banco: ${host}` };
  }
  if (CHALLENGE_PATHS.test(path)) {
    return { confidence: "alta", evidence: `Ruta de desafío: ${path}` };
  }
  const hit = CHALLENGE_TEXT.exec(haystack);
  if (hit !== null) {
    return { confidence: "media", evidence: quote(haystack, hit.index, hit[0].length) };
  }
  return null;
}

/** El fragmento con algo de contexto alrededor, en una línea y sin desbordarse. */
function quote(haystack: string, at: number, length: number): string {
  const from = Math.max(0, at - 60);
  const to = Math.min(haystack.length, at + length + 60);
  const slice = haystack.slice(from, to).replace(/\s+/g, " ").trim();
  return `${from > 0 ? "…" : ""}${slice}${to < haystack.length ? "…" : ""}`;
}
