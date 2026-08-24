/**
 * ¿Qué registradores blindan el alta de cuenta con captcha?
 *
 * Comprar un dominio exige cuenta, y el alta es donde se cae la automatización.
 * Antes de elegir un comercio para la prueba conviene saber cuál se puede pasar,
 * y eso se contesta mirando: no hace falta registrarse ni pagar nada.
 *
 * Esto solo abre páginas públicas de registro y busca el widget. No envía
 * formularios, no crea cuentas y no toca ninguna tarjeta.
 *
 *   npx tsx harness/recon-signup.ts
 */

import { chromium } from "playwright-core";
import { launchChrome } from "./chrome.js";

interface Target {
  name: string;
  url: string;
}

const TARGETS: Target[] = [
  { name: "Porkbun", url: "https://porkbun.com/account/create" },
  { name: "Namecheap", url: "https://www.namecheap.com/myaccount/signup/" },
  { name: "NameSilo", url: "https://www.namesilo.com/account_registration.php" },
  { name: "Dynadot", url: "https://www.dynadot.com/account/sign-up" },
  { name: "Spaceship", url: "https://www.spaceship.com/auth/signup/" },
  { name: "Gandi", url: "https://id.gandi.net/register" },
];

/** Lo que encontramos en una página de registro. */
interface Finding {
  name: string;
  reachable: boolean;
  captchas: string[];
  note: string;
}

async function main(): Promise<void> {
  // Con headless, Cloudflare sirve su propia pantalla de desafío y eso haría
  // ver un Turnstile que en realidad no es del formulario de alta.
  const chrome = await launchChrome({ headed: true });
  const browser = await chromium.connectOverCDP(chrome.cdpUrl);
  const findings: Finding[] = [];

  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    for (const target of TARGETS) {
      findings.push(await probe(context, target));
    }
  } finally {
    await browser.close();
    await chrome.kill();
  }

  report(findings);
}

async function probe(
  context: import("playwright-core").BrowserContext,
  target: Target,
): Promise<Finding> {
  const page = await context.newPage();
  try {
    await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    // Los widgets se montan por JS bastante después del DOM.
    await page.waitForTimeout(6_000);

    const found = await page.evaluate(() => {
      const hits = new Set<string>();
      const html = document.documentElement.outerHTML;

      if (/porkcaptcha/i.test(html)) hits.add("porkcaptcha");
      if (/turnstile|cf-chl-widget/i.test(html)) hits.add("Cloudflare Turnstile");
      if (/g-recaptcha|recaptcha\//i.test(html)) hits.add("reCAPTCHA");
      if (/hcaptcha/i.test(html)) hits.add("hCaptcha");
      if (/funcaptcha|arkoselabs/i.test(html)) hits.add("Arkose/FunCaptcha");
      if (/geetest/i.test(html)) hits.add("GeeTest");

      const hasPassword = document.querySelector('input[type="password"]') !== null;
      return { hits: [...hits], hasPassword, title: document.title };
    });

    const note = found.hasPassword
      ? "formulario de alta visible"
      : "no vi campo de contraseña: el alta puede estar detrás de un paso previo";

    return { name: target.name, reachable: true, captchas: found.hits, note };
  } catch (error) {
    const why = error instanceof Error ? error.message.split("\n")[0] ?? "" : String(error);
    return { name: target.name, reachable: false, captchas: [], note: why };
  } finally {
    await page.close();
  }
}

function report(findings: Finding[]): void {
  console.log("");
  console.log("Captcha en el alta de cuenta de cada registrador");
  console.log("(solo lectura: no se creó ninguna cuenta)");
  console.log("");

  for (const f of findings) {
    if (!f.reachable) {
      console.log(`  ${pad(f.name)} NO SE PUDO ABRIR  ${f.note}`);
      continue;
    }
    const verdict = f.captchas.length === 0 ? "sin captcha visible" : f.captchas.join(", ");
    console.log(`  ${pad(f.name)} ${verdict}`);
    console.log(`  ${pad("")} ${f.note}`);
  }

  const clean = findings.filter((f) => f.reachable && f.captchas.length === 0);
  console.log("");
  if (clean.length === 0) {
    console.log("Todos blindan el alta. Los dominios son categoría de fraude alto y se nota:");
    console.log("cambiar de registrador no evita el captcha.");
  } else {
    console.log(`Candidatos sin captcha: ${clean.map((f) => f.name).join(", ")}.`);
    console.log("Ojo: 'sin captcha visible' es al cargar la página. Puede aparecer al enviar.");
  }
  console.log("");
}

function pad(value: string): string {
  return value.padEnd(12, " ");
}

await main();
