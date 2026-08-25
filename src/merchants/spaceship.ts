import type { Locator, Page } from "playwright-core";
import type { BuyerIdentity } from "../buyer.js";
import { attachPage } from "../driver.js";
import type { EmailCodeSource } from "../otp.js";

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
    // Primero el carrito: si una corrida anterior ya dejó el dominio, buscarlo
    // de nuevo es una carrera contra el render de Spaceship y no aporta nada.
    await dismissLocale(page);
    const already = await domainInCart(page, opts.domain);
    if (already !== null) {
      console.log(`  ya estaba en el carrito: ${opts.domain} a USD ${already}`);
    } else {
      const price = await addDomain(page, opts.domain);
      console.log(`  carrito: ${opts.domain} a USD ${price ?? "?"}`);
    }

    await ensureSignedIn(page, opts.buyer, opts.emailCode);
    await openCheckout(page, opts.buyer, opts.emailCode);
  } finally {
    // Cerrar la conexión CDP, no el Chrome: el driver se vuelve a conectar para pagar.
    await browser.close();
  }
}

/** Si el dominio ya está en `/cart/`, su precio. Si no, `null`. */
async function domainInCart(page: Page, domain: string): Promise<string | null> {
  await page.goto("https://www.spaceship.com/cart/", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(6_000);
  await dismissLocale(page);
  const text = await page
    .locator("body")
    .innerText()
    .then((t) => t.replace(/\s+/g, " "))
    .catch(() => "");
  if (!text.toLowerCase().includes(domain.toLowerCase())) return null;
  return readPrice(text);
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
  // La fila exacta tarda más que las sugerencias. Cortar a los 8s es lo que
  // hizo fallar la última corrida: el .xyz todavía no estaba en el DOM.
  await page
    .getByText(domain, { exact: false })
    .first()
    .waitFor({ timeout: 25_000 })
    .catch(() => undefined);

  const row = await findDomainRow(page, domain);
  if (row === null) {
    throw new SpaceshipError(
      `No encontré ${domain} entre los resultados.`,
      await describeResults(page),
    );
  }

  // Ya está en el carrito. Con perfil persistente esto es lo normal, no la
  // excepción: el carrito sobrevive a la corrida anterior. Volver a agregarlo
  // sería duplicar el cobro.
  if (IN_CART.test(row.text)) {
    console.log("  ya estaba en el carrito de la corrida anterior");
    return row.price;
  }

  const button = row.locator.getByRole("button", { name: /add to cart/i }).first();
  if ((await button.count()) === 0) {
    throw new SpaceshipError(`Encontré ${domain} pero no su botón de carrito.`, [row.text]);
  }
  await button.click();
  await page.waitForTimeout(4_000);
  return row.price;
}

/**
 * Cómo dice el sitio que el dominio ya está en el carrito. "View Cart" es el que
 * importa: es lo que reemplaza al botón de agregar una vez que ya lo agregaste.
 */
const IN_CART = /remove|in cart|view cart/i;

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
  const buttons = page.getByRole("button", { name: /add to cart|remove|view cart/i });
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

  // La cuenta ya existe. Reintentar el alta acá es el error que nos comió las
  // últimas corridas: el login fallaba en silencio y el agente se iba a
  // registrarse de nuevo, contra un mail que Spaceship ya tiene.
  if (await login(page, buyer, emailCode)) return;
  throw new SpaceshipError(
    "No pude entrar con la cuenta que ya existe.",
    await readComplaints(page),
  );
}

/**
 * Entra con la cuenta de `.env`. Devuelve `false` si no se pudo, sin tirar: no
 * tener cuenta todavía es un estado válido, no un error.
 */
async function login(
  page: Page,
  buyer: BuyerIdentity,
  emailCode?: EmailCodeSource,
): Promise<boolean> {
  // `/auth/login/` da 404. El formulario vive en el carrito y en el redirect
  // de launchpad. Si la página actual ya lo muestra, no se navega a ningún lado.
  await dismissLocale(page);
  if (!(await hasLoginForm(page))) {
    await page.goto("https://www.spaceship.com/cart/", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(6_000);
    await dismissLocale(page);
  }

  // El default de Spaceship es passkey. Sin este click el campo de contraseña
  // no existe y el login "falla" aunque la cuenta esté bien.
  const passwordMethod = page.getByRole("button", { name: /log in with password/i }).first();
  if ((await passwordMethod.count()) > 0) {
    await passwordMethod.click().catch(() => undefined);
    await page.waitForTimeout(2_000);
  }
  await chooseAuthMethod(page);

  await fill(
    page,
    ['input[name="username"]', 'input[name="userName"]', 'input[type="email"]'],
    buyer.username,
  );
  await fill(page, ['input[name="userPassword"]', 'input[type="password"]'], buyer.password);

  const pass = await visible(page, ['input[name="userPassword"]', 'input[type="password"]']);
  if (pass === null) return false;

  const submit = page.getByRole("button", { name: /^(log ?in|sign ?in|continue|next)/i }).first();
  if ((await submit.count()) > 0) await submit.click().catch(() => undefined);
  else await pass.press("Enter").catch(() => undefined);
  await page.waitForTimeout(8_000);

  // El login también manda código por mail la primera vez en un perfil nuevo.
  if (await fillVerificationCode(page, emailCode)) await page.waitForTimeout(5_000);

  return looksSignedIn(page);
}

async function hasLoginForm(page: Page): Promise<boolean> {
  return (await visible(page, ['input[name="username"]', 'input[name="userPassword"]'])) !== null;
}

/**
 * Spaceship ofrece cambiar idioma y moneda. El modal tapa los clicks del
 * login y del carrito; "No, don't change" lo cierra sin tocar preferencias.
 */
async function dismissLocale(page: Page): Promise<void> {
  const no = page.getByRole("button", { name: /no, don't change/i }).first();
  if ((await no.count()) === 0) return;
  await no.click().catch(() => undefined);
  await page.waitForTimeout(1_000);
}

/**
 * Cierra drawers que tapan el Checkout: suscripción, "remove from cart",
 * el modal de idioma. Sin esto el botón existe pero no se puede clickear.
 */
async function dismissOverlays(page: Page): Promise<void> {
  await dismissLocale(page);
  for (const name of [/^(close)$/i, /^no,? thanks/i, /^not now/i, /^skip/i]) {
    const btn = page.getByRole("button", { name }).first();
    if ((await btn.count()) === 0) continue;
    if (!(await btn.isVisible().catch(() => false))) continue;
    await btn.click().catch(() => undefined);
    await page.waitForTimeout(800);
  }
}

/**
 * Elige contraseña como método de autenticación.
 *
 * Los dos checkboxes sin `name` del alta de Spaceship no son términos: son
 * "Password" y "Passkey", dibujados como checkboxes pero excluyentes entre sí.
 * Tildar a ciegas todo lo que no fuera marketing elegía Passkey —queda último en
 * el DOM— y el botón pasaba a "Sign up with passkey", que pide biometría o una
 * llave física. Un agente no puede responder eso, así que el alta quedaba
 * trabada de una forma que desde afuera parecía un antibot y no lo era.
 *
 * De ahí la lección que vale más que el arreglo: un checkbox sin etiqueta no se
 * tilda por descarte. Si no se sabe qué dice, no se sabe a qué se está diciendo
 * sí.
 */
async function chooseAuthMethod(page: Page): Promise<string[]> {
  const boxes = page.locator('input[type="checkbox"]');
  const total = await boxes.count();

  for (let i = 0; i < total; i += 1) {
    const box = boxes.nth(i);
    const label = await describeCheckbox(box);
    if (!/password/i.test(label) || /passkey|passwordless/i.test(label)) continue;
    if ((await box.isChecked().catch(() => false)) === true) return [];

    const why = await tick(box);
    return why === null ? [] : [why];
  }
  // No estar es válido: sólo aparece en el paso de contraseña.
  return [];
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

/**
 * El texto que acompaña a un checkbox, para saber a qué se está diciendo sí.
 *
 * Sube por los ancestros hasta juntar algo legible porque estos componentes
 * dibujan la etiqueta lejos del input: con `label[for]` y el padre directo
 * alcanzaba para el de marketing, pero el de "Password" quedaba en blanco.
 */
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
      ];

      let node: HTMLElement | null = input;
      for (let up = 0; up < 6 && node !== null; up += 1) {
        node = node.parentElement;
        const text = node?.textContent?.replace(/\s+/g, " ").trim() ?? "";
        if (text !== "") parts.push(text);
        if (text.length > 40) break;
      }
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

/**
 * Del carrito a la pantalla donde se pide la tarjeta.
 *
 * Antes esto clickeaba "Checkout" y se iba sin mirar. Cuando el click no pasaba
 * nada, el agente le entregaba al driver la página del carrito, y el driver
 * reportaba "no encontré el campo del número de tarjeta", que suena a bug del
 * driver y no a lo que realmente pasó. Así que acá se confirma que la página
 * cambió, y si el comercio pide autenticarse en este punto, se autentica y vuelve.
 */
async function openCheckout(
  page: Page,
  buyer: BuyerIdentity,
  code: EmailCodeSource | undefined,
): Promise<void> {
  await page.goto("https://www.spaceship.com/cart/", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(6_000);
  await dismissLocale(page);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = page.url();

    // El carrito a veces pinta el login encima, sin cambiar de URL. Si hay
    // usuario y contraseña a la vista, no es un carrito listo: es una sesión
    // cerrada. Entrar acá; si no, Checkout nunca habilita.
    if (await cartAsksLogin(page)) {
      console.log("  el carrito pide login");
      await ensureSignedIn(page, buyer, code);
      await page.goto("https://www.spaceship.com/cart/", {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      await page.waitForTimeout(6_000);
      continue;
    }

    await dismissOverlays(page);
    await completeMissingCartInfo(page, buyer);
    await dismissOverlays(page);
    await selectItems(page);
    await dismissOverlays(page);
    if (!(await clickCheckout(page))) {
      throw new SpaceshipError("No pude clickear el checkout del carrito.", [
        `URL: ${before}`,
        ...(await readComplaints(page)),
      ]);
    }

    await page.waitForTimeout(8_000);
    const now = page.url();

    // Si el comercio pide entrar recién acá, entrar y reintentar una vez.
    if (/\/auth\/(login|signup)/i.test(now)) {
      console.log("  el comercio pide autenticarse para pagar");
      await ensureSignedIn(page, buyer, code);
      await page.goto("https://www.spaceship.com/cart/", {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      await page.waitForTimeout(6_000);
      continue;
    }

    // Spaceship a veces monta el formulario de la tarjeta en el mismo /cart/,
    // sin cambiar la URL. Tratar eso como "no avanzó" es el error de la corrida
    // anterior: el cobro ya estaba a la vista y el agente lo desarmaba.
    if (await paymentFormVisible(page)) {
      console.log(`  pantalla de pago: ${now}`);
      return;
    }

    if (now === before || /\/cart\/?$/.test(now)) {
      console.log("  el carrito pide datos antes de cobrar");
      await completeMissingCartInfo(page, buyer);
      continue;
    }

    console.log(`  pantalla de pago: ${now}`);
    return;
  }

  throw new SpaceshipError("No llegué a la pantalla de pago.", [`URL: ${page.url()}`]);
}

/**
 * Tilda los items del carrito.
 *
 * El carrito de Spaceship cobra sólo lo seleccionado, y arranca sin nada
 * seleccionado: con todo destildado el botón de checkout queda deshabilitado. Sin
 * esto el agente clickeaba un botón muerto y el error salía como "el carrito no
 * avanzó", sin decir que faltaba tildar.
 */
async function selectItems(page: Page): Promise<void> {
  const selectAll = page.getByText(/^select all$/i).first();
  if ((await selectAll.count()) > 0) {
    await selectAll.click().catch(() => undefined);
  }

  const boxes = page.locator('input[type="checkbox"]');
  const total = await boxes.count();

  for (let i = 0; i < total; i += 1) {
    const box = boxes.nth(i);
    if (!(await box.isVisible().catch(() => false))) continue;

    // Las suscripciones a promociones también son checkboxes de esta página.
    // Tildarlas no rompe el pago, pero nadie pidió recibir mails.
    const name = ((await box.getAttribute("name")) ?? "").toLowerCase();
    if (/subscribe|newsletter|marketing|promo/.test(name)) continue;

    if (await box.isChecked().catch(() => false)) continue;
    await tick(box);
  }
  await page.waitForTimeout(3_000);
}

/**
 * Completa lo que Spaceship marca como faltante antes de dejar pagar.
 *
 * Lo anuncia con "Before we proceed…" y un "Take me there". Sin este paso el
 * Checkout está habilitado pero no navega, y parece un bug del click.
 *
 * Lo que falta es el contacto del dominio, y Spaceship no lo pide tipeado: pide
 * elegir uno guardado. Esto buscaba `input[name="firstName"]` en una pantalla que
 * sólo tiene un combo, así que no llenaba nada y el carrito seguía pidiendo
 * datos en cada vuelta, sin decir por qué.
 */
async function completeMissingCartInfo(page: Page, buyer: BuyerIdentity): Promise<void> {
  if (!(await cartNeedsInfo(page))) return;

  if (!(await openContactsEditor(page))) {
    console.log("  el carrito pide datos pero no encontré por dónde editarlos");
    return;
  }

  // Elegir una guardada es el camino que funciona. Cargarla a mano es el plan B:
  // hace falta la primera vez, cuando la cuenta todavía no tiene ninguna.
  const chosen = await pickSavedContact(page);
  if (chosen === null) {
    await addNewContact(page, buyer);
  } else {
    console.log(`  contacto del dominio: ${chosen}`);
  }

  if (!(await confirmContacts(page))) {
    console.log("  no encontré con qué confirmar el contacto del dominio");
  }
  await page.waitForTimeout(5_000);

  if (await cartNeedsInfo(page)) console.log("  ojo: el carrito sigue pidiendo datos");

  await backToCart(page);
}

/** Si Spaceship está reclamando datos antes de cobrar. */
async function cartNeedsInfo(page: Page): Promise<boolean> {
  const text = await page
    .locator("body")
    .innerText()
    .then(clean)
    .catch(() => "");
  return /info required|before we proceed|take me there/i.test(text);
}

/**
 * Abre el editor de contactos del dominio. Devuelve `false` si no encontró por
 * dónde.
 *
 * Acá estaba el loop de Domain Contacts, y no era el combo: la página tiene un
 * "Take me there" **invisible**, de cero por cero, y esto lo prefería sin mirar
 * si existía de verdad. Clickeaba el elemento muerto, seguía como si el modal
 * hubiera abierto, no encontraba nada que llenar, y el carrito volvía a pedir
 * datos para siempre sin decir por qué.
 *
 * Por eso ahora se exige área y estar arriba en el punto, y el click va por
 * coordenadas con el mouse de verdad: marcar el nodo para clickearlo después no
 * sirve, React re-renderiza y se lleva el atributo antes del click.
 */
async function openContactsEditor(page: Page): Promise<boolean> {
  // String, no función de TS: tsx le inyecta `__name` a las funciones anidadas
  // y page.evaluate explota en el browser.
  const point = (await page.evaluate(`(() => {
    const clean = (s) => (s || "").replace(/\\s+/g, " ").trim();
    const nodes = [...document.querySelectorAll("button, a")];
    const hits = nodes.filter((el) => {
      if (/^take me there$/i.test(clean(el.textContent))) return true;
      if (!/^edit$/i.test(clean(el.textContent))) return false;
      let p = el;
      for (let i = 0; i < 8 && p; i++) {
        if (/domain contacts|info required/i.test(p.innerText || "")) return true;
        p = p.parentElement;
      }
      return false;
    });

    for (const el of hits) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const x = r.x + r.width / 2;
      const y = r.y + r.height / 2;
      // Que sea lo que está arriba en ese punto: si algo lo tapa, el click va
      // a parar a otra cosa, y acá al lado hay un botón que cobra.
      const top = document.elementFromPoint(x, y);
      if (top === null || !(el === top || el.contains(top))) continue;
      return { x, y, text: clean(el.textContent) };
    }
    return null;
  })()`)) as { x: number; y: number; text: string } | null;

  if (point === null) return false;
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(5_000);
  return true;
}

/**
 * El modal de contactos, y sólo ese.
 *
 * Scopear importa: el selector del medio de pago vive en la misma pantalla y
 * tiene sus propios combos, a dos pulgadas de un "Pay now".
 */
function contactsDialog(page: Page): Locator {
  return page
    .locator(
      '[role="dialog"], [aria-modal="true"], [class*="modal"], [class*="Modal"], [class*="drawer"], [class*="Drawer"]',
    )
    .filter({ hasText: /domain contacts/i })
    .first();
}

/**
 * Elige una dirección ya guardada. Devuelve cuál, o `null` si no había ninguna.
 *
 * El control no es un `<select>` ni un `[role=combobox]`: es un `div` con clase
 * `gb-select__anchor`, que es por lo que ningún selector honesto lo encontraba.
 */
async function pickSavedContact(page: Page): Promise<string | null> {
  const dialog = contactsDialog(page);
  if ((await dialog.count()) === 0) return null;

  const combo = dialog.locator('.gb-select__anchor, [role="combobox"], [role="button"][tabindex]').first();
  if ((await combo.count()) === 0) return null;

  await combo.scrollIntoViewIfNeeded().catch(() => undefined);
  const opened = await combo
    .click({ timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  if (!opened) return null;
  await page.waitForTimeout(2_500);

  const options = page.locator('[role="option"]:visible, [role="listbox"] li:visible');
  const total = await options.count();
  for (let i = 0; i < total; i += 1) {
    const text = clean(await options.nth(i).innerText().catch(() => ""));
    // "Add New Address" abre el formulario vacío: no es una dirección guardada.
    if (text === "" || /add new/i.test(text)) continue;

    const clicked = await options
      .nth(i)
      .click({ timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    if (!clicked) continue;
    await page.waitForTimeout(2_000);

    // La prueba de que entró es que el combo muestre una dirección, no el
    // "Select or add one address" vacío. Comparar contra el texto anterior no
    // sirve: si la dirección ya estaba elegida, re-elegirla no cambia nada y
    // esto se iba a cargar una dirección nueva al lado de un botón que cobra.
    const now = clean(await combo.innerText().catch(() => ""));
    if (now !== "" && !/select or add/i.test(now)) return text.replace(/\s*Edit$/i, "");
  }

  // Sin opciones guardadas: cerrar la lista para que no tape el botón de aplicar.
  await page.keyboard.press("Escape").catch(() => undefined);
  return null;
}

/** Carga un contacto nuevo a mano, cuando la cuenta no tiene ninguno guardado. */
async function addNewContact(page: Page, buyer: BuyerIdentity): Promise<void> {
  await clickVisible(page, /^add new address$/i);
  await page.waitForTimeout(3_000);

  await page
    .locator('input[name="firstName"], input[placeholder*="First" i], input[autocomplete="given-name"]')
    .first()
    .waitFor({ timeout: 12_000 })
    .catch(() => undefined);

  await fill(page, ['input[name="firstName"]', "#textfield-firstName", 'input[autocomplete="given-name"]'], buyer.firstName);
  await fill(page, ['input[name="lastName"]', "#textfield-lastName", 'input[autocomplete="family-name"]'], buyer.lastName);
  await fill(page, ['input[name="email"]', 'input[type="email"]', 'input[autocomplete="email"]'], buyer.email);
  await fill(page, ['input[name="address1"]', 'input[autocomplete="address-line1"]', 'input[placeholder*="street" i]'], buyer.street);
  await fill(page, ['input[name="city"]', 'input[autocomplete="address-level2"]', 'input[placeholder*="city" i]'], buyer.city);
  await fill(page, ['input[name="zip"]', 'input[autocomplete="postal-code"]', 'input[placeholder*="postal" i]'], buyer.postal);
  await fill(page, ['input[type="tel"]', 'input[autocomplete="tel"]', 'input[placeholder*="phone" i]'], buyer.phone);
  await fill(page, ['input[name="state"]', 'input[autocomplete="address-level1"]', 'input[placeholder*="state" i]'], buyer.region);

  const country = page.locator('select[name*="country" i], select[autocomplete="country"]').first();
  if ((await country.count()) > 0) {
    await country.selectOption({ label: "Argentina" }).catch(() => undefined);
  }
}

/**
 * Confirma el contacto elegido, buscando el botón lo más cerca posible.
 *
 * El orden importa por lo que hay alrededor: esta pantalla tiene un "Pay now"
 * habilitado a dos pulgadas del modal. Primero se busca dentro del modal, donde
 * cualquier etiqueta razonable es segura. Recién si ahí no está se busca en toda
 * la página, y sólo "Apply" — Spaceship a veces monta ese botón fuera del nodo
 * del modal, pero ninguna otra etiqueta vale el riesgo de un click a ciegas.
 */
async function confirmContacts(page: Page): Promise<boolean> {
  const dialog = contactsDialog(page);
  if ((await dialog.count()) > 0) {
    if (await clickVisible(dialog, /^(apply|save|update|confirm|done|continue|next)$/i)) return true;
  }
  return clickVisible(page, /^apply$/i);
}

/**
 * Etiquetas que no se clickean nunca desde acá, venga el regex que venga.
 *
 * Es una red, no un filtro: los botones de este flujo se buscan por texto, y un
 * regex demasiado ancho en el lugar equivocado es un cobro. Preferimos no
 * confirmar un contacto antes que apretar algo que gasta.
 */
const NEVER_CLICK = /\b(pay|purchase|buy|checkout|place order|complete order)\b/i;

/**
 * Clickea el botón visible cuyo texto matchee, y sólo el visible.
 *
 * Estas pantallas tienen el mismo botón dos veces en el DOM, y la copia muerta
 * mide cero por cero. Playwright por rol agarra la que encuentra: si es la
 * muerta, el modal queda abierto sin decir nada, que es el peor modo de fallar
 * porque parece que el sitio ignoró el dato.
 */
async function clickVisible(scope: Page | Locator, name: RegExp): Promise<boolean> {
  const buttons = scope.locator('button:visible, [role="button"]:visible');
  const total = await buttons.count();

  for (let i = 0; i < total; i += 1) {
    const button = buttons.nth(i);
    const text = clean(await button.innerText().catch(() => ""));
    if (!name.test(text) || NEVER_CLICK.test(text)) continue;
    if (!(await button.isEnabled().catch(() => false))) continue;

    const clicked = await button
      .click({ timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    if (clicked) return true;
  }
  return false;
}

async function backToCart(page: Page): Promise<void> {
  if (/\/cart\/?/.test(page.url())) return;
  await page.goto("https://www.spaceship.com/cart/", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(5_000);
  await dismissLocale(page);
}

const clean = (text: string): string => text.replace(/\s+/g, " ").trim();

/** Login embebido en el carrito: mismos campos, otra URL. */
async function cartAsksLogin(page: Page): Promise<boolean> {
  const password = await visible(page, ['input[type="password"]', 'input[name="userPassword"]']);
  const login = page.getByRole("button", { name: /log ?in/i });
  return password !== null || (await login.count()) > 0;
}

/** Si ya está el campo del número, en la página o en un iframe del procesador. */
async function paymentFormVisible(page: Page): Promise<boolean> {
  for (const frame of page.frames()) {
    const field = frame
      .locator(
        '[autocomplete="cc-number"], input[name*="cardNumber" i], input[id*="card-number" i], input[placeholder*="card number" i]',
      )
      .first();
    if ((await field.count().catch(() => 0)) > 0) return true;
  }
  return false;
}

/** El "Checkout" del carrito, que a veces es botón y a veces link. */
async function clickCheckout(page: Page): Promise<boolean> {
  const name = /^\s*(checkout|continue to payment|pay now|proceed to checkout)\s*$/i;
  for (const candidate of [
    page.getByRole("button", { name }),
    page.getByRole("link", { name }),
    page.locator('a[href*="checkout" i], button[class*="checkout" i]'),
  ]) {
    const target = candidate.first();
    if ((await target.count()) === 0) continue;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (await target.isEnabled().catch(() => false)) {
        const clicked = await target
          .click({ timeout: 8_000 })
          .then(() => true)
          .catch(() => false);
        if (clicked) return true;
      }
      await page.waitForTimeout(400);
    }
  }
  return false;
}

/**
 * Si la sesión está abierta, preguntándole al servidor y no a la apariencia.
 *
 * Adivinar esto por el contenido de la página falló dos veces, en las dos
 * direcciones. Buscar "log out" en el texto visible daba negativo con la sesión
 * abierta, porque Spaceship lo esconde en un menú. Buscarlo en el HTML daba
 * positivo con la sesión cerrada, porque la palabra vive en el JavaScript del
 * sitio. Un falso positivo es el más caro: el agente saltea el login y llega al
 * carrito como anónimo, donde el checkout nunca habilita.
 *
 * La única señal que no se puede falsear es el servidor: se pide una página que
 * exige sesión y se mira si redirigió al login.
 */
async function looksSignedIn(page: Page): Promise<boolean> {
  await page
    .goto("https://www.spaceship.com/launchpad/", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    })
    .catch(() => undefined);
  await page.waitForTimeout(4_000);
  return /\/launchpad\//.test(page.url()) && !/\/auth\//.test(page.url());
}

async function fill(page: Page, selectors: string[], value: string | null): Promise<void> {
  if (value === null || value === "") return;
  for (const selector of selectors) {
    const field = page.locator(selector).first();
    if ((await field.count()) === 0) continue;
    const current = await field.inputValue().catch(() => "");
    if (current.trim() !== "") return;
    // force: el input de Spaceship a veces está tapado por el recuadro dibujado
    // y Playwright lo trata como invisible, aunque el DOM lo tiene.
    const wrote = await field
      .fill(value, { force: true })
      .then(() => true)
      .catch(() => false);
    if (wrote) return;
  }
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
