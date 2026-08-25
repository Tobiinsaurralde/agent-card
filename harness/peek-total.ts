/** Qué dice la página alrededor de la palabra "total". Solo lee. */
import { attach, PAGE_HELPERS, targets } from "./cdp.js";

const base = process.argv[2] ?? "http://127.0.0.1:9222";
const all = await targets(base);
const page = all.find((t) => t.type === "page" && /spaceship\.com/i.test(t.url ?? ""));
if (page?.webSocketDebuggerUrl === undefined) {
  console.error("no encontré la pestaña de Spaceship");
  process.exit(1);
}

const cdp = await attach(page.webSocketDebuggerUrl);
const out = await cdp.evaluate(`(() => {
  ${PAGE_HELPERS}
  const text = clean(document.body.innerText);
  const around = [];
  const re = /total/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    around.push(text.slice(Math.max(0, m.index - 40), m.index + 90));
  }
  return {
    url: location.href,
    montos: [...new Set(text.match(/\\$\\s?[0-9]+[.,][0-9]{2}/g) ?? [])],
    contextos: around,
  };
})()`);

console.log(JSON.stringify(out, null, 1));
cdp.close();
process.exit(0);
