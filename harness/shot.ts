/**
 * Una captura de la pestaña, por CDP. Solo lee.
 *
 * Cuando el DOM dice que no hay campos y la página igual muestra un formulario,
 * mirar es más rápido que deducir.
 */
import { writeFile } from "node:fs/promises";

const target = process.argv[2];
const out = process.argv[3] ?? "harness/results/shot.png";
if (target === undefined) {
  console.error("Uso: shot.ts ws://… [salida.png]");
  process.exit(1);
}

const ws = new WebSocket(target);
let seq = 0;
const pending = new Map<number, (value: any) => void>();

function send(method: string, params: Record<string, unknown> = {}): Promise<any> {
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

ws.onmessage = (event: MessageEvent) => {
  const msg = JSON.parse(String(event.data)) as { id?: number; result?: unknown };
  if (msg.id !== undefined) pending.get(msg.id)?.(msg.result);
};

ws.onopen = async () => {
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  await writeFile(out, Buffer.from(shot.data, "base64"));
  console.log(out);
  ws.close();
  process.exit(0);
};
