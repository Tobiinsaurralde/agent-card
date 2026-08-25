/**
 * Chequea los selectores del modal de Domain Contacts, sin aplicar nada.
 *
 * El comprador se quedó en loop porque buscaba `input[name="firstName"]` en una
 * pantalla que sólo tiene un combo de direcciones guardadas. Los selectores
 * nuevos son la parte frágil del arreglo, y probarlos con una compra sale caro:
 * esto los corre contra la página abierta y cuenta qué encontró.
 *
 * Abre el modal (abrir un formulario no cobra), mira, y cierra con Escape. No
 * clickea "Apply" ni nada que gaste: sólo reporta.
 *
 * Uso: node --import tsx harness/check-contacts.ts [--connect http://127.0.0.1:9222]
 */
import { attachPage } from "../src/driver.js";

const at = process.argv.indexOf("--connect");
const connectUrl = at === -1 ? "http://127.0.0.1:9222" : (process.argv[at + 1] ?? "");

const clean = (text: string): string => text.replace(/\s+/g, " ").trim();

async function main(): Promise<void> {
  const { browser, page } = await attachPage(connectUrl);

  try {
    console.log(`página: ${page.url()}`);

    // El cajón de pago tapa el carrito. Cerrarlo primero: es donde vive el
    // "Pay now", y no queremos ni acercarnos.
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(1_500);

    // El DOM elige cuál es el Edit correcto —hay varios en la página— pero no lo
    // clickea: lo marca. El click lo da Playwright, que manda eventos de puntero
    // de verdad. Estos componentes ignoran los clicks sintéticos.
    const candidates = (await page.evaluate(`(() => {
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

      // Reportar todos, y marcar el que de verdad se puede clickear: el que
      // tiene área y además está arriba en ese punto.
      const out = [];
      for (const el of hits) {
        const r = el.getBoundingClientRect();
        const cx = r.x + r.width / 2;
        const cy = r.y + r.height / 2;
        const top = r.width > 0 && r.height > 0 ? document.elementFromPoint(cx, cy) : null;
        const clickable = top !== null && (el === top || el.contains(top));
        out.push({
          text: clean(el.textContent),
          w: Math.round(r.width),
          h: Math.round(r.height),
          y: Math.round(r.y),
          tapado: r.width > 0 && r.height > 0 && !clickable ? clean(top && top.tagName) : null,
          clickable,
        });
        if (clickable) { out[out.length - 1].x = Math.round(cx); out[out.length - 1].y2 = Math.round(cy); }
      }
      return out;
    })()`)) as Array<Record<string, number | string | boolean | null>>;

    console.log(`candidatos para abrir contactos: ${candidates.length}`);
    for (const c of candidates) console.log(`  ${JSON.stringify(c)}`);

    // Por coordenadas y con el mouse de verdad: marcar el nodo no sirve porque
    // React re-renderiza y se lleva el atributo antes del click.
    const target = candidates.find((c) => c["clickable"] === true);
    if (target !== undefined) {
      await page.mouse.click(Number(target["x"]), Number(target["y2"]));
    }
    await page.waitForTimeout(5_000);

    const dialog = page
      .locator(
        '[role="dialog"], [aria-modal="true"], [class*="modal"], [class*="Modal"], [class*="drawer"], [class*="Drawer"]',
      )
      .filter({ hasText: /domain contacts/i })
      .first();

    const dialogs = await dialog.count();
    console.log(`modal de Domain Contacts: ${dialogs === 0 ? "NO LO ENCONTRÉ" : "encontrado"}`);
    if (dialogs === 0) {
      console.log("  (sin modal no puedo chequear el resto)");
      return;
    }

    const combo = dialog.locator('.gb-select__anchor, [role="combobox"], [role="button"][tabindex]').first();
    const combos = await combo.count();
    console.log(`combo de direcciones: ${combos === 0 ? "NO LO ENCONTRÉ" : clean(await combo.innerText())}`);

    if (combos > 0) {
      await combo.click({ timeout: 8_000 }).catch(() => undefined);
      await page.waitForTimeout(2_500);

      const options = page.locator('[role="option"]:visible, [role="listbox"] li:visible');
      const total = await options.count();
      console.log(`opciones visibles: ${total}`);
      for (let i = 0; i < total; i += 1) {
        console.log(`  - ${clean(await options.nth(i).innerText().catch(() => ""))}`);
      }
      await page.keyboard.press("Escape").catch(() => undefined);
      await page.waitForTimeout(1_000);
    }

    // Lo que más importa: que el "Apply" que vamos a clickear exista, esté
    // visible, y saber si vive adentro del modal o suelto en la página.
    for (const [where, scope] of [
      ["dentro del modal", dialog],
      ["en toda la página", page],
    ] as const) {
      const buttons = scope.locator('button:visible, [role="button"]:visible');
      const found: string[] = [];
      const total = await buttons.count();
      for (let i = 0; i < total; i += 1) {
        const text = clean(await buttons.nth(i).innerText().catch(() => ""));
        if (/^(apply|save|update|confirm|done|continue|next)$/i.test(text)) found.push(text);
      }
      console.log(`botones de confirmar ${where}: ${found.length === 0 ? "ninguno" : found.join(", ")}`);
    }

    await page.keyboard.press("Escape").catch(() => undefined);
    console.log("cerrado sin aplicar nada.");
  } finally {
    // Cierra la conexión CDP, no el Chrome.
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
