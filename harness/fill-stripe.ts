/**
 * Llena el formulario "Add credit/debit card" de Spaceship, cuyos campos viven
 * en iframes de Stripe Elements. El driver de Playwright no los veía.
 * No loguea el PAN ni el CVC.
 */
import { CardCredentials } from "../src/credentials.js";

interface Target {
  type?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

const card = CardCredentials.fromEnv();
const secret = card.reveal();

const tabs = (await fetch("http://127.0.0.1:9333/json").then((r) => r.json())) as Target[];

async function cdp(
  wsUrl: string,
  fn: (send: (method: string, params?: Record<string, unknown>) => Promise<unknown>) => Promise<void>,
): Promise<void> {
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((res, rej) => {
    ws.onopen = () => res();
    ws.onerror = () => rej(new Error("ws"));
  });
  let id = 0;
  const send = (method: string, params: Record<string, unknown> = {}): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      const onmsg = (ev: MessageEvent): void => {
        const msg = JSON.parse(String(ev.data)) as { id?: number; result?: unknown };
        if (msg.id === mid) {
          ws.removeEventListener("message", onmsg);
          resolve(msg.result);
        }
      };
      ws.addEventListener("message", onmsg);
      ws.send(JSON.stringify({ id: mid, method, params }));
      setTimeout(() => reject(new Error(`timeout ${method}`)), 15_000);
    });
  await send("Runtime.enable");
  await fn(send);
  ws.close();
}

async function typeInto(
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
  selector: string,
  value: string,
): Promise<boolean> {
  const found = (await send("Runtime.evaluate", {
    expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.focus(); el.click(); return true; })()`,
    returnByValue: true,
  })) as { result?: { value?: boolean } };
  if (found.result?.value !== true) return false;
  await send("Input.insertText", { text: value });
  return true;
}

let numberOk = false;
let expOk = false;
let cvcOk = false;

for (const t of tabs) {
  if (t.type !== "iframe" || t.webSocketDebuggerUrl === undefined) continue;
  if (!/elements-inner-card/.test(t.url ?? "")) continue;
  await cdp(t.webSocketDebuggerUrl, async (send) => {
    if (await typeInto(send, 'input[name="cardnumber"], input[autocomplete="cc-number"]', secret.pan)) {
      numberOk = true;
    }
    if (
      await typeInto(
        send,
        'input[name="exp-date"], input[autocomplete="cc-exp"]',
        `${secret.expMonth}/${secret.expYear.slice(-2)}`,
      )
    ) {
      expOk = true;
    }
    if (await typeInto(send, 'input[name="cvc"], input[autocomplete="cc-csc"]', secret.cvc)) {
      cvcOk = true;
    }
  });
}

const page = tabs.find((t) => t.type === "page" && /paymentmethod/.test(t.url ?? ""));
if (page?.webSocketDebuggerUrl !== undefined) {
  await cdp(page.webSocketDebuggerUrl, async (send) => {
    await send("Runtime.evaluate", {
      expression: `(() => {
        const name = document.querySelector('input[name="embossingName"], input[placeholder="John Doe"]');
        if (name) {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          setter?.call(name, ${JSON.stringify(secret.name)});
          name.dispatchEvent(new Event("input", { bubbles: true }));
          name.dispatchEvent(new Event("change", { bubbles: true }));
        }
        const addr = document.querySelector("select, [class*=address]");
        const opt = [...document.querySelectorAll("[role=option], li, button")].find((el) =>
          /gutierrez|corrientes|tobias/i.test(el.textContent || ""),
        );
        const open = document.querySelector('[class*="address"] [role=button], [class*="Billing"]');
        open?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        opt?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        return true;
      })()`,
      returnByValue: true,
    });
  });
}

console.log(
  `Stripe: número ${numberOk ? "ok" : "no"} · vencimiento ${expOk ? "ok" : "no"} · CVC ${cvcOk ? "ok" : "no"} · ${card.brand} ••${card.last4}`,
);
if (!numberOk || !expOk || !cvcOk) process.exitCode = 2;
