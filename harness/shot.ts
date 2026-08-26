/**
 * Capturas rápidas del sitio buildeado, para revisar el rediseño sin abrir
 * nada a mano. Usa el Chrome instalado (playwright-core no trae browser).
 *
 *   node --import tsx harness/shot.ts http://localhost:4610
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:4610";
const outDir =
  process.env["KONEX_DARK"] === "1" ? "harness/results/shots/dark" : "harness/results/shots";
mkdirSync(outDir, { recursive: true });

const pages = [
  { path: "/", name: "landing-top", fullPage: false },
  { path: "/", name: "landing-full", fullPage: true },
  { path: "/panel.html", name: "panel", fullPage: true },
  { path: "/simulador.html", name: "simulador", fullPage: true },
];

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

for (const target of pages) {
  const page = await context.newPage();
  await page.goto(base + target.path, { waitUntil: "networkidle" });
  // KONEX_DARK=1 fuerza el tema oscuro, para revisar ambos modos.
  if (process.env["KONEX_DARK"] === "1") {
    await page.evaluate(() => document.documentElement.classList.add("dark"));
  }
  // Las secciones entran con IntersectionObserver: hay que recorrer la página
  // para que se revelen, si no la foto completa sale con huecos vacíos.
  if (target.fullPage) {
    await page.evaluate(async () => {
      const step = window.innerHeight / 2;
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
      }
      window.scrollTo(0, 0);
    });
  }
  // Que las animaciones de entrada terminen antes de la foto.
  await page.waitForTimeout(900);
  const file = `${outDir}/${target.name}.png`;
  await page.screenshot({ path: file, fullPage: target.fullPage });
  console.log(`✓ ${file}`);
  await page.close();
}

await browser.close();
