/**
 * Anota qué llamadas hace el panel de un emisor cuando alguien crea una tarjeta.
 *
 * Existe para escribir un `CardProvider` contra un emisor que no publica API.
 * El panel es una app web: cuando el humano aprieta "crear tarjeta", el navegador
 * le pega a algo. Eso es la API, documentada o no. Leerla acá es más estable que
 * clickear el DOM, que es lo que nos propusieron.
 *
 * No pide credenciales ni las toca: se engancha al navegador que ya está abierto
 * y el humano entra a mano. Lo que queda grabado va redactado — el token de
 * sesión del panel y cualquier número de tarjeta salen enmascarados, porque el
 * archivo sobrevive a la corrida y un PAN en un log es exactamente lo que este
 * proyecto existe para evitar.
 *
 * Uso:
 *   node --import tsx harness/watch-net.ts [--base http://127.0.0.1:9222]
 *                                          [--host <regex>] [--out <archivo>]
 *
 * Se queda escuchando hasta Ctrl-C. Al cortar imprime el resumen ordenado.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

interface Args {
  base: string;
  host: RegExp | null;
  out: string;
}

function parseArgs(argv: string[]): Args {
  const value = (flag: string): string | null => {
    const at = argv.indexOf(flag);
    return at === -1 ? null : (argv[at + 1] ?? null);
  };
  const host = value("--host");
  return {
    base: value("--base") ?? "http://127.0.0.1:9222",
    host: host === null ? null : new RegExp(host, "i"),
    out: value("--out") ?? "harness/results/panel-net.jsonl",
  };
}

/**
 * Dominios que ensucian sin aportar. No es seguridad, es ruido: si no los saco,
 * el log queda enterrado en telemetría y la llamada que importa se pierde.
 */
const NOISE =
  /(google|gstatic|doubleclick|facebook|segment|sentry|datadog|newrelic|nr-data|hotjar|intercom|amplitude|mixpanel|launchdarkly|cloudflareinsights|clarity\.ms|recaptcha|hcaptcha)\./i;

/** Sólo lo que puede ser API. Imágenes, fuentes y bundles no dicen nada. */
const INTERESTING = new Set(["XHR", "Fetch", "Document", "WebSocket", "EventSource"]);

/** Claves cuyo valor no se guarda nunca, ni para debuggear. */
const SECRET_KEY = /pan|cvv|cvc|cvn|secret|password|passwd|token|bearer|authorization|apikey|api_key|private/i;

/** Claves que parecen secretas pero son justo lo que sí queremos ver. */
const SAFE_KEY = /last_?4|last_?four|masked|expiry|exp_?month|exp_?year|currency|status|limit|amount|balance/i;

/** Cabeceras que se guardan tal cual. El resto se resume o se tira. */
const SAFE_HEADER = /^(content-type|accept|x-request-id|x-correlation-id)$/i;

const PAN_LIKE = /\b(?:\d[ -]?){12,19}\b/g;

/** Deja los últimos cuatro y tapa el resto: alcanza para conciliar, no para cobrar. */
function maskPan(text: string): string {
  return text.replace(PAN_LIKE, (hit) => {
    const digits = hit.replace(/\D/g, "");
    if (digits.length < 12) return hit;
    return `«pan:*${digits.slice(-4)}»`;
  });
}

function redact(value: unknown, key = ""): unknown {
  if (key !== "" && SECRET_KEY.test(key) && !SAFE_KEY.test(key)) {
    const kind = typeof value === "string" ? `str(${value.length})` : typeof value;
    return `«redactado ${kind}»`;
  }
  if (typeof value === "string") return maskPan(value);
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redact(v, k)]),
    );
  }
  return value;
}

/**
 * El cuerpo, parseado si es JSON y redactado siempre.
 *
 * Si no es JSON se guarda un recorte enmascarado: sirve para reconocer un form
 * urlencoded o un error en HTML sin arrastrar la página entera al log.
 */
function body(raw: string | undefined): unknown {
  if (raw === undefined || raw === "") return null;
  try {
    return redact(JSON.parse(raw));
  } catch {
    return maskPan(raw).slice(0, 400);
  }
}

function headers(raw: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw ?? {})) {
    if (SAFE_HEADER.test(name)) {
      out[name] = value;
      continue;
    }
    // De las cabeceras de auth sólo interesa el esquema: nos dice si el provider
    // va a necesitar un bearer, una cookie o una firma. El valor, nunca.
    if (/^(authorization|cookie|x-api-key|x-auth-token)$/i.test(name)) {
      out[name] = `«${value.split(" ")[0] ?? "opaco"} de ${value.length} chars»`;
    }
  }
  return out;
}

interface Pending {
  method: string;
  url: string;
  sessionId: string;
  at: string;
}

interface Row {
  at: string;
  method: string;
  url: string;
  status?: number;
  reqHeaders: Record<string, string>;
  reqBody: unknown;
  resBody?: unknown;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const version = (await (await fetch(`${args.base}/json/version`)).json()) as {
    webSocketDebuggerUrl?: string;
  };
  if (version.webSocketDebuggerUrl === undefined) {
    throw new Error(
      `El navegador no expone el websocket en ${args.base}. ` +
        "Abrilo con --remote-debugging-port=9222.",
    );
  }

  mkdirSync(dirname(args.out), { recursive: true });

  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("no pude conectarme al navegador"));
  });

  let seq = 0;
  const waiting = new Map<number, (result: any) => void>();

  const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> =>
    new Promise((resolve) => {
      const id = ++seq;
      waiting.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) }));
    });

  const pending = new Map<string, Pending>();
  const rows: Row[] = [];

  const keep = (url: string, type: string): boolean => {
    if (!INTERESTING.has(type)) return false;
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      return false;
    }
    if (NOISE.test(host)) return false;
    return args.host === null ? true : args.host.test(host);
  };

  ws.onmessage = (event: MessageEvent) => {
    const msg = JSON.parse(String(event.data)) as {
      id?: number;
      method?: string;
      params?: any;
      sessionId?: string;
      result?: any;
    };

    if (msg.id !== undefined) {
      waiting.get(msg.id)?.(msg.result);
      waiting.delete(msg.id);
      return;
    }

    // Cada pestaña nueva llega como sesión aparte. Sin esto el panel abierto
    // después de arrancar la grabadora no se graba, que es el caso normal.
    if (msg.method === "Target.attachedToTarget") {
      const { sessionId, targetInfo } = msg.params as {
        sessionId: string;
        targetInfo: { type: string; url: string };
      };
      if (targetInfo.type === "page") {
        void send("Network.enable", {}, sessionId);
        console.log(`  ── escuchando pestaña: ${targetInfo.url.slice(0, 70)}`);
      }
      return;
    }

    if (msg.method === "Network.requestWillBeSent" && msg.sessionId !== undefined) {
      const { requestId, request, type } = msg.params as {
        requestId: string;
        request: { method: string; url: string; headers: Record<string, string>; postData?: string };
        type: string;
      };
      if (!keep(request.url, type)) return;

      const at = new Date().toISOString();
      pending.set(requestId, { method: request.method, url: request.url, sessionId: msg.sessionId, at });
      rows.push({
        at,
        method: request.method,
        url: request.url,
        reqHeaders: headers(request.headers),
        reqBody: body(request.postData),
      });
      console.log(`→ ${request.method} ${request.url.slice(0, 100)}`);
      return;
    }

    if (msg.method === "Network.responseReceived") {
      const { requestId, response } = msg.params as { requestId: string; response: { status: number } };
      const seen = pending.get(requestId);
      if (seen === undefined) return;
      const row = rows.find((r) => r.url === seen.url && r.at === seen.at);
      if (row !== undefined) row.status = response.status;
      return;
    }

    if (msg.method === "Network.loadingFinished") {
      const { requestId } = msg.params as { requestId: string };
      const seen = pending.get(requestId);
      if (seen === undefined) return;
      pending.delete(requestId);

      // El cuerpo hay que pedirlo, y sólo se puede una vez que terminó de bajar.
      void send("Network.getResponseBody", { requestId }, seen.sessionId).then((result) => {
        const row = rows.find((r) => r.url === seen.url && r.at === seen.at);
        if (row === undefined) return;
        row.resBody = body(result?.body);
        appendFileSync(args.out, `${JSON.stringify(row)}\n`);
        console.log(`← ${row.status ?? "?"} ${seen.method} ${seen.url.slice(0, 90)}`);
      });
    }
  };

  await send("Target.setDiscoverTargets", { discover: true });
  await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });

  console.log("Grabando. Entrá al panel y creá una tarjeta; yo anoto.");
  console.log(`Sale redactado a ${args.out}. Ctrl-C para cortar.\n`);

  const done = (): void => {
    console.log(`\n${rows.length} llamadas. Las que parecen API:`);
    for (const row of rows) {
      if (row.method === "GET" && row.reqBody === null && !/card|virtual|issue/i.test(row.url)) continue;
      console.log(`  ${row.status ?? "?"} ${row.method} ${row.url}`);
    }
    ws.close();
    process.exit(0);
  };
  process.on("SIGINT", done);
  process.on("SIGTERM", done);

  await new Promise(() => undefined);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
