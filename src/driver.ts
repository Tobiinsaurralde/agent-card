import type { Browser, Frame, Locator, Page } from "playwright-core";
import { chromium } from "playwright-core";
import { classifyOutcome, type CheckoutOutcome, type PageEvidence } from "./checkout.js";
import type { CardCredentials } from "./credentials.js";

/**
 * Manejar un checkout real: llenar la tarjeta, enviar, y leer qué contestó el
 * comercio.
 *
 * Dos reglas que no son negociables acá.
 *
 * **Un intento por corrida.** No hay reintento automático en ningún camino. Pegarle
 * varias veces al mismo checkout con la misma tarjeta es exactamente el patrón del
 * card testing: el banco te bloquea la tarjeta de verdad y el comercio te marca.
 * Si hace falta reintentar, lo decide una persona, cambiando de comercio.
 *
 * **Fallar fuerte antes que adivinar.** Si no encuentra el formulario, tira con lo
 * que vio en la página en vez de enviar algo a medio llenar. Un envío incompleto
 * devuelve "datos inválidos" y nos haría concluir que la tarjeta no sirve, que es
 * la conclusión equivocada más cara del proyecto.
 */

export interface AttemptRequest {
  /** URL del checkout, ya con el carrito armado. */
  url: string;
  card: CardCredentials;
  /** WebSocket CDP de la sesión del browser (Steel lo da en `connectUrl`). */
  connectUrl: string;
  /** Cuánto esperar el veredicto después de enviar. */
  verdictTimeoutMs?: number;
  /** Dónde dejar la captura del resultado. Sin esto, no saca ninguna. */
  screenshotPath?: string;
}

export interface AttemptReport {
  outcome: CheckoutOutcome;
  /** URL donde terminó, que suele decir tanto como el texto. */
  finalUrl: string;
  /** Los campos que encontró y llenó, para saber si el formulario se entendió. */
  filled: string[];
  screenshotPath: string | null;
}

/** Los selectores que un checkout puede usar para cada campo, del más confiable al menos. */
const FIELD_SELECTORS = {
  number: [
    '[autocomplete="cc-number"]',
    'input[name*="cardnumber" i]',
    'input[name*="card_number" i]',
    'input[name*="cardNumber" i]',
    'input[id*="cardnumber" i]',
    'input[id*="card-number" i]',
    'input[placeholder*="card number" i]',
    'input[placeholder*="número de tarjeta" i]',
    'input[aria-label*="card number" i]',
  ],
  expiry: [
    '[autocomplete="cc-exp"]',
    'input[name*="exp-date" i]',
    'input[name*="expiry" i]',
    'input[name*="expiration" i]',
    'input[id*="expiry" i]',
    'input[id*="exp-date" i]',
    'input[placeholder*="MM / YY" i]',
    'input[placeholder*="MM/YY" i]',
    'input[placeholder*="MM / AA" i]',
  ],
  expiryMonth: ['[autocomplete="cc-exp-month"]', '[name*="exp_month" i]', '[name*="expMonth" i]'],
  expiryYear: ['[autocomplete="cc-exp-year"]', '[name*="exp_year" i]', '[name*="expYear" i]'],
  cvc: [
    '[autocomplete="cc-csc"]',
    'input[name*="cvc" i]',
    'input[name*="cvv" i]',
    'input[name*="security_code" i]',
    'input[id*="cvc" i]',
    'input[id*="cvv" i]',
    'input[placeholder*="CVC" i]',
    'input[placeholder*="CVV" i]',
  ],
  name: [
    '[autocomplete="cc-name"]',
    'input[name*="cardholder" i]',
    'input[name*="card_name" i]',
    'input[name*="nameOnCard" i]',
    'input[placeholder*="name on card" i]',
    'input[placeholder*="titular" i]',
  ],
} as const;

const SUBMIT_SELECTORS = [
  'button[type="submit"]:visible',
  'input[type="submit"]:visible',
  "button:has-text('Pay'):visible",
  "button:has-text('Place order'):visible",
  "button:has-text('Complete order'):visible",
  "button:has-text('Confirm'):visible",
  "button:has-text('Pagar'):visible",
  "button:has-text('Finalizar'):visible",
  "button:has-text('Confirmar'):visible",
];

export class CheckoutDriver {
  /**
   * Corre **un** intento y devuelve el veredicto. Que sea un método suelto y no
   * un objeto con estado es a propósito: no hay dónde guardar un contador de
   * reintentos porque no hay reintentos.
   */
  async attempt(req: AttemptRequest): Promise<AttemptReport> {
    const browser = await chromium.connectOverCDP(req.connectUrl);
    try {
      const page = await currentPage(browser);
      await page.goto(req.url, { waitUntil: "domcontentloaded" });

      const filled = await this.fillCard(page, req.card);
      await this.submit(page, req.card);

      const evidence = await this.readVerdict(page, req.verdictTimeoutMs ?? 30_000);
      const outcome = classifyOutcome(evidence);

      let screenshotPath: string | null = null;
      if (req.screenshotPath !== undefined) {
        // Solo de la página de resultado: una captura antes de enviar tendría el
        // número a la vista en el formulario.
        await page.screenshot({ path: req.screenshotPath, fullPage: true });
        screenshotPath = req.screenshotPath;
      }

      return { outcome, finalUrl: page.url(), filled, screenshotPath };
    } finally {
      // Cerrar la conexión CDP, no el browser: la sesión es de Steel y la libera quien la abrió.
      await browser.close();
    }
  }

  /** Llena la tarjeta, buscando también dentro de los iframes del procesador. */
  private async fillCard(page: Page, card: CardCredentials): Promise<string[]> {
    const secret = card.reveal();
    const filled: string[] = [];

    const number = await findField(page, FIELD_SELECTORS.number);
    if (number === null) {
      throw new FormNotFoundError(
        "No encontré el campo del número de tarjeta.",
        await describeInputs(page, card),
      );
    }
    await fillSafely(number, secret.pan, card, "número");
    filled.push("número");

    const combined = await findField(page, FIELD_SELECTORS.expiry);
    if (combined !== null) {
      await fillSafely(combined, `${secret.expMonth}/${secret.expYear.slice(-2)}`, card, "vencimiento");
      filled.push("vencimiento");
    } else {
      const month = await findField(page, FIELD_SELECTORS.expiryMonth);
      const year = await findField(page, FIELD_SELECTORS.expiryYear);
      if (month === null || year === null) {
        throw new FormNotFoundError(
          "Encontré el número pero no el vencimiento.",
          await describeInputs(page, card),
        );
      }
      await setValue(month, secret.expMonth, card, "mes");
      await setValue(year, secret.expYear, card, "año");
      filled.push("vencimiento (mes y año)");
    }

    const cvc = await findField(page, FIELD_SELECTORS.cvc);
    if (cvc === null) {
      throw new FormNotFoundError(
        "Encontré el número pero no el código de seguridad.",
        await describeInputs(page, card),
      );
    }
    await fillSafely(cvc, secret.cvc, card, "CVC");
    filled.push("CVC");

    // El titular es opcional de verdad: muchos checkouts no lo piden.
    const name = await findField(page, FIELD_SELECTORS.name);
    if (name !== null) {
      await fillSafely(name, secret.name, card, "titular");
      filled.push("titular");
    }

    return filled;
  }

  private async submit(page: Page, card: CardCredentials): Promise<void> {
    for (const selector of SUBMIT_SELECTORS) {
      const button = page.locator(selector).first();
      try {
        if ((await button.count()) === 0) continue;
        await button.click({ timeout: 5_000 });
        return;
      } catch (error) {
        throw new Error(card.redact(`No pude clickear "${selector}": ${message(error)}`));
      }
    }
    throw new FormNotFoundError(
      "Llené la tarjeta pero no encontré el botón de pagar.",
      await describeInputs(page, card),
    );
  }

  /**
   * Espera un veredicto concluyente, con un techo de tiempo. Devuelve en cuanto
   * la página dice algo: no tiene sentido esperar 30 segundos si a los 2 ya
   * apareció el rechazo.
   */
  private async readVerdict(page: Page, timeoutMs: number): Promise<PageEvidence> {
    const started = Date.now();
    let last = await evidenceOf(page);

    while (Date.now() - started < timeoutMs) {
      last = await evidenceOf(page);
      if (classifyOutcome(last).kind !== "desconocido") return last;
      await page.waitForTimeout(1_000);
    }
    return last;
  }
}

/**
 * No encontrar el formulario es distinto de que la tarjeta sea rechazada, y hay
 * que poder distinguirlos: uno es un bug nuestro, el otro es el dato que fuimos a
 * buscar. `inputs` trae lo que había en la página para poder ajustar selectores.
 */
export class FormNotFoundError extends Error {
  constructor(
    message: string,
    readonly inputs: string[],
  ) {
    super(`${message}\nCampos que vi en la página:\n${inputs.map((i) => `  · ${i}`).join("\n")}`);
    this.name = "FormNotFoundError";
  }
}

/** Busca en el frame principal y en los iframes, que es donde vive Stripe Elements. */
async function findField(page: Page, selectors: readonly string[]): Promise<Locator | null> {
  for (const selector of selectors) {
    for (const frame of page.frames()) {
      const locator = frame.locator(selector).first();
      try {
        if ((await locator.count()) > 0 && (await locator.isVisible())) return locator;
      } catch {
        // Un frame puede morirse mientras lo recorremos; no es un error del intento.
      }
    }
  }
  return null;
}

async function fillSafely(
  field: Locator,
  value: string,
  card: CardCredentials,
  label: string,
): Promise<void> {
  try {
    await field.fill(value, { timeout: 10_000 });
  } catch (error) {
    // El mensaje de Playwright incluye el valor que intentó escribir.
    throw new Error(card.redact(`No pude llenar el ${label}: ${message(error)}`));
  }
}

/** Para `<select>` de mes y año, donde `fill` no sirve. */
async function setValue(
  field: Locator,
  value: string,
  card: CardCredentials,
  label: string,
): Promise<void> {
  try {
    const tag = await field.evaluate((el) => el.tagName.toLowerCase());
    if (tag === "select") {
      await field.selectOption(value, { timeout: 10_000 });
    } else {
      await field.fill(value, { timeout: 10_000 });
    }
  } catch (error) {
    throw new Error(card.redact(`No pude setear el ${label}: ${message(error)}`));
  }
}

async function evidenceOf(page: Page): Promise<PageEvidence> {
  const [text, title] = await Promise.all([
    page
      .locator("body")
      .innerText({ timeout: 5_000 })
      .catch(() => ""),
    page.title().catch(() => ""),
  ]);
  return { url: page.url(), text, title };
}

/** Qué inputs había, para poder arreglar los selectores sin adivinar. */
async function describeInputs(page: Page, card: CardCredentials): Promise<string[]> {
  const out: string[] = [];
  for (const frame of page.frames()) {
    const described = await describeFrame(frame).catch(() => []);
    for (const item of described) {
      // El `value` nunca se lee acá, pero el `name` de un campo puede venir con
      // datos y redactar es más barato que confiar.
      out.push(card.redact(item));
    }
  }
  return out.length === 0 ? ["(ninguno)"] : out;
}

function describeFrame(frame: Frame): Promise<string[]> {
  return frame.evaluate(() =>
    Array.from(document.querySelectorAll("input, select")).map((el) => {
      const input = el as HTMLInputElement;
      const bits = [
        input.tagName.toLowerCase(),
        input.type ? `type=${input.type}` : "",
        input.name ? `name=${input.name}` : "",
        input.id ? `id=${input.id}` : "",
        input.autocomplete ? `autocomplete=${input.autocomplete}` : "",
        input.placeholder ? `placeholder=${input.placeholder}` : "",
      ].filter((bit) => bit !== "");
      return bits.join(" ");
    }),
  );
}

async function currentPage(browser: Browser): Promise<Page> {
  const context = browser.contexts()[0] ?? (await browser.newContext());
  return context.pages()[0] ?? (await context.newPage());
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
