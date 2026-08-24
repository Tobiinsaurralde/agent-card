import type { Locator, Page } from "playwright-core";
import { MissingBuyerFieldError, requireContact, type BuyerIdentity } from "../buyer.js";
import { attachPage } from "../driver.js";
import type { EmailCodeSource } from "./porkbun.js";

/**
 * Llevar a Spaceship hasta la pantalla de la tarjeta.
 *
 * Se eligió sobre Porkbun por dos motivos medidos, no por gusto: el alta no tiene
 * captcha (ver `harness/recon-signup.ts`) y el `.xyz` sale más barato, lo que deja
 * margen sobre el saldo de la tarjeta. Ese margen importa: comprar por USD 2.04
 * con USD 2.16 encima hace que un rechazo sea ambiguo entre "no la aceptan" y
 * "no alcanzó por centavos de conversión", y esa ambigüedad arruina la medición.
 */

export interface SpaceshipPrep {
  domain: string;
  buyer: BuyerIdentity;
  connectUrl: string;
  emailCode?: EmailCodeSource;
}

export async function prepareSpaceshipCheckout(opts: SpaceshipPrep): Promise<void> {
  const { browser, page } = await attachPage(opts.connectUrl);
  try {
    const price = await addDomain(page, opts.domain);
    console.log(`  carrito: ${opts.domain} a USD ${price ?? "?"}`);

    await ensureSignedIn(page, opts.buyer, opts.emailCode);
    await openCheckout(page);
  } finally {
    // Cerrar la conexión CDP, no el Chrome: el driver se vuelve a conectar para pagar.
    await browser.close();
  }
}

/**
 * Agrega el dominio exacto al carrito y devuelve el precio que mostró.
 *
 * La página de resultados trae docenas de "Add to cart", uno por sugerencia. Hay
 * que clickear el de nuestro dominio y no el de un `.ai` de USD 80.
 */
async function addDomain(page: Page, domain: string): Promise<string | null> {
  await page.goto(`https://www.spaceship.com/domain-search/?query=${encodeURIComponent(domain)}`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(8_000);

  const row = await findDomainRow(page, domain);
  if (row === null) {
    throw new SpaceshipError(
      `No encontré ${domain} entre los resultados.`,
      await describeResults(page),
    );
  }

  if (/remove|in cart/i.test(row.text)) return row.price;

  const button = row.locator.getByRole("button", { name: /add to cart/i }).first();
  if ((await button.count()) === 0) {
    throw new SpaceshipError(`Encontré ${domain} pero no su botón de carrito.`, [row.text]);
  }
  await button.click();
  await page.waitForTimeout(4_000);
  return row.price;
}

interface DomainRow {
  locator: Locator;
  text: string;
  price: string | null;
}

/**
 * El bloque de resultado que corresponde al dominio exacto.
 *
 * Se busca por el botón y se sube al contenedor, en vez de bajar desde un
 * selector de layout: las clases de este sitio son generadas y cambian solas,
 * los botones no.
 */
async function findDomainRow(page: Page, domain: string): Promise<DomainRow | null> {
  const buttons = page.getByRole("button", { name: /add to cart|remove/i });
  const total = await buttons.count();

  for (let i = 0; i < total; i += 1) {
    const button = buttons.nth(i);
    const container = button.locator(
      "xpath=ancestor::*[self::li or self::tr or self::div][1]/ancestor-or-self::*[3]",
    );
    const text = await container
      .first()
      .innerText()
      .then((t) => t.replace(/\s+/g, " ").trim())
      .catch(() => "");

    // El sitio escribe las sugerencias con el punto separado ("konextech .lat"),
    // así que el dominio pegado sólo aparece en el resultado exacto.
    if (!text.includes(domain)) continue;
    return { locator: container.first(), text, price: readPrice(text) };
  }
  return null;
}

/** El precio del primer año, que es el número más chico de la fila. */
function readPrice(text: string): string | null {
  const amounts = [...text.matchAll(/\$([0-9]+(?:\.[0-9]{2})?)/g)]
    .map((m) => m[1])
    .filter((v): v is string => v !== undefined)
    // Los precios "/yr" son la renovación, no lo que se cobra hoy.
    .map((v) => Number.parseFloat(v))
    .filter((v) => Number.isFinite(v));
  if (amounts.length === 0) return null;
  return Math.min(...amounts).toFixed(2);
}

async function describeResults(page: Page): Promise<string[]> {
  return page
    .evaluate(() => {
      const text = (document.body.innerText || "").replace(/\s+/g, " ").trim();
      return [text.slice(0, 600)];
    })
    .catch(() => [] as string[]);
}

/**
 * El alta de Spaceship es de varios pasos y no expone la contraseña en el
 * primero. En vez de fijar los pasos, se llena lo que haya y se avanza: así un
 * paso nuevo del sitio no rompe todo el flujo.
 */
async function ensureSignedIn(
  page: Page,
  buyer: BuyerIdentity,
  emailCode?: EmailCodeSource,
): Promise<void> {
  if (await looksSignedIn(page)) return;

  // Entrar antes que registrarse, y a propósito. Un agente que compra no crea una
  // cuenta nueva en cada compra: usa la que ya tiene. El alta es provisioning, se
  // hace una vez, y automatizarla es pelearse con el antibot del comercio para
  // ganar algo que no se repite.
  if (await login(page, buyer)) return;

  requireContact(buyer);
  if (buyer.postal === null) throw new MissingBuyerFieldError(["AGENT_CARD_TEST_POSTAL"]);

  await page.goto("https://www.spaceship.com/auth/signup/", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(6_000);

  // Cuatro vueltas alcanza para identidad, contraseña, verificación y contacto.
  for (let round = 0; round < 4; round += 1) {
    if (await looksSignedIn(page)) return;

    await fill(page, ['input[name="firstName"]', "#textfield-firstName"], buyer.firstName);
    await fill(page, ['input[name="lastName"]', "#textfield-lastName"], buyer.lastName);
    await fill(page, ['input[name="email"]', "#textfield-email"], buyer.email);
    await fill(page, ['input[name="userName"]', "#textfield-username"], buyer.username);
    await fill(page, ['input[type="password"]'], buyer.password);
    await fill(page, ['input[name="address1"]', 'input[autocomplete="address-line1"]'], buyer.street);
    await fill(page, ['input[name="city"]', 'input[autocomplete="address-level2"]'], buyer.city);
    await fill(page, ['input[name="zip"]', 'input[autocomplete="postal-code"]'], buyer.postal);
    await fill(page, ['input[type="tel"]', 'input[autocomplete="tel"]'], buyer.phone);

    const stuck = await acceptTerms(page);

    if (await fillVerificationCode(page, emailCode)) {
      // El código ya avanza solo; no hace falta buscar el botón.
      await page.waitForTimeout(5_000);
      continue;
    }

    const advanced = await clickNext(page);
    if (!advanced) {
      throw new SpaceshipError("El alta no avanza.", [...stuck, ...(await readComplaints(page))]);
    }
    await page.waitForTimeout(5_000);
  }

  if (!(await looksSignedIn(page))) {
    throw new SpaceshipError("El alta no terminó.", await readComplaints(page));
  }
}

/**
 * Entra con la cuenta de `.env`. Devuelve `false` si no se pudo, sin tirar: no
 * tener cuenta todavía es un estado válido, no un error.
 */
async function login(page: Page, buyer: BuyerIdentity): Promise<boolean> {
  await page
    .goto("https://www.spaceship.com/auth/login/", { waitUntil: "domcontentloaded", timeout: 60_000 })
    .catch(() => undefined);
  await page.waitForTimeout(6_000);

  const user = await visible(page, [
    'input[name="userName"]',
    'input[name="username"]',
    'input[name="email"]',
    'input[type="email"]',
  ]);
  if (user === null) return false;

  // Spaceship acepta usuario o mail; el usuario es lo que pide el formulario.
  await user.fill(buyer.username).catch(() => undefined);

  const password = await visible(page, ['input[type="password"]']);
  if (password === null) {
    // Login en dos pasos: primero identidad, después contraseña.
    await clickNext(page);
    await page.waitForTimeout(4_000);
  }
  const pass = await visible(page, ['input[type="password"]']);
  if (pass === null) return false;
  await pass.fill(buyer.password).catch(() => undefined);

  const submit = page.getByRole("button", { name: /^(log ?in|sign ?in|continue|next)/i }).first();
  if ((await submit.count()) > 0) await submit.click().catch(() => undefined);
  else await pass.press("Enter").catch(() => undefined);
  await page.waitForTimeout(8_000);

  return looksSignedIn(page);
}

/**
 * Tilda lo obligatorio del alta, y nada de marketing.
 *
 * La regla es al revés de lo que uno haría: se tilda todo lo que **no** se pueda
 * identificar como marketing. Suena laxo, pero es lo contrario. El checkbox de
 * términos de Spaceship no tiene `name`, `aria-label` ni `label` asociado —el id
 * lo genera React y su texto se dibuja fuera del árbol del input—, así que
 * buscarlo por texto no lo encuentra nunca y el alta queda trabada para siempre.
 * En cambio el de marketing sí se declara, y por eso se puede excluir con
 * certeza. Suscribir a alguien a un newsletter que no pidió no es una decisión
 * que le toque al agente; aceptar los términos que el propio formulario exige
 * para continuar, sí.
 */
async function acceptTerms(page: Page): Promise<string[]> {
  const boxes = page.locator('input[type="checkbox"]');
  const total = await boxes.count();
  const failures: string[] = [];

  for (let i = 0; i < total; i += 1) {
    const box = boxes.nth(i);
    if ((await box.isChecked().catch(() => false)) === true) continue;

    const label = await describeCheckbox(box);
    if (/marketing|newsletter|subscribe|offers|promo|updates/i.test(label)) continue;

    const why = await tick(box);
    if (why !== null) failures.push(why);
  }
  return failures;
}

/**
 * Tilda un checkbox de las tres formas que funcionan, en orden de preferencia.
 *
 * El input real de estos componentes está tapado por el recuadro que se dibuja,
 * y a veces tiene tamaño cero. Playwright se niega a clickear lo que no ve, y
 * `force` no siempre alcanza; el click desde el DOM sí dispara el `onChange` de
 * React. Devuelve `null` si quedó tildado, o el motivo si no.
 */
async function tick(box: Locator): Promise<string | null> {
  const attempts: Array<[string, () => Promise<unknown>]> = [
    ["check(force)", () => box.check({ force: true, timeout: 5_000 })],
    ["click en el control dibujado", () => box.locator("xpath=..").click({ timeout: 5_000 })],
    ["click desde el DOM", () => box.evaluate((el) => (el as HTMLInputElement).click())],
  ];

  const errors: string[] = [];
  for (const [name, run] of attempts) {
    try {
      await run();
    } catch (error) {
      errors.push(`${name}: ${error instanceof Error ? (error.message.split("\n")[0] ?? "") : error}`);
      continue;
    }
    if ((await box.isChecked().catch(() => false)) === true) return null;
    errors.push(`${name}: no tildó`);
  }
  return `no pude tildar un checkbox obligatorio → ${errors.join(" | ")}`;
}

/** El texto que acompaña a un checkbox, para saber a qué se está diciendo sí. */
async function describeCheckbox(box: Locator): Promise<string> {
  return box
    .evaluate((el) => {
      const input = el as HTMLInputElement;
      const parts = [
        input.name,
        input.getAttribute("aria-label") ?? "",
        input.getAttribute("aria-labelledby") === null
          ? ""
          : (document.getElementById(input.getAttribute("aria-labelledby") ?? "")?.textContent ?? ""),
        input.id === "" ? "" : (document.querySelector(`label[for="${input.id}"]`)?.textContent ?? ""),
        input.closest("label")?.textContent ?? "",
        input.parentElement?.parentElement?.textContent ?? "",
      ];
      return parts.join(" ").replace(/\s+/g, " ").trim();
    })
    .catch(() => "");
}

/**
 * Si Spaceship pide el código que mandó por mail, lo pone. Devuelve `false` si
 * no hay ningún campo de código a la vista.
 */
async function fillVerificationCode(page: Page, source?: EmailCodeSource): Promise<boolean> {
  const field = await visible(page, [
    'input[name*="code" i]',
    'input[name*="otp" i]',
    'input[autocomplete="one-time-code"]',
  ]);
  if (field === null) return false;

  if (source === undefined) throw new SpaceshipEmailCodeError();
  const code = await source();
  if (code === null) throw new SpaceshipEmailCodeError();

  await field.fill(code);
  await clickNext(page);
  return true;
}

async function clickNext(page: Page): Promise<boolean> {
  const button = page
    .getByRole("button", { name: /^(next|continue|create|sign up|submit|verify)/i })
    .first();
  if ((await button.count()) === 0) return false;

  // El botón arranca deshabilitado y se habilita cuando la validación termina, y
  // parte de esa validación va al servidor (si el usuario está libre). Chequearlo
  // una sola vez, apenas se llenan los campos, siempre da deshabilitado.
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await button.isEnabled().catch(() => false)) {
      await button.click().catch(() => undefined);
      return true;
    }
    await page.waitForTimeout(500);
  }
  return false;
}

async function openCheckout(page: Page): Promise<void> {
  await page.goto("https://www.spaceship.com/cart/", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(6_000);

  const pay = page.getByRole("button", { name: /checkout|continue to payment|pay now/i }).first();
  if ((await pay.count()) > 0) {
    await pay.click().catch(() => undefined);
    await page.waitForTimeout(8_000);
  }
}

async function looksSignedIn(page: Page): Promise<boolean> {
  const text = await page
    .locator("body")
    .innerText()
    .then((t) => t.toLowerCase())
    .catch(() => "");
  // Sólo un "log out" cuenta. Buscar "account" da falso positivo en la propia
  // pantalla de alta, que dice "Create an account".
  return /log out|sign out|logout/.test(text);
}

async function fill(page: Page, selectors: string[], value: string | null): Promise<void> {
  if (value === null || value === "") return;
  const field = await visible(page, selectors);
  if (field === null) return;
  const current = await field.inputValue().catch(() => "");
  if (current.trim() !== "") return;
  await field.fill(value).catch(() => undefined);
}

async function visible(page: Page, selectors: string[]): Promise<Locator | null> {
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

/**
 * Por qué el formulario no avanza: el estado de cada campo y lo que el sitio se
 * queja. Reporta si está vacío o inválido, nunca el valor: acá hay una contraseña.
 */
async function readComplaints(page: Page): Promise<string[]> {
  return page
    .evaluate(() => {
      const out: string[] = [];

      for (const el of document.querySelectorAll<HTMLInputElement>("input, select")) {
        if (el.offsetParent === null) continue;
        const label = el.name || el.id || el.getAttribute("placeholder") || el.type;
        const flags: string[] = [];
        if (el.value.trim() === "") flags.push("vacío");
        if (el.getAttribute("aria-invalid") === "true") flags.push("inválido");
        if (el.type === "checkbox" && !el.checked) flags.push("sin tildar");
        if (flags.length === 0) continue;
        if (el.type === "checkbox") {
          // Sin el texto no se puede saber a qué se está diciendo sí, y el id lo
          // genera React, así que no dice nada.
          const near = [
            el.getAttribute("aria-label") ?? "",
            el.id === "" ? "" : (document.querySelector(`label[for="${el.id}"]`)?.textContent ?? ""),
            el.closest("label")?.textContent ?? "",
            el.parentElement?.parentElement?.textContent ?? "",
          ]
            .join(" ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 160);
          out.push(`checkbox ${label}: ${flags.join(", ")} — texto: "${near}"`);
          continue;
        }
        out.push(`campo ${label}: ${flags.join(", ")}`);
      }

      for (const el of document.querySelectorAll<HTMLButtonElement>("button")) {
        if (el.offsetParent === null) continue;
        const text = (el.innerText || "").trim().replace(/\s+/g, " ");
        if (text !== "" && text.length < 40) {
          out.push(`botón "${text}": ${el.disabled ? "deshabilitado" : "habilitado"}`);
        }
      }

      for (const el of document.querySelectorAll<HTMLElement>('[role="alert"]')) {
        if (el.offsetParent === null) continue;
        const text = (el.innerText || "").trim().replace(/\s+/g, " ");
        // Un "1" o un "*" son adornos del layout, no un mensaje de error.
        if (text.length > 3 && text.length < 200) out.push(`mensaje: ${text}`);
      }

      const html = document.documentElement.outerHTML;
      if (/turnstile|cf-chl-widget|recaptcha|hcaptcha/i.test(html)) out.push("apareció un captcha");

      out.push(`página: ${document.title} — ${location.href}`);
      return [...new Set(out)].slice(0, 25);
    })
    .catch(() => [`no pude leer la página (${page.url()})`]);
}

export class SpaceshipError extends Error {
  constructor(
    message: string,
    readonly detail: string[],
  ) {
    const body = detail.length === 0 ? "  (sin detalle)" : detail.map((d) => `  · ${d}`).join("\n");
    super(`Spaceship: ${message}\n${body}`);
    this.name = "SpaceshipError";
  }
}

export class SpaceshipEmailCodeError extends Error {
  constructor() {
    super("Spaceship pide el código que mandó por mail y el agente no tiene de dónde leerlo.");
    this.name = "SpaceshipEmailCodeError";
  }
}
