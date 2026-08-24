import type { Page } from "playwright-core";
import { MissingBuyerFieldError, requireContact, type BuyerIdentity } from "../buyer.js";
import { attachPage } from "../driver.js";

/**
 * Llevar a Porkbun hasta la pantalla de la tarjeta.
 *
 * Un agente que compra un dominio no arranca en el formulario de la tarjeta:
 * busca, mete al carrito, crea o entra a la cuenta, y recién ahí paga. Si eso
 * lo hace un humano, no estamos midiendo el producto.
 */

export interface PorkbunPrep {
  domain: string;
  buyer: BuyerIdentity;
  connectUrl: string;
  /**
   * De dónde sale el código que Porkbun manda por mail. Devolver `null` si no se
   * puede conseguir; ahí el flujo corta y lo dice, en vez de quedarse colgado.
   */
  emailCode?: EmailCodeSource;
}

/** Resuelve un código de verificación de un solo uso. */
export type EmailCodeSource = () => Promise<string | null>;

export async function preparePorkbunCheckout(opts: PorkbunPrep): Promise<void> {
  const { browser, page } = await attachPage(opts.connectUrl);
  try {
    await addDomain(page, opts.domain);
    await openAccount(page);
    await ensureSignedIn(page, opts.buyer);
    await passEmailVerification(page, opts.emailCode);
    await fillContactIfAsked(page, opts.buyer);
    await page.waitForTimeout(2_000);
  } finally {
    // Cerrar la conexión CDP, no el Chrome: el driver se vuelve a conectar para pagar.
    await browser.close();
  }
}

async function addDomain(page: Page, domain: string): Promise<void> {
  await page.goto(`https://porkbun.com/checkout/search?q=${encodeURIComponent(domain)}`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(2_000);

  const already = page.getByRole("button", { name: new RegExp(`Remove ${escapeRe(domain)}`, "i") });
  if ((await already.count()) > 0) return;

  const add = page.getByRole("button", { name: new RegExp(`Add ${escapeRe(domain)} to cart`, "i") });
  if ((await add.count()) === 0) {
    // Sin saber qué hay en la página, "no encontré el botón" no se puede depurar.
    const seen = await describeActions(page);
    throw new Error(
      `Porkbun no muestra el botón para agregar ${domain}.\n` +
        `URL: ${page.url()}\n` +
        `Botones y links que sí veo:\n${seen}`,
    );
  }
  await add.first().click();
  await page.waitForTimeout(2_000);
}

/** Los textos accionables de la página, para que un fallo sea legible. */
async function describeActions(page: Page): Promise<string> {
  const labels = await page
    .evaluate(() => {
      const nodes = document.querySelectorAll<HTMLElement>('button, a, [role="button"], input[type="submit"]');
      const out: string[] = [];
      for (const node of nodes) {
        if (node.offsetParent === null && node.tagName !== "INPUT") continue;
        const text = (node.innerText || node.getAttribute("value") || "").trim().replace(/\s+/g, " ");
        if (text !== "" && text.length < 80) out.push(text);
      }
      return [...new Set(out)].slice(0, 40);
    })
    .catch(() => [] as string[]);
  if (labels.length === 0) return "  (ninguno: la página puede estar mostrando un desafío)";
  return labels.map((l) => `  · ${l}`).join("\n");
}

async function openAccount(page: Page): Promise<void> {
  await page.goto(
    "https://porkbun.com/account/create?createNew=1&redir=%2Fcheckout%2Fcart%3Fbilling%3D1#createNewAccount",
    { waitUntil: "domcontentloaded", timeout: 60_000 },
  );
  await page.waitForTimeout(2_000);
}

/**
 * Crear la cuenta de Porkbun, con los nombres de campo reales del formulario.
 *
 * Termina en un captcha (`porkcaptcha-token_accountCreate`), y eso no es un
 * detalle: **crear la cuenta no es parte de la compra**. Es provisioning, se hace
 * una vez, y un captcha ahí es una decisión del comercio sobre altas de usuario,
 * no sobre pagos. Lo que tiene que poder hacer un agente solo es entrar a una
 * cuenta que ya existe y pagar.
 */
async function ensureSignedIn(page: Page, buyer: BuyerIdentity): Promise<void> {
  if (await looksSignedIn(page)) return;

  requireContact(buyer);
  if (buyer.postal === null) {
    throw new MissingBuyerFieldError(["AGENT_CARD_TEST_POSTAL"]);
  }

  const username = await firstVisible(page, ["#newAccountUsername", 'input[name="newAccountUsername"]']);
  const password = await firstVisible(page, ["#newAccountPassword", 'input[name="newAccountPassword"]']);

  if (username === null || password === null) {
    // Sin formulario de alta, el único camino que queda es una cuenta ya creada.
    await loginExisting(page, buyer);
    return;
  }

  await username.fill(buyer.username);
  await password.fill(buyer.password);
  await fillFirst(page, ["#newAccountEmail", 'input[name="email"]'], buyer.email);
  await fillFirst(page, ["#newAccountFirstName"], buyer.firstName);
  await fillFirst(page, ["#newAccountLastName"], buyer.lastName);
  await fillFirst(page, ["#newAccountAddress1"], buyer.street);
  await fillFirst(page, ["#newAccountCity"], buyer.city);
  await fillFirst(page, ["#newAccountZip"], buyer.postal);
  await fillFirst(page, ["#newAccountPhone"], buyer.phone);

  await selectFirst(page, ["#newAccountCountry"], buyer.country, "Argentina");
  // El select de provincia lo llena JS recién después de elegir el país, así que
  // hay que esperar a que tenga opciones antes de intentar elegir una.
  if (buyer.region !== null) {
    await selectRegion(page, buyer.region);
  }

  const tos = await firstVisible(page, ["#tosAgreement", 'input[name="tosAgreement"]']);
  if (tos !== null) await tos.check().catch(() => undefined);

  const noSpam = await firstVisible(page, ["#newAccountSubscribeNo"]);
  if (noSpam !== null) await noSpam.check().catch(() => undefined);

  // porkcaptcha puede ser invisible y resolverse solo. Le damos tiempo antes de
  // declararlo un muro: dar por perdido el captcha sin intentarlo sería inventar
  // un límite que quizá no existe.
  await waitForCaptchaToken(page, 25_000);

  const submit = page.getByRole("button", { name: /create|sign up|register|crear/i }).first();
  if ((await submit.count()) > 0) {
    // El botón se habilita cuando el formulario valida. Si sigue deshabilitado,
    // clickearlo es esperar 30 segundos para no aprender nada: mejor contar qué
    // quedó sin llenar.
    if (!(await waitEnabled(submit, 10_000))) {
      throw new AccountRejectedError(await readFormState(page));
    }
    await submit.click();
  } else {
    await password.press("Enter");
  }
  await page.waitForTimeout(5_000);

  const body = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
  if (/already (exists|registered|taken)|ya (existe|está registrado)/i.test(body)) {
    await loginExisting(page, buyer);
    return;
  }
  if (await looksSignedIn(page)) return;

  if (/captcha|are you a (human|robot)|verificación/i.test(body)) {
    throw new AccountCaptchaError();
  }
  // Seguimos en el alta: el formulario rechazó algo. Sin leer su queja, esto se
  // ve igual que un muro y no lo es.
  if (page.url().includes("/account/create")) {
    throw new AccountRejectedError(await readValidationErrors(page));
  }
}

/** El alta se rechazó y el formulario dijo por qué. */
export class AccountRejectedError extends Error {
  constructor(readonly complaints: string[]) {
    const detail =
      complaints.length === 0
        ? "  (el formulario no mostró un motivo visible)"
        : complaints.map((c) => `  · ${c}`).join("\n");
    super(`Porkbun rechazó el alta de cuenta:\n${detail}`);
    this.name = "AccountRejectedError";
  }
}

async function selectRegion(page: Page, region: string): Promise<void> {
  const select = page.locator("#newAccountState");
  if ((await select.count()) === 0) return;

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const options = await select.locator("option").count();
    if (options > 1) break;
    await page.waitForTimeout(500);
  }

  for (const attempt of [{ label: region }, { value: region }]) {
    if (await select.selectOption(attempt).then(() => true, () => false)) return;
  }
  // Última opción: buscar la provincia por coincidencia parcial en las etiquetas.
  const match = await select
    .evaluate((el, wanted: string) => {
      const sel = el as HTMLSelectElement;
      const needle = wanted.toLowerCase();
      for (const option of sel.options) {
        if (option.text.toLowerCase().includes(needle)) return option.value;
      }
      return null;
    }, region)
    .catch(() => null);
  if (match !== null) await select.selectOption({ value: match }).catch(() => undefined);
}

async function waitEnabled(
  locator: import("playwright-core").Locator,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await locator.isEnabled().catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/**
 * Qué quedó vacío o inválido en el formulario. Reporta nombres y estado, nunca
 * valores: acá hay una contraseña.
 */
async function readFormState(page: Page): Promise<string[]> {
  const state = await page
    .evaluate(() => {
      const out: string[] = [];
      const fields = document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
        "#newAccountUsername, #newAccountPassword, #newAccountEmail, #newAccountFirstName, " +
          "#newAccountLastName, #newAccountAddress1, #newAccountCity, #newAccountZip, " +
          "#newAccountPhone, #newAccountCountry, #newAccountState, #newAccountPhoneCode",
      );
      for (const field of fields) {
        const empty = field.value.trim() === "";
        const invalid = field.className.includes("invalid");
        if (empty || invalid) {
          out.push(`${field.id}: ${empty ? "vacío" : "marcado inválido"}`);
        }
      }
      const tos = document.querySelector<HTMLInputElement>("#tosAgreement");
      if (tos !== null && !tos.checked) out.push("tosAgreement: sin tildar");
      const captcha = document.querySelector<HTMLInputElement>('input[name^="porkcaptcha-token"]');
      if (captcha !== null && captcha.value.trim() === "") out.push("porkcaptcha: sin resolver");
      return out;
    })
    .catch(() => [] as string[]);
  const complaints = await readValidationErrors(page);
  return [...state, ...complaints];
}

async function readValidationErrors(page: Page): Promise<string[]> {
  return page
    .evaluate(() => {
      const nodes = document.querySelectorAll<HTMLElement>(
        '.invalid-feedback, .is-invalid, .alert-danger, .error, [class*="error" i], [role="alert"]',
      );
      const out: string[] = [];
      for (const node of nodes) {
        if (node.offsetParent === null) continue;
        const text = node.innerText.trim().replace(/\s+/g, " ");
        if (text !== "" && text.length < 200) out.push(text);
      }
      return [...new Set(out)].slice(0, 12);
    })
    .catch(() => [] as string[]);
}

/** Espera a que el token del captcha se llene solo. `true` si llegó. */
async function waitForCaptchaToken(page: Page, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await page
      .evaluate(() => {
        const token = document.querySelector<HTMLInputElement>('input[name^="porkcaptcha-token"]');
        if (token === null) return "absent";
        return token.value.trim() === "" ? "empty" : "filled";
      })
      .catch(() => "absent");
    if (state !== "empty") return true;
    await page.waitForTimeout(1_000);
  }
  return false;
}

/**
 * Porkbun manda un código al mail antes de dejar seguir. Es un paso de alta de
 * cuenta, no del pago: si no hay de dónde leer el mail, cortamos acá y lo
 * decimos, porque adivinar un código de seis dígitos no es una estrategia.
 */
async function passEmailVerification(page: Page, source?: EmailCodeSource): Promise<void> {
  const field = await firstVisible(page, [
    "#modal_verifySessionEmail_code",
    'input[name="modal_verifySessionEmail_code"]',
  ]);
  if (field === null) return;

  if (source === undefined) throw new EmailCodeError();
  const code = await source();
  if (code === null) throw new EmailCodeError();

  await field.fill(code);
  const submit = page.getByRole("button", { name: /verify|confirm|submit|continue/i }).first();
  if ((await submit.count()) > 0) await submit.click();
  else await field.press("Enter");
  await page.waitForTimeout(4_000);
}

/** Falta el código que Porkbun mandó por mail. */
export class EmailCodeError extends Error {
  constructor() {
    super("Porkbun pide un código enviado por mail y el agente no tiene de dónde leerlo.");
    this.name = "EmailCodeError";
  }
}

/** El alta de cuenta está protegida por captcha. No es un problema del pago. */
export class AccountCaptchaError extends Error {
  constructor() {
    super(
      "Porkbun protege el alta de cuenta con captcha (porkcaptcha). Crear la cuenta es " +
        "provisioning, no parte de la compra: hacela una vez y el agente después entra y paga solo.",
    );
    this.name = "AccountCaptchaError";
  }
}

async function hasCaptcha(page: Page): Promise<boolean> {
  return page
    .evaluate(() => {
      const token = document.querySelector<HTMLInputElement>(
        'input[name^="porkcaptcha-token"], input[name*="captcha" i]',
      );
      if (token !== null && token.value.trim() === "") return true;
      return (
        document.querySelector('iframe[src*="recaptcha"], iframe[src*="turnstile"], iframe[src*="hcaptcha"]') !==
        null
      );
    })
    .catch(() => false);
}

async function fillFirst(page: Page, selectors: string[], value: string | null): Promise<void> {
  if (value === null || value === "") return;
  const field = await firstVisible(page, selectors);
  if (field !== null) await field.fill(value).catch(() => undefined);
}

async function selectFirst(
  page: Page,
  selectors: string[],
  value: string,
  label: string,
): Promise<void> {
  const field = await firstVisible(page, selectors);
  if (field === null) return;
  await field.selectOption({ value }).catch(async () => {
    await field.selectOption({ label }).catch(() => undefined);
  });
}

async function loginExisting(page: Page, buyer: BuyerIdentity): Promise<void> {
  const loginLink = page.getByRole("link", { name: /sign in|log in|iniciar/i }).first();
  if ((await loginLink.count()) > 0) await loginLink.click();
  await page.waitForTimeout(1_500);

  const email = await firstVisible(page, ['input[type="email"]', 'input[name*="email" i]']);
  const password = await firstVisible(page, ['input[type="password"]']);
  if (email === null || password === null) {
    throw new Error("La cuenta ya existe y no encontré el login.");
  }
  await email.fill(buyer.email);
  await password.fill(buyer.password);
  const submit = page.getByRole("button", { name: /sign in|log in|continue|ingresar/i }).first();
  if ((await submit.count()) > 0) await submit.click();
  else await password.press("Enter");
  await page.waitForTimeout(3_000);
}

async function fillContactIfAsked(page: Page, buyer: BuyerIdentity): Promise<void> {
  const streetField = await firstVisible(page, [
    'input[name*="address" i]',
    'input[autocomplete="street-address"]',
    'input[autocomplete="address-line1"]',
  ]);
  if (streetField === null) return;

  requireContact(buyer);

  const fillIf = async (selectors: string[], value: string | null): Promise<void> => {
    if (value === null) return;
    const field = await firstVisible(page, selectors);
    if (field !== null) await field.fill(value);
  };

  await fillIf(['input[name*="first" i]', 'input[autocomplete="given-name"]'], buyer.firstName);
  await fillIf(['input[name*="last" i]', 'input[autocomplete="family-name"]'], buyer.lastName);
  await streetField.fill(buyer.street ?? "");
  await fillIf(['input[name*="city" i]', 'input[autocomplete="address-level2"]'], buyer.city);
  await fillIf(
    ['input[name*="state" i]', 'input[name*="region" i]', 'input[autocomplete="address-level1"]'],
    buyer.region,
  );
  await fillIf(
    ['input[name*="zip" i]', 'input[name*="postal" i]', 'input[autocomplete="postal-code"]'],
    buyer.postal,
  );
  await fillIf(['input[name*="phone" i]', 'input[type="tel"]', 'input[autocomplete="tel"]'], buyer.phone);

  const country = await firstVisible(page, [
    'select[name*="country" i]',
    'select[autocomplete="country"]',
  ]);
  if (country !== null) {
    await country.selectOption({ value: buyer.country }).catch(async () => {
      await country.selectOption({ label: "Argentina" }).catch(() => undefined);
    });
  }

  const next = page.getByRole("button", { name: /continue|save|next|continuar|guardar/i }).first();
  if ((await next.count()) > 0) await next.click();
  await page.waitForTimeout(2_000);
}

/**
 * Solo un "sign out" cuenta como sesión abierta. Buscar "account" era un falso
 * positivo garantizado: la propia pantalla de alta dice "Create a New Account",
 * y con eso el agente se salteaba el registro y llegaba al pago sin cuenta.
 */
async function looksSignedIn(page: Page): Promise<boolean> {
  const text = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
  return /sign out|log out|logout|cerrar sesión/.test(text);
}

async function firstVisible(page: Page, selectors: string[]): Promise<import("playwright-core").Locator | null> {
  for (const selector of selectors) {
    const loc = page.locator(selector).first();
    try {
      if ((await loc.count()) > 0 && (await loc.isVisible())) return loc;
    } catch {
      // frame muerto
    }
  }
  return null;
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
