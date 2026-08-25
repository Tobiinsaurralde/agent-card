/**
 * Qué hay adentro de un modal, elemento por elemento.
 *
 * Cuando un campo se ve en la captura pero el selector no lo encuentra, la
 * pregunta es qué es de verdad: un input, un div contenteditable o un iframe de
 * otro origen. Adivinar eso desde el código del comercio sale más caro que
 * preguntarle a la página.
 *
 * Uso: probe.ts "add credit" [http://127.0.0.1:9222]
 */
import { attach, PAGE_HELPERS, targets } from "./cdp.js";

const needle = process.argv[2];
const base = process.argv[3] ?? "http://127.0.0.1:9222";
if (needle === undefined) {
  console.error('Uso: probe.ts "texto del modal" [cdp]');
  process.exit(1);
}

const all = await targets(base);
const page = all.find((t) => t.type === "page" && /spaceship\.com/i.test(t.url ?? ""));
if (page?.webSocketDebuggerUrl === undefined) {
  console.error("no encontré la pestaña de Spaceship");
  process.exit(1);
}

const cdp = await attach(page.webSocketDebuggerUrl);
const out = await cdp.evaluate(`(() => {
  ${PAGE_HELPERS}
  const needle = new RegExp(${JSON.stringify(needle)}, "i");

  // El contenedor más chico que contenga el texto: el más grande siempre es
  // <body>, y ahí se pierde lo que importa.
  const boxes = [...document.querySelectorAll("div, section, form, dialog")]
    .filter((el) => shown(el) && needle.test(clean(el.innerText)))
    .sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height);
  const box = boxes.find((el) => el.getBoundingClientRect().height > 120);
  if (!box) return { error: "no encontré el modal" };

  const nodes = [];
  for (const el of box.querySelectorAll("*")) {
    if (!shown(el)) continue;
    const own = clean([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" "));
    const interactive = ["INPUT", "SELECT", "BUTTON", "TEXTAREA", "A", "IFRAME"].includes(el.tagName)
      || el.getAttribute("role") !== null
      || el.getAttribute("contenteditable") !== null;
    if (!interactive && own === "") continue;
    nodes.push({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role"),
      type: el.getAttribute("type"),
      name: el.getAttribute("name"),
      id: el.getAttribute("id"),
      placeholder: el.getAttribute("placeholder"),
      src: (el.getAttribute("src") ?? "").slice(0, 70),
      cls: (el.getAttribute("class") ?? "").slice(0, 50),
      text: own.slice(0, 50),
    });
  }
  return { alto: Math.round(box.getBoundingClientRect().height), total: nodes.length, nodes: nodes.slice(0, 50) };
})()`);

console.log(JSON.stringify(out, null, 1));
cdp.close();
process.exit(0);
