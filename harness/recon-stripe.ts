/**
 * ¿Los selectores del driver encuentran los campos de Stripe Elements de verdad?
 *
 * Existe porque el test del driver corre contra un checkout falso que escribimos
 * nosotros, y eso es circular: prueba que nuestros selectores encuentran nuestro
 * HTML. Acá el HTML es de Stripe, servido desde js.stripe.com, con sus iframes y
 * sus atributos reales. Es la diferencia entre creer que funciona y saberlo.
 *
 * Necesita red, así que no va en `npm test`. Se corre a mano cuando se toca
 * FIELD_SELECTORS:
 *
 *   npm run recon:stripe
 */

import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { CheckoutDriver, type FieldName } from "../src/driver.js";
import { findChrome, launchChrome } from "./chrome.js";

const FIXTURE = join(import.meta.dirname, "fixtures", "stripe-elements.html");
const FIELDS: FieldName[] = [
  "number",
  "expiry",
  "expiryMonth",
  "expiryYear",
  "cvc",
  "name",
  "submit",
];

async function main(): Promise<void> {
  if (findChrome() === null) {
    console.error("No encontré Chrome. Este reconocimiento lo necesita.");
    process.exitCode = 1;
    return;
  }

  const { origin, stop } = await serveFixture();
  const chrome = await launchChrome();

  try {
    const report = await new CheckoutDriver().inspect({
      url: `${origin}/`,
      connectUrl: chrome.cdpUrl,
      formTimeoutMs: 20_000,
    });

    console.log("");
    console.log("Stripe Elements real, servido desde js.stripe.com:");
    console.log("");
    for (const field of FIELDS) {
      const hit = report.found[field];
      console.log(`  ${hit === undefined ? "✗" : "✓"} ${field.padEnd(12)} ${hit ?? "(no encontrado)"}`);
    }
    console.log("");

    if (report.usable) {
      console.log("Los selectores sirven contra Stripe. Un checkout con Stripe se puede intentar.");
      process.exitCode = 0;
    } else {
      console.log(`FALTAN: ${report.missing.join(", ")}.`);
      console.log("");
      console.log("Campos que había:");
      for (const input of report.inputs) console.log(`  · ${input}`);
      console.log("");
      console.log("Hay que arreglar FIELD_SELECTORS (src/driver.ts) antes de probar con una tarjeta.");
      process.exitCode = 1;
    }
  } finally {
    await chrome.kill();
    await stop();
  }
}

/** Servir el fixture desde http: Stripe.js no monta los Elements desde file://. */
async function serveFixture(): Promise<{ origin: string; stop: () => Promise<void> }> {
  const html = await readFile(FIXTURE, "utf8");
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("sin puerto");

  return {
    origin: `http://127.0.0.1:${address.port}`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
