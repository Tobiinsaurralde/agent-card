/**
 * Pagar el carrito con una tarjeta que el agente pide por MCP.
 *
 * Es el final del recorrido: el carrito ya está armado y la sesión abierta, y lo
 * que falta es la parte que define a Konex. El agente pide la tarjeta al
 * servidor, canjea el número, lo carga en el formulario del comercio y cobra.
 * Después registra el cargo y cierra la tarea.
 *
 * Por qué carga el número en vez de usar la tarjeta guardada en la cuenta: usar
 * la guardada no probaría nada. Ese número ya estaba ahí antes de que existiera
 * el MCP, y una compra así mide la sesión de Spaceship, no la capa de control.
 *
 * Dos frenos que son el punto del ejercicio, no burocracia:
 *
 * 1. Antes de tocar el pago lee el total REAL de la página y lo compara con el
 *    tope. Si el comercio pide más, corta. Un agente que paga el número que le
 *    pongan adelante no tiene tope, tiene una sugerencia.
 * 2. Si no puede leer el total con confianza, también corta. Pagar un monto que
 *    no pudiste leer es exactamente lo que esto viene a evitar.
 *
 * Uso:
 *   npm run pay -- --amount 2                ← llena la tarjeta y para antes de cobrar
 *   npm run pay -- --amount 2 --pay          ← cobra de verdad
 */
import { attach, PAGE_HELPERS, sleep, targets, type Cdp, type Target } from "../../harness/cdp.js";
import type { CardCredentials } from "../credentials.js";
import { AgentCardClient, DeniedError, type CardGrant } from "../mcp/agent-client.js";

const DEFAULT_CDP = "http://127.0.0.1:9222";

interface Args {
  amountUsd: number;
  taskId: string;
  base: string;
  pay: boolean;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const base = args.base;
  const page = await findCartPage(base);
  const cdp = await attach(page.webSocketDebuggerUrl!);

  let mcp: AgentCardClient | null = null;
  let grant: CardGrant | null = null;

  try {
    // ── 1. Armar el checkout ─────────────────────────────────────────────────
    // Va primero porque el total no existe antes: el carrito recién muestra lo
    // que va a cobrar cuando hay algo tildado y el checkout está abierto.
    await dismiss(cdp);
    await ensureCheckoutOpen(cdp);

    // ── 2. Qué está por cobrar el comercio, según el comercio ────────────────
    const total = await readTotal(cdp);
    if (total === null) {
      throw new Error(
        "No pude leer el total de la página. No sigo: pagar un monto que no pude " +
          "leer es justo lo que esto viene a evitar.",
      );
    }
    console.log(`Comercio:  ${page.url}`);
    console.log(`Total:     USD ${total.toFixed(2)}`);
    console.log(`Tope:      USD ${args.amountUsd.toFixed(2)}`);

    if (total > args.amountUsd) {
      throw new DeniedError(
        "OVER_CAP_AT_MERCHANT",
        `El comercio pide USD ${total.toFixed(2)} y el tope es USD ${args.amountUsd.toFixed(2)}.`,
      );
    }

    // ── 3. La tarjeta, por protocolo ─────────────────────────────────────────
    mcp = await AgentCardClient.spawn();
    const budget = await mcp.budget();
    console.log(`Emisor:    ${budget.provider} (disponible USD ${budget.availableUsd})`);

    grant = await mcp.requestCard({
      amountUsd: args.amountUsd,
      merchant: new URL(page.url ?? "https://spaceship.com").hostname,
      taskId: args.taskId,
      reason: "comprar un dominio",
      singleUse: true,
    });
    console.log(`Tarjeta:   ${grant.handle} ••${grant.last4}, tope USD ${grant.lifetimeCapUsd}`);

    // El preflight con el total de verdad, no con el tope: es la pregunta que
    // importa antes de tipear un número real en un formulario ajeno.
    await mcp.checkCharge(grant.handle, total);
    const card = await mcp.credentials(grant.handle);
    console.log(`Canjeada:  ${card.brand} ••${card.last4}`);

    // ── 4. Cargar el número en el comercio ───────────────────────────────────
    const selected = await readSelectedCard(cdp);
    if (selected === card.last4) {
      console.log(`Formulario: el comercio ya tiene ••${selected} seleccionada. No la cargo de nuevo.`);
    } else {
      await openAddCard(cdp);
      await fillStripe(cdp, card);
      await fillCardHolder(cdp, card);
      await saveCard(cdp);

      const now = await readSelectedCard(cdp);
      if (now !== card.last4) {
        throw new Error(
          `Cargué la tarjeta pero el comercio muestra ${now === null ? "ninguna" : "••" + now} seleccionada. ` +
            "No cobro con una tarjeta que no es la que emitió el servidor.",
        );
      }
    }

    if (!args.pay) {
      console.log("");
      console.log("Paro acá: la tarjeta está cargada y el cobro NO se hizo.");
      console.log("Para cobrar de verdad, la misma línea con --pay.");
      return;
    }

    // ── 5. Cobrar ────────────────────────────────────────────────────────────
    console.log("");
    console.log("UN intento. Si sale mal no lo repito: reintentar el mismo checkout con la");
    console.log("misma tarjeta es el patrón del card testing y te pueden bloquear la tarjeta.");
    console.log("");

    await clickPayNow(cdp);
    const outcome = await readOutcome(cdp);
    console.log(`VEREDICTO: ${outcome.kind.toUpperCase()}`);
    console.log(`Evidencia: ${card.redact(outcome.evidence)}`);

    // ── 6. Cerrar el círculo contra el servidor ──────────────────────────────
    if (outcome.kind === "aprobado" || outcome.kind === "desconocido") {
      const verdict = await mcp.recordCharge(grant.handle, total);
      console.log(
        verdict.approved
          ? `Cargo registrado: USD ${total.toFixed(2)} contra ${grant.handle}.`
          : `El servidor no lo registró (${verdict.code}): ${verdict.reason}`,
      );
    } else {
      console.log("No registro el cargo: el comercio no cobró.");
    }
  } finally {
    if (mcp !== null) {
      // La tarea se cierra pase lo que pase. Una tarjeta viva que nadie está
      // mirando es el problema que este proyecto dice resolver.
      await mcp.completeTask(args.taskId).catch(() => undefined);
      await mcp.close();
    }
    cdp.close();
  }
}

/** La pestaña del carrito o del checkout. */
async function findCartPage(base: string): Promise<Target> {
  const all = await targets(base);
  const page = all.find(
    (t) => t.type === "page" && /spaceship\.com\/(cart|checkout)/i.test(t.url ?? ""),
  );
  if (page?.webSocketDebuggerUrl === undefined) {
    const open = all.filter((t) => t.type === "page").map((t) => t.url ?? "(sin url)");
    throw new Error(
      `No encontré la pestaña del carrito de Spaceship. Abiertas: ${open.join(", ") || "ninguna"}`,
    );
  }
  return page;
}

/**
 * El total que el comercio va a cobrar.
 *
 * Toma el ÚLTIMO monto que sigue a la palabra "Total", que es el que queda
 * después del descuento: Spaceship muestra "Total $15.73 $0.81" con el precio de
 * lista tachado. Devuelve `null` si no encuentra exactamente uno, porque una
 * lectura ambigua no sirve para autorizar nada.
 */
async function readTotal(cdp: Cdp): Promise<number | null> {
  return cdp.evaluate<number | null>(`(() => {
    ${PAGE_HELPERS}
    const text = clean(document.body.innerText);
    // \\b antes de "total" para no comerse el "Subtotal", que trae el precio de
    // lista y hace que la lectura salga ambigua.
    const hits = [...text.matchAll(/\\btotal[^0-9]{0,12}((?:\\$\\s?[0-9]+[.,][0-9]{2}\\s*)+)/gi)];
    if (hits.length === 0) return null;
    const amounts = [];
    for (const hit of hits) {
      const nums = (hit[1].match(/[0-9]+[.,][0-9]{2}/g) ?? []).map((n) => Number(n.replace(",", ".")));
      if (nums.length > 0) amounts.push(nums[nums.length - 1]);
    }
    const unique = [...new Set(amounts)];
    return unique.length === 1 ? unique[0] : null;
  })()`);
}

/** Cierra combos y modales abiertos, para clickear sobre una pantalla limpia. */
async function dismiss(cdp: Cdp): Promise<void> {
  for (let i = 0; i < 2; i += 1) {
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      windowsVirtualKeyCode: 27,
    });
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Escape",
      windowsVirtualKeyCode: 27,
    });
    await sleep(800);
  }
}

/**
 * Los últimos cuatro de la tarjeta que el comercio tiene seleccionada.
 *
 * Es la única forma de saber con qué se va a cobrar. Cobrar sin chequear esto es
 * cómo se termina pagando con una tarjeta distinta a la que el servidor autorizó
 * — que es exactamente el agujero que Konex dice tapar.
 */
async function readSelectedCard(cdp: Cdp): Promise<string | null> {
  return cdp.evaluate<string | null>(`(() => {
    ${PAGE_HELPERS}
    const anchor = [...document.querySelectorAll(".gb-select__anchor, [role=combobox], [role=button][tabindex]")]
      .filter(shown)
      .find((el) => /\\*{2,}\\s*[0-9]{4}/.test(clean(el.innerText)));
    if (!anchor) return null;
    const hit = /\\*{2,}\\s*([0-9]{4})/.exec(clean(anchor.innerText));
    return hit ? hit[1] : null;
  })()`);
}

/** Abre el selector de medio de pago y elige "Add credit/debit card". */
async function openAddCard(cdp: Cdp): Promise<void> {
  // Si el formulario ya está a la vista, no hay nada que abrir. Volver a
  // clickear el selector con el modal encima cierra lo que ya estaba listo.
  const already = await cdp.evaluate<boolean>(
    `document.querySelectorAll('iframe[src*="elements-inner-card"]').length >= 3`,
  );
  if (already) {
    console.log("Formulario: la tarjeta nueva ya estaba abierta.");
    return;
  }

  const selector = await cdp.centerOf(`(() => {
    ${PAGE_HELPERS}
    // El combo del medio de pago vive en el drawer de checkout.
    return [...document.querySelectorAll(".gb-select__anchor, [role=combobox], [role=button][tabindex]")]
      .filter(shown)
      .find((el) => /\\*\\*\\*\\*|payment method|add credit/i.test(clean(el.innerText))) ?? null;
  })()`);

  if (selector === null) throw new Error("No encontré el selector de medio de pago.");
  await cdp.clickAt(selector);
  await sleep(2_500);

  const add = await cdp.centerOf(`(() => {
    ${PAGE_HELPERS}
    return byText("[role=option], li, button, div[role=button]", /^add credit\\/debit card$/i) ?? null;
  })()`);

  if (add === null) throw new Error('No encontré la opción "Add credit/debit card".');
  await cdp.clickAt(add);
  await sleep(6_000);
  console.log("Formulario: pedí cargar una tarjeta nueva.");
}

/**
 * Los tres campos del número viven en iframes de Stripe Elements.
 *
 * No se pueden llenar por selector: son de otro origen, así que el DOM de la
 * página no los alcanza. Y tampoco se puede confiar en que Chrome los exponga
 * como targets CDP aparte — en esta instancia no lo hace, y enumerarlos devuelve
 * una lista vacía con el formulario abierto a la vista.
 *
 * Lo que sí funciona es lo que haría una persona: clickear el campo por
 * coordenadas y tipear a nivel navegador. El texto va al frame que tiene el
 * foco, sin importar de qué origen sea.
 */
async function fillStripe(cdp: Cdp, card: CardCredentials): Promise<void> {
  const secret = card.reveal();

  // De izquierda a derecha son número, vencimiento y CVC, que es el orden en que
  // Stripe los pinta. El del número es además el más ancho.
  const boxes = await cdp.evaluate<Array<{ x: number; y: number; w: number }>>(`(() => {
    return [...document.querySelectorAll('iframe[src*="elements-inner-card"]')]
      .map((f) => f.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
      .sort((a, b) => a.x - b.x)
      .map((r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2, w: Math.round(r.width) }));
  })()`);

  if (boxes.length < 3) {
    throw new Error(
      `Esperaba tres campos de tarjeta y encontré ${boxes.length}. El formulario no se abrió completo.`,
    );
  }

  const values = [
    secret.pan,
    `${secret.expMonth}${secret.expYear.slice(-2)}`,
    secret.cvc,
  ];

  for (let i = 0; i < 3; i += 1) {
    const box = boxes[i]!;
    await cdp.clickAt(box);
    await sleep(600);
    // Dígito por dígito: Stripe formatea mientras se tipea, y un insertText de
    // golpe le puede pasar por al lado al formateador.
    for (const char of values[i]!) {
      await cdp.send("Input.insertText", { text: char });
      await sleep(30);
    }
    await sleep(400);
  }

  // Stripe avisa en el modal cuando un campo quedó incompleto o inválido. Leer
  // eso es más honesto que asumir que tipear salió bien.
  const complaint = await cdp.evaluate<string | null>(`(() => {
    ${PAGE_HELPERS}
    const text = clean(document.body.innerText);
    const hit = /(card number is (incomplete|invalid)|expir\\w+ date is (incomplete|invalid|in the past)|security code is incomplete|invalid card)/i.exec(text);
    return hit ? hit[0] : null;
  })()`);

  if (complaint !== null) {
    throw new Error(`Stripe se queja: "${complaint}". No sigo con la tarjeta a medias.`);
  }
  console.log("Stripe:    número, vencimiento y CVC cargados sin quejas.");
}

/** Titular y dirección de facturación, que están fuera de los iframes. */
async function fillCardHolder(cdp: Cdp, card: CardCredentials): Promise<void> {
  const name = card.reveal().name;
  const done = await cdp.evaluate<string>(`(() => {
    ${PAGE_HELPERS}
    const input = [...document.querySelectorAll('input[name="embossingName"], input[placeholder*="John" i], input[placeholder*="name on card" i]')].find(shown);
    if (!input) return "no encontré el campo del titular";
    // React ignora un cambio directo de .value: hay que usar el setter del
    // prototipo y avisar con los eventos que el framework escucha.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, ${JSON.stringify(name)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return "cargado";
  })()`);
  console.log(`Titular:   ${done}`);

  // La dirección de facturación suele venir con una guardada por defecto. Si hay
  // un combo sin elegir, elegir la primera guardada.
  const combo = await cdp.centerOf(`(() => {
    ${PAGE_HELPERS}
    return [...document.querySelectorAll(".gb-select__anchor, [role=button][tabindex]")]
      .filter(shown)
      .find((el) => /select or add|billing address|address/i.test(clean(el.innerText))) ?? null;
  })()`);

  if (combo !== null) {
    await cdp.clickAt(combo);
    await sleep(2_000);
    const option = await cdp.centerOf(`(() => {
      ${PAGE_HELPERS}
      return [...document.querySelectorAll("[role=option], li, div[role=button]")]
        .filter(shown)
        .find((el) => /gutierrez|corrientes|insaurralde/i.test(clean(el.innerText))) ?? null;
    })()`);
    if (option !== null) {
      await cdp.clickAt(option);
      await sleep(2_000);
      console.log("Dirección: elegí la guardada.");
    }
  }
}

/** El botón que guarda la tarjeta nueva y la deja seleccionada. */
async function saveCard(cdp: Cdp): Promise<void> {
  const save = await cdp.centerOf(`(() => {
    ${PAGE_HELPERS}
    // Nada que diga "pay" se toca acá: cobrar es un paso aparte y explícito.
    return byText("button", /^(save|add card|add|continue|confirm|done)$/i) ?? null;
  })()`);

  if (save === null) {
    console.log("Guardar:   no había botón de guardar; sigo con lo que quedó.");
    return;
  }
  await cdp.clickAt(save);
  await sleep(7_000);
  console.log("Guardar:   tarjeta cargada en el comercio.");
}

/**
 * Deja el checkout abierto con el "Pay now" a la vista.
 *
 * El carrito de Spaceship cobra sólo lo tildado y arranca sin nada tildado, así
 * que hay que seleccionar antes de pedir el checkout. Y un intento fallido
 * destilda todo de nuevo, que es cómo la corrida anterior terminó apretando un
 * botón que no correspondía.
 */
async function ensureCheckoutOpen(cdp: Cdp): Promise<void> {
  const payVisible = async (): Promise<boolean> =>
    cdp.evaluate<boolean>(`(() => {
      ${PAGE_HELPERS}
      return byText("button", /^pay now$/i) !== undefined;
    })()`);

  if (await payVisible()) return;

  const selected = await cdp.evaluate<number>(`(() => {
    ${PAGE_HELPERS}
    let n = 0;
    for (const box of document.querySelectorAll('input[type=checkbox]')) {
      if (!shown(box)) continue;
      const name = (box.getAttribute("name") ?? "").toLowerCase();
      if (/subscribe|newsletter|marketing|promo|default/.test(name)) continue;
      if (!box.checked) { box.click(); n += 1; }
    }
    return n;
  })()`);
  console.log(`Carrito:   tildé ${selected} ${selected === 1 ? "ítem" : "ítems"}.`);
  await sleep(3_000);

  const checkout = await cdp.centerOf(`(() => {
    ${PAGE_HELPERS}
    return byText("button, a", /^checkout$/i) ?? null;
  })()`);
  if (checkout === null) throw new Error('No encontré el botón "Checkout" del carrito.');
  await cdp.clickAt(checkout);
  await sleep(8_000);

  if (!(await payVisible())) {
    throw new Error('Abrí el checkout pero no apareció "Pay now".');
  }
  console.log("Checkout:  abierto.");
}

/**
 * El click que mueve la plata, con el seguro puesto.
 *
 * Verifica qué elemento hay bajo el cursor ANTES de apretar. En Spaceship el
 * "Cancel" está veinticinco píxeles debajo del "Pay now", y una corrida se
 * perdió justo así: el click cayó en Cancel, el drawer se cerró y el veredicto
 * quedó en "desconocido" sin que nadie hubiera cobrado nada.
 */
async function clickPayNow(cdp: Cdp): Promise<void> {
  const pay = await cdp.centerOf(`(() => {
    ${PAGE_HELPERS}
    return byText("button", /^pay now$/i) ?? null;
  })()`);
  if (pay === null) throw new Error('No encontré el botón "Pay now".');

  const under = await cdp.elementAt(pay);
  if (!/pay now/i.test(under)) {
    throw new Error(
      `Bajo el cursor hay "${under}", no el "Pay now". No aprieto a ciegas sobre una pantalla de pago.`,
    );
  }

  await cdp.clickAt(pay);
  console.log(`Cobré:     apreté "Pay now" (confirmado: ${under}). Espero el veredicto.`);
  await sleep(20_000);
}

/**
 * Qué dijo el comercio.
 *
 * "desconocido" es un resultado de primera clase, no un fallo de la lectura: si
 * no se puede afirmar que entró ni que rebotó, decirlo es más útil que elegir.
 */
async function readOutcome(cdp: Cdp): Promise<{ kind: string; evidence: string }> {
  return cdp.evaluate<{ kind: string; evidence: string }>(`(() => {
    ${PAGE_HELPERS}
    const text = clean(document.body.innerText);
    const url = location.href;

    if (/thank you|order (summary|confirmed)|purchase (complete|successful)|congratulations/i.test(text)
        || /\\/(success|thank|receipt|order)/i.test(url)) {
      return { kind: "aprobado", evidence: url + " :: " + text.slice(0, 240) };
    }
    if (/3d ?secure|verify (your|with) (bank|card)|authentication required|one-time (code|password)/i.test(text)) {
      return { kind: "desafio_3ds", evidence: text.slice(0, 240) };
    }
    const declined = /declin|insufficient|not authori[sz]ed|payment failed|could not be processed|enough funds|valid payment method/i.exec(text);
    if (declined) {
      const at = Math.max(0, declined.index - 120);
      return { kind: "rechazado", evidence: text.slice(at, at + 300) };
    }
    return { kind: "desconocido", evidence: url + " :: " + text.slice(0, 240) };
  })()`);
}

function tick(ok: boolean): string {
  return ok ? "ok" : "NO";
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const at = argv.indexOf(flag);
    return at === -1 ? undefined : argv[at + 1];
  };

  if (argv.length === 0 || argv.includes("--help")) {
    console.error("Uso:");
    console.error("");
    console.error("  npm run pay -- --amount 2          ← carga la tarjeta, NO cobra");
    console.error("  npm run pay -- --amount 2 --pay    ← cobra de verdad");
    console.error("");
    console.error("Opciones:");
    console.error("  --amount <usd>  Tope. Si el comercio pide más, corta antes de pagar.");
    console.error("  --pay           Clickea Pay now. Sin esto para antes de cobrar.");
    console.error("  --task <id>     Tarea que origina la tarjeta.");
    console.error(`  --connect <url> CDP del navegador. Default: ${DEFAULT_CDP}`);
    console.error("");
    console.error("Necesita el carrito ya armado y la sesión abierta en ese navegador.");
    process.exit(1);
  }

  const rawAmount = get("--amount");
  const amountUsd = Number(rawAmount);
  if (rawAmount === undefined || !Number.isFinite(amountUsd) || amountUsd <= 0) {
    console.error("--amount <usd> es obligatorio: un tope que nadie eligió no es un tope.");
    process.exit(1);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return {
    amountUsd,
    taskId: get("--task") ?? `pago-${stamp}`,
    base: get("--connect") ?? DEFAULT_CDP,
    pay: argv.includes("--pay"),
  };
}

main().catch((error: unknown) => {
  console.error("");
  if (error instanceof DeniedError) {
    console.error(`EL SERVIDOR DIJO NO (${error.code}): ${error.message}`);
    console.error("La tarjeta no se tocó. Esto es la policy haciendo su trabajo.");
    process.exitCode = 6;
    return;
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
