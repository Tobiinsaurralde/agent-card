import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { ServiceSnapshot } from "./service.js";

/**
 * El ledger en disco.
 *
 * Sin esto el servicio vive en memoria: reiniciar borra lo gastado y vuelve a
 * depositar el presupuesto, así que cualquiera baja el proceso y se limpia el
 * cap. Un tope que se resetea solo no es un tope, y era el agujero más grande
 * que tenía el producto.
 *
 * No guarda ningún dato de tarjeta: ni PAN, ni CVC, ni vencimiento. Eso sale del
 * entorno o del emisor en cada arranque. Acá viven montos, decisiones y recibos.
 */

const VERSION = 1;

interface Envelope {
  version: number;
  savedAt: string;
  state: ServiceSnapshot;
}

export class StateFileError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = "StateFileError";
  }
}

export class FileStore {
  constructor(private readonly path: string) {}

  /** `null` sólo si el archivo no existe todavía, que es un arranque limpio legítimo. */
  load(): ServiceSnapshot | null {
    if (!existsSync(this.path)) return null;

    let raw: string;
    try {
      raw = readFileSync(this.path, "utf8");
    } catch (error) {
      throw new StateFileError(this.path, `No pude leer el ledger: ${describe(error)}`);
    }

    let envelope: Envelope;
    try {
      envelope = JSON.parse(raw) as Envelope;
    } catch (error) {
      // Deliberadamente ruidoso. Arrancar de cero acá sería recargar el
      // presupuesto y perder lo gastado, en silencio y justo cuando algo ya
      // salió mal. Mejor no arrancar y que alguien mire el archivo.
      throw new StateFileError(
        this.path,
        `El ledger está corrupto (${describe(error)}). No arranco: revisá el archivo o movelo a mano si querés empezar de cero.`,
      );
    }

    if (envelope.version !== VERSION) {
      throw new StateFileError(
        this.path,
        `El ledger es de la versión ${String(envelope.version)} y esta build entiende la ${String(VERSION)}. No arranco para no malinterpretar montos.`,
      );
    }
    return envelope.state;
  }

  /**
   * Escribe a un temporal y renombra. El rename es atómico en el mismo
   * filesystem, así que un corte a mitad de camino deja el ledger anterior
   * entero en vez de un archivo a medio escribir.
   */
  save(state: ServiceSnapshot): void {
    const envelope: Envelope = {
      version: VERSION,
      savedAt: new Date().toISOString(),
      state,
    };
    const tmp = `${this.path}.tmp`;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(tmp, JSON.stringify(envelope, null, 2), { encoding: "utf8", mode: 0o600 });
      renameSync(tmp, this.path);
    } catch (error) {
      throw new StateFileError(this.path, `No pude guardar el ledger: ${describe(error)}`);
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
