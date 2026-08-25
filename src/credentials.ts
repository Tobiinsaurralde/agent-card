/**
 * La tarjeta de verdad, para la única corrida que la necesita: el test de si un
 * agente puede comprar online.
 *
 * Esto contradice a propósito la regla central del diseño (`docs/spec.md` §3.1:
 * el PAN no pasa por nuestro backend) y por eso está encapsulado y con un gate
 * explícito. En producción el número va del emisor al cliente MCP directo. Acá
 * pasa por nuestro proceso porque no hay otra forma de completar un formulario
 * con una tarjeta que ya existe, y porque la alternativa —no medir— es peor.
 *
 * Lo que hace este archivo, más que guardar el número, es hacer costoso filtrarlo:
 * la clase se redacta sola al loguearla, al serializarla y al inspeccionarla.
 * Que el secreto no se escape no puede depender de que nadie escriba un
 * `console.log` por descuido.
 */

const GATE = "AGENT_CARD_ALLOW_MANUAL_PAN";

export interface RevealedCard {
  pan: string;
  cvc: string;
  /** Dos dígitos, como lo pide casi todo formulario. */
  expMonth: string;
  /** Cuatro dígitos. */
  expYear: string;
  name: string;
}

export class CardCredentials {
  readonly last4: string;
  readonly brand: string;
  private readonly pan: string;
  private readonly cvc: string;
  private readonly expMonth: string;
  private readonly expYear: string;
  private readonly name: string;

  private constructor(input: RevealedCard) {
    this.pan = input.pan;
    this.cvc = input.cvc;
    this.expMonth = input.expMonth;
    this.expYear = input.expYear;
    this.name = input.name;
    this.last4 = input.pan.slice(-4);
    this.brand = brandOf(input.pan);
  }

  /**
   * Lee la tarjeta del entorno. Falla ruidosamente y temprano: un error acá
   * cuesta cero, y un dato mal cargado se disfraza de "tarjeta rechazada" en el
   * checkout, que es justo la conclusión que no queremos sacar mal.
   */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): CardCredentials {
    if (env[GATE] !== "1") {
      throw new Error(
        `Para usar una tarjeta real hay que poner ${GATE}=1. ` +
          "Es a propósito: este camino mete el PAN en nuestro proceso y solo existe para el test.",
      );
    }

    const { month, year } = parseExpiry(required(env, "AGENT_CARD_TEST_EXP"));

    return new CardCredentials(
      checked({
        pan: digits(required(env, "AGENT_CARD_TEST_PAN")),
        cvc: digits(required(env, "AGENT_CARD_TEST_CVC")),
        expMonth: month,
        expYear: year,
        name: required(env, "AGENT_CARD_TEST_NAME").trim(),
      }),
    );
  }

  /**
   * La tarjeta que llegó del emisor, canjeando el grant de `get_card_credentials`.
   *
   * Este es el camino de producción y no necesita gate: el número no salió de
   * nuestra config, vino del emisor al cliente. Se valida igual que la del
   * entorno, porque un PAN roto contestado por un endpoint se disfraza de
   * "tarjeta rechazada" exactamente igual que uno mal tipeado.
   */
  static fromIssuer(input: RevealedCard): CardCredentials {
    return new CardCredentials(checked(input));
  }

  /** Para tests, sin tocar el entorno ni el gate. */
  static forTesting(input: RevealedCard): CardCredentials {
    return new CardCredentials(input);
  }

  /**
   * El único punto que devuelve el secreto. Se llama `reveal` para que salte a la
   * vista en un diff: cualquier uso nuevo de esto merece una pregunta.
   */
  reveal(): RevealedCard {
    return {
      pan: this.pan,
      cvc: this.cvc,
      expMonth: this.expMonth,
      expYear: this.expYear,
      name: this.name,
    };
  }

  /** Saca el PAN y el CVC de un texto cualquiera antes de que se muestre. */
  redact(text: string): string {
    let out = text.split(this.pan).join(`«PAN ••${this.last4}»`);
    out = out.split(spaced(this.pan)).join(`«PAN ••${this.last4}»`);
    out = out.split(this.cvc).join("«CVC»");
    return out;
  }

  toString(): string {
    return `CardCredentials(${this.brand} ••${this.last4})`;
  }

  toJSON(): { brand: string; last4: string } {
    return { brand: this.brand, last4: this.last4 };
  }

  /** `console.log` de un objeto usa esto, no `toString`. */
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return this.toString();
  }
}

/**
 * Valida antes de que el comercio opine.
 *
 * Un PAN mal tipeado hace que el checkout diga "datos inválidos" y que nosotros
 * concluyamos que la tarjeta no sirve. Ese diagnóstico falso es peor que un
 * error acá, que cuesta cero.
 */
function checked(input: RevealedCard): RevealedCard {
  if (input.pan.length < 13 || input.pan.length > 19) {
    throw new Error(`El PAN tiene ${input.pan.length} dígitos; se esperaban entre 13 y 19.`);
  }
  if (!luhn(input.pan)) {
    throw new Error(
      "El PAN no pasa la validación de Luhn: está mal tipeado. " +
        "Corregilo antes de correr el test, o el rechazo del comercio va a ser culpa nuestra.",
    );
  }
  if (input.cvc.length < 3 || input.cvc.length > 4) {
    throw new Error(`El CVC tiene ${input.cvc.length} dígitos; se esperaban 3 o 4.`);
  }
  if (input.name.trim() === "") throw new Error("La tarjeta vino sin titular.");
  return input;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Falta ${key}. Ver .env.example.`);
  }
  return value;
}

function digits(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Acepta `M/AA`, `MM/AA`, `MM/AAAA`, `MM-AAAA` y `MMAA`.
 *
 * Cuando hay separador se parte por ahí en vez de contar dígitos: es lo que
 * permite entender un mes de un solo dígito, que es como lo escribe cualquiera
 * copiando "9/28" de la app del banco.
 */
function parseExpiry(raw: string): { month: string; year: string } {
  const separated = raw.trim().split(/[^\d]+/).filter((part) => part !== "");

  let month: string;
  let year: string;

  if (separated.length === 2) {
    [month, year] = separated as [string, string];
  } else {
    const flat = digits(raw);
    if (flat.length !== 4 && flat.length !== 6) {
      throw new Error(`AGENT_CARD_TEST_EXP="${raw}" no parece MM/AA ni MM/AAAA.`);
    }
    month = flat.slice(0, 2);
    year = flat.slice(2);
  }

  if (month.length > 2 || year.length !== 2 && year.length !== 4) {
    throw new Error(`AGENT_CARD_TEST_EXP="${raw}" no parece MM/AA ni MM/AAAA.`);
  }

  const monthNum = Number(month);
  if (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12) {
    throw new Error(`El mes de vencimiento es ${month}, que no existe.`);
  }

  return {
    month: String(monthNum).padStart(2, "0"),
    year: year.length === 2 ? `20${year}` : year,
  };
}

function luhn(pan: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = pan.length - 1; i >= 0; i--) {
    let digit = pan.charCodeAt(i) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function brandOf(pan: string): string {
  if (pan.startsWith("4")) return "visa";
  if (/^5[1-5]/.test(pan) || /^2[2-7]/.test(pan)) return "mastercard";
  if (/^3[47]/.test(pan)) return "amex";
  return "desconocida";
}

/** `4111 1111 1111 1111` además de `4111111111111111`, que es como queda en el DOM. */
function spaced(pan: string): string {
  return (pan.match(/.{1,4}/g) ?? []).join(" ");
}
