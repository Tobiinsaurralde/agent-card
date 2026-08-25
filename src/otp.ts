import { readFile, rm } from "node:fs/promises";

/**
 * De dónde saca el agente un código de verificación de un solo uso.
 *
 * Los comercios mandan un código al mail antes de dejar entrar, y eso deja al
 * agente esperando a un humano. La tentación es cortar el proceso y pedir que se
 * vuelva a correr con el código en una variable de entorno, pero eso no funciona:
 * al reiniciar, el login se hace de nuevo y el comercio manda un código nuevo,
 * que invalida el anterior. Se persigue la cola para siempre.
 *
 * Por eso el agente **espera sin soltar la sesión**: se queda mirando un archivo
 * hasta que alguien escribe el código. Es un punto de intervención humana con
 * forma de archivo, y una vez que el perfil del navegador queda autenticado, no
 * se usa más.
 */

export type EmailCodeSource = () => Promise<string | null>;

export interface WaitForCodeOpts {
  /** Archivo donde se espera el código. */
  path: string;
  timeoutMs?: number;
  pollMs?: number;
  /** Para avisar por dónde va. Silencioso en los tests. */
  log?: (message: string) => void;
}

/** Espera a que aparezca un código en un archivo. `null` si se agotó el tiempo. */
export function codeFromFile(opts: WaitForCodeOpts): EmailCodeSource {
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  const pollMs = opts.pollMs ?? 2_000;
  const log = opts.log ?? ((m: string) => console.log(m));

  return async (): Promise<string | null> => {
    log("");
    log("El comercio pide un código de verificación por mail.");
    log(`Escribilo acá y sigo solo (espero ${Math.round(timeoutMs / 60_000)} min):`);
    log(`  echo 123456 > ${opts.path}`);
    log("");

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const code = await readCode(opts.path);
      if (code !== null) {
        // De un solo uso: dejarlo escrito haría que la próxima corrida use un
        // código ya vencido y lea el rechazo como un problema de la tarjeta.
        await rm(opts.path, { force: true });
        log(`  código recibido (${code.length} caracteres). Sigo.`);
        return code;
      }
      await sleep(pollMs);
    }

    log("  no llegó ningún código.");
    return null;
  };
}

async function readCode(path: string): Promise<string | null> {
  const raw = await readFile(path, "utf8").catch(() => null);
  if (raw === null) return null;
  const code = raw.trim();
  // Un archivo a medio escribir no es un código.
  return /^[a-zA-Z0-9]{4,10}$/.test(code) ? code : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
