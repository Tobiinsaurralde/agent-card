/**
 * Prueba el camino sin browser: Porkbun por API.
 *
 * El orden de los subcomandos es el orden en que conviene correrlos, de más
 * barato a más caro: `--ping` no toca nada, `--preview` cotiza sin cobrar, y
 * `--buy` es el único que mueve plata (y pide el gate del entorno).
 *
 *   npm run test:porkbun -- --ping
 *   npm run test:porkbun -- --preview konexpay.cfd
 *   npm run test:porkbun -- --buy konexpay.cfd --max 2.00
 */
import { randomUUID } from "node:crypto";
import {
  OverAuthorizedError,
  PorkbunApi,
  PorkbunError,
  usd,
} from "../registrars/porkbun-api.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };

  const api = PorkbunApi.fromEnv();

  if (argv.includes("--ping")) {
    const { ip } = await api.ping();
    console.log(`Credenciales OK. Porkbun nos ve desde ${ip}.`);
    return;
  }

  const check = get("--check");
  if (check !== undefined) {
    const quote = await api.checkDomain(check);
    console.log(
      `${quote.domain}: ${quote.available ? "disponible" : "tomado"}` +
        (quote.registrationCents === null ? "" : ` · ${usd(quote.registrationCents)}`) +
        (quote.premium ? " · PREMIUM (la API no lo registra)" : ""),
    );
    return;
  }

  const preview = get("--preview");
  if (preview !== undefined) {
    await report(api, preview);
    return;
  }

  const buy = get("--buy");
  if (buy !== undefined) {
    const maxUsd = Number(get("--max") ?? "NaN");
    if (!Number.isFinite(maxUsd)) {
      console.error("Falta --max <usd>: el techo que estás autorizando. Sin techo no compro.");
      process.exitCode = 1;
      return;
    }
    const maxCents = Math.round(maxUsd * 100);

    const quote = await report(api, buy);
    if (!quote) {
      process.exitCode = 2;
      return;
    }

    // La key sale de acá y no del reintento: si esta corrida corta por timeout,
    // volver a correr con la MISMA key es lo que hace seguro el reintento.
    const key = randomUUID();
    console.log("");
    console.log(`Registrando ${buy} con techo ${usd(maxCents)}. Idempotency-Key: ${key}`);

    const done = await api.register(buy, { maxCents, idempotencyKey: key });
    console.log("");
    console.log(`REGISTRADO ${done.domain}`);
    console.log(`  cobrado    ${usd(done.costCents)}`);
    console.log(`  orden      ${done.orderId}`);
    console.log(`  saldo      ${usd(done.balanceCents)}`);
    console.log(`  requestId  ${done.requestId}`);
    return;
  }

  usage();
  process.exitCode = 1;
}

/** Cotiza y lo cuenta en voz alta. `false` si Porkbun dice que no cerraría. */
async function report(api: PorkbunApi, domain: string): Promise<boolean> {
  const p = await api.preview(domain);
  console.log("");
  console.log(`${p.domain} · ${p.available} · ${p.durationYears} año(s)`);
  console.log(`  costo    ${usd(p.costCents)}`);
  console.log(`  saldo    ${usd(p.balanceCents)}  ${p.sufficientFunds ? "alcanza" : "NO ALCANZA"}`);
  if (p.monthlySpendLimitCents !== null) {
    console.log(
      `  cap mes  ${usd(p.monthlySpendSoFarCents ?? 0)} de ${usd(p.monthlySpendLimitCents)}`,
    );
  }
  if (p.premium) console.log("  PREMIUM: la API no registra premium.");
  console.log("");
  console.log(p.wouldSucceed ? "Cerraría." : `NO cerraría: ${p.message}`);
  return p.wouldSucceed;
}

function usage(): void {
  console.error("Porkbun por API. El agente compra sin browser y sin captcha.");
  console.error("");
  console.error("  --ping                  ¿Sirven las claves? No toca nada.");
  console.error("  --check <dominio>       Disponibilidad y precio.");
  console.error("  --preview <dominio>     Cotiza y valida SIN cobrar (dryRun de Porkbun).");
  console.error("  --buy <dominio> --max <usd>");
  console.error("                          Registra de verdad. Cobra crédito de la cuenta.");
  console.error("");
  console.error("Antes de --buy, la cuenta de Porkbun necesita:");
  console.error("  · mail y teléfono verificados");
  console.error("  · al menos UN registro previo hecho desde la web (lo pide la API)");
  console.error("  · crédito cargado");
}

main().catch((error: unknown) => {
  if (error instanceof OverAuthorizedError) {
    console.error("");
    console.error(error.message);
    process.exitCode = 3;
    return;
  }
  if (error instanceof PorkbunError) {
    console.error("");
    console.error(`Porkbun: ${error.message}`);
    if (error.code !== null) console.error(`  código    ${error.code}`);
    if (error.requestId !== null) console.error(`  requestId ${error.requestId}`);
    process.exitCode = 4;
    return;
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
