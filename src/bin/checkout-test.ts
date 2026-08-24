/**
 * 127.0.0.1 y no "localhost": en Mac, localhost resuelve primero a ::1 y Chrome
 * escucha el puerto de depuración en IPv4, así que "localhost" da ECONNREFUSED
 * con el navegador perfectamente abierto.
 */
const DEFAULT_CDP = "http://127.0.0.1:9222";

/** El código de verificación del alta, si nos lo dejaron a mano. */
async function envEmailCode(): Promise<string | null> {
  const code = process.env["AGENT_CARD_TEST_EMAIL_CODE"]?.trim();
  return code === undefined || code === "" ? null : code;
}

/**
 * La medición: ¿puede una tarjeta completar una compra online de verdad?
 *
 * Un intento, un comercio, un veredicto. No reintenta nunca, ni siquiera cuando
 * el resultado queda en "desconocido": ahí lo que hace falta es que una persona
 * mire, no que el programa insista.
 *
 * Uso:
 *   npm run test:checkout -- --url https://comercio/checkout
 */

import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { launchChrome } from "../../harness/chrome.js";
import { buyerFromEnv, MissingBuyerFieldError } from "../buyer.js";
import { DECLINE_MEANING, explain } from "../checkout.js";
import { CardCredentials } from "../credentials.js";
import { CheckoutDriver, FormNotFoundError } from "../driver.js";
import {
  AccountCaptchaError,
  AccountRejectedError,
  EmailCodeError,
  preparePorkbunCheckout,
} from "../merchants/porkbun.js";
import {
  prepareSpaceshipCheckout,
  SpaceshipEmailCodeError,
  SpaceshipError,
} from "../merchants/spaceship.js";
import { SteelBrowser } from "../browser.js";
import type { CheckoutSession } from "../browser.js";

/**
 * Spaceship es el default porque su alta no tiene captcha y el `.xyz` sale más
 * barato, lo que deja margen sobre el saldo de la tarjeta. Porkbun queda para
 * comparar: su alta está detrás de un Turnstile que un agente solo no pasa.
 */
export type Merchant = "spaceship" | "porkbun";

interface Args {
  /** `null` significa "usá la pestaña que ya está abierta". */
  url: string | null;
  /** Dominio a comprar de punta a punta. El agente no espera el carrito armado. */
  buy: string | null;
  merchant: Merchant;
  connectUrl: string | null;
  useSteel: boolean;
  dryRun: boolean;
  screenshot: string;
}

const CHROME_HINT = `
Para conectarme a tu Chrome, abrilo con el puerto de depuración prendido:

  Mac:
    /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome \\
      --remote-debugging-port=9222 --user-data-dir=/tmp/agent-card-test

  Después dejá el carrito armado en el checkout y volvé a correr esto.

Usar un --user-data-dir aparte es a propósito: no toca tu perfil ni tus sesiones.
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  let launched: Awaited<ReturnType<typeof launchChrome>> | null = null;

  if (args.buy !== null && args.connectUrl === null && !args.useSteel) {
    launched = await launchChrome({ headed: true });
    args.connectUrl = launched.cdpUrl;
  }

  try {
    if (args.buy !== null) {
      const buyer = buyerFromEnv();
      const connectUrl = args.connectUrl ?? DEFAULT_CDP;
      console.log(`Comprando ${args.buy} en ${args.merchant}. El agente arma el carrito y la cuenta.`);
      const prep = { domain: args.buy, buyer, connectUrl, emailCode: envEmailCode };
      if (args.merchant === "spaceship") await prepareSpaceshipCheckout(prep);
      else await preparePorkbunCheckout(prep);
      args.url = null;
    }

    if (args.dryRun) {
      await dryRun(args);
      return;
    }

    await pay(args);
  } catch (error) {
    if (error instanceof MissingBuyerFieldError) {
      console.error("");
      console.error("El agente no tiene el perfil del comprador:");
      for (const key of error.keys) console.error(`  ${key}`);
      console.error("Van en .env. No se piden en el checkout.");
      process.exitCode = 2;
      return;
    }
    if (error instanceof SpaceshipEmailCodeError) {
      console.error("");
      console.error("MURO: Spaceship pide un código de verificación por mail.");
      console.error("");
      console.error("Es un paso del alta, no del pago. Se pasa una vez:");
      console.error("  AGENT_CARD_TEST_EMAIL_CODE=123456 npm run test:checkout -- --buy <dominio>");
      console.error("");
      console.error("La tarjeta todavía no se tocó.");
      process.exitCode = 4;
      return;
    }
    if (error instanceof SpaceshipError) {
      console.error("");
      console.error(error.message);
      console.error("");
      console.error("Es el alta o el carrito, no el pago: la tarjeta todavía no se tocó.");
      process.exitCode = 5;
      return;
    }
    if (error instanceof AccountRejectedError) {
      console.error("");
      console.error(error.message);
      console.error("");
      console.error("Es el alta de cuenta, no el pago: la tarjeta todavía no se tocó.");
      process.exitCode = 5;
      return;
    }
    if (error instanceof EmailCodeError) {
      console.error("");
      console.error("MURO: Porkbun pide un código de verificación por mail.");
      console.error("");
      console.error("Es un paso del alta de cuenta, no del pago. Se hace una vez:");
      console.error("  AGENT_CARD_TEST_EMAIL_CODE=123456 npm run test:checkout -- --buy <dominio>");
      console.error("");
      console.error("Esto no dice nada sobre la tarjeta todavía.");
      process.exitCode = 4;
      return;
    }
    if (error instanceof AccountCaptchaError) {
      console.error("");
      console.error("MURO: captcha en el alta de cuenta.");
      console.error("");
      console.error(error.message);
      console.error("");
      console.error("Esto NO dice nada sobre la tarjeta: el captcha está antes del pago.");
      console.error("Con la cuenta ya creada, el agente entra y paga sin intervención.");
      process.exitCode = 3;
      return;
    }
    throw error;
  } finally {
    if (launched !== null) await launched.kill();
  }
}

async function pay(args: Args): Promise<void> {
  const card = CardCredentials.fromEnv();

  let session: CheckoutSession | null = null;
  let connectUrl = args.connectUrl;

  if (args.useSteel) {
    if (args.url === null) {
      console.error("--steel abre un navegador nuevo, así que no hay pestaña previa: usá --url.");
      process.exitCode = 1;
      return;
    }
    const steel = SteelBrowser.fromEnv();
    session = await steel.open({ merchant: new URL(args.url).hostname });
    connectUrl = session.connectUrl;
    console.log(`Sesión de Steel: ${session.id}`);
    if (session.viewerUrl !== null) console.log(`Mirala en vivo: ${session.viewerUrl}`);
  }

  connectUrl ??= DEFAULT_CDP;

  console.log("");
  console.log(`Página:    ${args.url ?? "la que ya está abierta"}`);
  console.log(`Tarjeta:   ${card.brand} ••${card.last4}`);
  console.log(`Navegador: ${connectUrl}`);
  console.log("");
  console.log("UN intento. Si sale mal, no lo repito: reintentar el mismo checkout con la");
  console.log("misma tarjeta es el patrón del card testing y te pueden bloquear la tarjeta.");
  console.log("");

  await mkdir(dirname(args.screenshot), { recursive: true });

  try {
    const report = await new CheckoutDriver().attempt({
      ...(args.url !== null ? { url: args.url } : {}),
      card,
      connectUrl,
      screenshotPath: args.screenshot,
    });

    console.log(`Llené: ${report.filled.join(", ")}`);
    console.log(`Terminó en: ${report.finalUrl}`);
    if (report.screenshotPath !== null) console.log(`Captura: ${report.screenshotPath}`);
    console.log("");
    console.log(`VEREDICTO: ${report.outcome.kind.toUpperCase()}`);
    console.log(explain(report.outcome));
    console.log(`Evidencia: ${report.outcome.evidence}`);
    console.log("");
    console.log(verdictAdvice(report.outcome));

    // Un rechazo estructural es un resultado válido del test, no un fallo de la
    // corrida: salir con 0 para no confundir "midió bien" con "se rompió".
    process.exitCode = 0;
  } catch (error) {
    if (error instanceof FormNotFoundError) {
      console.error("");
      console.error("NO SE PUDO MEDIR: no entendí el formulario del comercio.");
      console.error("");
      console.error(card.redact(error.message));
      console.error("");
      console.error(
        "Esto es un bug nuestro, no un veredicto sobre la tarjeta. No concluyas nada del emisor:\n" +
          "agregá los selectores que faltan en FIELD_SELECTORS (src/driver.ts) o probá otro comercio.",
      );
      process.exitCode = 2;
      return;
    }
    console.error("");
    console.error(card.redact(`Se cortó el intento: ${message(error)}`));
    console.error("");
    console.error(
      "Si el navegador no responde, revisá que Chrome esté abierto con --remote-debugging-port=9222.",
    );
    process.exitCode = 1;
  } finally {
    if (session !== null) await session.close().catch(() => undefined);
  }
}

/**
 * Reconocimiento: ¿este comercio se entiende? Sin tarjeta, sin llenar y sin
 * enviar. Es lo que hay que correr antes de arriesgar un cobro.
 */
async function dryRun(args: Args): Promise<void> {
  const connectUrl = args.connectUrl ?? DEFAULT_CDP;
  console.log("");
  console.log(`Reconocimiento de ${args.url ?? "la pestaña abierta"}`);
  console.log("Sin tarjeta, sin llenar y sin enviar nada.");
  console.log("");

  const report = await new CheckoutDriver().inspect({
    ...(args.url !== null ? { url: args.url } : {}),
    connectUrl,
  });

  console.log(`Terminó en: ${report.url}`);
  console.log("");
  for (const field of ["number", "expiry", "expiryMonth", "expiryYear", "cvc", "name", "submit"] as const) {
    const hit = report.found[field];
    console.log(`  ${hit === undefined ? "✗" : "✓"} ${field.padEnd(12)} ${hit ?? "(no encontrado)"}`);
  }
  console.log("");

  if (report.usable) {
    console.log("SE ENTIENDE. Este comercio se puede intentar con una tarjeta.");
  } else {
    console.log(`NO SE ENTIENDE. Faltan: ${report.missing.join(", ")}.`);
    console.log("");
    console.log("Campos que había en la página:");
    for (const input of report.inputs) console.log(`  · ${input}`);
    console.log("");
    console.log("Con eso se agregan los selectores que falten en FIELD_SELECTORS (src/driver.ts).");
    process.exitCode = 2;
  }
}

/** Qué hacer con el resultado, que es la parte que importa mañana. */
function verdictAdvice(outcome: {
  kind: string;
  reason: string | null;
  confidence: string;
}): string {
  if (outcome.kind === "aprobado") {
    return outcome.confidence === "alta"
      ? "La tarjeta compra online. Repetilo en un comercio más estricto (una suscripción SaaS)\n" +
          "antes de darlo por general: los comercios no son todos igual de exigentes."
      : "Confirmá en el emisor que el cobro entró antes de contarlo como aprobado.";
  }
  if (outcome.kind === "desafio_3ds") {
    return "Quedó pidiendo verificación del banco. Resolvela a mano en el navegador y mirá\n" +
      "dónde termina: si aprueba, la tarjeta sirve pero necesita 3DS interactivo, y eso\n" +
      "un agente solo no lo puede pasar.";
  }
  if (outcome.kind === "desconocido") {
    return "Revisá a mano en el emisor si el cobro entró. NO reintentes hasta saberlo.";
  }

  const reason = outcome.reason as keyof typeof DECLINE_MEANING | null;
  if (reason !== null && DECLINE_MEANING[reason]?.structural === true) {
    return (
      "Rechazo estructural: esta tarjeta no sirve para el producto y no se arregla con código.\n" +
      "Lo que sigue es probar la MISMA compra con una tarjeta KYC-eada. Si esa pasa, quedó\n" +
      "probado que el problema es el programa de emisión y hay que cambiar de emisor."
    );
  }
  return "Es un rechazo arreglable. Corregí lo que dice el motivo y probá de nuevo.";
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const at = argv.indexOf(flag);
    return at === -1 ? undefined : argv[at + 1];
  };

  if (argv.length === 0 || argv.includes("--help")) {
    console.error("Uso:");
    console.error("");
    console.error("  npm run test:checkout -- --buy konextech.xyz  ← el agente hace todo");
    console.error("  npm run test:checkout -- --here --dry-run");
    console.error("");
    console.error("Opciones:");
    console.error("  --buy <dominio>      De punta a punta: busca, arma el carrito, cuenta, paga.");
    console.error("  --at <comercio>      spaceship (default) o porkbun. Spaceship no tiene");
    console.error("                       captcha en el alta; el de Porkbun no lo pasa un agente.");
    console.error("  --here               Usa la pestaña que ya tenés abierta, sin navegar.");
    console.error("                       Es lo que querés casi siempre: los checkouts son de");
    console.error("                       varios pasos y navegar te saca del carrito que armaste.");
    console.error("  --url <url>          Navega a esa URL primero. Solo sirve si el formulario");
    console.error("                       de tarjeta está ahí de entrada.");
    console.error("  --dry-run            Solo mira si encuentra el formulario. Sin tarjeta y sin enviar");
    console.error(`  --connect <ws|http>  CDP a usar. Default: ${DEFAULT_CDP}`);
    console.error("  --steel              Abre una sesión de Steel en vez del Chrome local");
    console.error("  --out <archivo>      Dónde dejar la captura del resultado");
    console.error(CHROME_HINT);
    process.exit(1);
  }

  const url = get("--url");
  const buy = get("--buy") ?? null;
  if (url === undefined && buy === null && !argv.includes("--here")) {
    console.error("Decidí: --buy <dominio>, --here, o --url <url>.");
    process.exit(1);
  }

  const at = get("--at") ?? "spaceship";
  if (at !== "spaceship" && at !== "porkbun") {
    console.error(`No conozco el comercio "${at}". Son: spaceship, porkbun.`);
    process.exit(1);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return {
    url: url ?? null,
    buy,
    merchant: at,
    connectUrl: get("--connect") ?? null,
    useSteel: argv.includes("--steel"),
    dryRun: argv.includes("--dry-run"),
    screenshot: resolve(get("--out") ?? `harness/results/checkout-${stamp}.png`),
  };
}

function message(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

main().catch((error: unknown) => {
  console.error(`No pudo arrancar: ${message(error)}`);
  process.exitCode = 1;
});
