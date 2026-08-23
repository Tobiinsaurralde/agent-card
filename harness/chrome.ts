import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

/** Los lugares donde suele estar Chrome. El primero que exista gana. */
const CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

export interface LaunchedChrome {
  cdpUrl: string;
  kill: () => Promise<void>;
}

export function findChrome(): string | null {
  return CANDIDATES.find((path) => existsSync(path)) ?? null;
}

/**
 * Chrome headless con el puerto de depuración, igual que lo abre una persona
 * para correr el test.
 *
 * El puerto lo elige Chrome (`0`) y lo publica en `DevToolsActivePort`: pedirle
 * uno fijo hace que choque con cualquier cosa que ya lo esté usando, y en un
 * test eso aparece como falla intermitente sin relación con el código.
 */
export async function launchChrome(): Promise<LaunchedChrome> {
  const binary = findChrome();
  if (binary === null) throw new Error("No encontré Chrome en esta máquina.");

  const profile = await mkdtemp(join(tmpdir(), "agent-card-chrome-"));
  const child: ChildProcess = spawn(
    binary,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
    ],
    { stdio: "ignore" },
  );

  const cleanup = async (): Promise<void> => {
    child.kill("SIGKILL");
    await rm(profile, { recursive: true, force: true });
  };

  const portFile = join(profile, "DevToolsActivePort");
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const [port] = (await readFile(portFile, "utf8")).split("\n");
      if (port !== undefined && port.trim() !== "") {
        // 127.0.0.1 y no localhost: en Mac localhost resuelve a ::1 primero y el
        // puerto de depuración escucha en IPv4.
        return { cdpUrl: `http://127.0.0.1:${port.trim()}`, kill: cleanup };
      }
    } catch {
      // Todavía no lo escribió.
    }
    await sleep(200);
  }

  await cleanup();
  throw new Error("Chrome no publicó el puerto de depuración en 20s.");
}
