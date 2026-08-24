/**
 * Mirar el flujo de compra de Spaceship antes de automatizarlo.
 *
 * Con Porkbun se escribieron los selectores a ojo y cada equivocación costó una
 * corrida contra el sitio real, con una cuenta creada a medias y un antibot cada
 * vez más suspicaz. Acá se leen los nombres verdaderos primero.
 *
 * Solo navega y lee. No envía formularios, no crea cuentas y no toca la tarjeta.
 *
 *   npx tsx harness/recon-spaceship.ts konextech.xyz
 */

import { chromium, type Page } from "playwright-core";
import { launchChrome } from "./chrome.js";

const domain = process.argv[2] ?? "konextech.xyz";

async function main(): Promise<void> {
  const chrome = await launchChrome({ headed: true });
  const browser = await chromium.connectOverCDP(chrome.cdpUrl);

  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = await context.newPage();

    await step(page, "Búsqueda del dominio", `https://www.spaceship.com/domain-search/?query=${domain}`);
    await step(page, "Carrito", "https://www.spaceship.com/cart/");
    await step(page, "Alta de cuenta", "https://www.spaceship.com/auth/signup/");
  } finally {
    await browser.close();
    await chrome.kill();
  }
}

async function step(page: Page, label: string, url: string): Promise<void> {
  console.log("");
  console.log("=".repeat(70));
  console.log(label);
  console.log("=".repeat(70));

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  } catch (error) {
    console.log(`  no se pudo abrir: ${error instanceof Error ? error.message.split("\n")[0] : error}`);
    return;
  }
  // El sitio monta casi todo por JS.
  await page.waitForTimeout(8_000);

  const seen = await page.evaluate(() => {
    const inputs: string[] = [];
    for (const el of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")) {
      const parts = [
        el.tagName.toLowerCase(),
        (el as HTMLInputElement).type ? `type=${(el as HTMLInputElement).type}` : "",
        el.name ? `name=${el.name}` : "",
        el.id ? `id=${el.id}` : "",
        el.getAttribute("placeholder") ? `ph=${el.getAttribute("placeholder")}` : "",
        el.getAttribute("autocomplete") ? `ac=${el.getAttribute("autocomplete")}` : "",
      ].filter((p) => p !== "");
      inputs.push(parts.join(" "));
    }

    const actions: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('button, a[href], [role="button"]')) {
      if (el.offsetParent === null) continue;
      const text = (el.innerText || "").trim().replace(/\s+/g, " ");
      if (text !== "" && text.length < 60) actions.push(text);
    }

    const html = document.documentElement.outerHTML;
    const captchas: string[] = [];
    if (/turnstile|cf-chl-widget/i.test(html)) captchas.push("Turnstile");
    if (/g-recaptcha|recaptcha\//i.test(html)) captchas.push("reCAPTCHA");
    if (/hcaptcha/i.test(html)) captchas.push("hCaptcha");

    return {
      url: location.href,
      title: document.title,
      inputs: [...new Set(inputs)].slice(0, 40),
      actions: [...new Set(actions)].slice(0, 30),
      captchas,
      text: (document.body.innerText || "").trim().replace(/\s+/g, " ").slice(0, 500),
    };
  });

  console.log(`URL final: ${seen.url}`);
  console.log(`Título:    ${seen.title}`);
  console.log(`Captcha:   ${seen.captchas.length === 0 ? "no detecté" : seen.captchas.join(", ")}`);
  console.log("");
  console.log("Campos:");
  if (seen.inputs.length === 0) console.log("  (ninguno)");
  for (const input of seen.inputs) console.log(`  · ${input}`);
  console.log("");
  console.log("Botones y links:");
  if (seen.actions.length === 0) console.log("  (ninguno)");
  for (const action of seen.actions) console.log(`  · ${action}`);
  console.log("");
  console.log(`Texto: ${seen.text}`);
}

await main();
