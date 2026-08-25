/**
 * Lo mínimo de Chrome DevTools Protocol que necesitamos, en un solo lugar.
 *
 * Existe porque Playwright no ve adentro de los iframes de Stripe, y porque los
 * modales de Spaceship ignoran los clicks sintéticos: hay que mandar eventos de
 * mouse de verdad. Los cuatro scripts del harness repetían este mismo boilerplate.
 */

export interface Target {
  id?: string;
  type?: string;
  title?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

export interface Point {
  x: number;
  y: number;
}

export interface Cdp {
  send(method: string, params?: Record<string, unknown>): Promise<any>;
  /** Evalúa una expresión y devuelve el valor por copia. */
  evaluate<T = unknown>(expression: string): Promise<T>;
  /**
   * Click con el mouse de verdad. `element.click()` no alcanza en las pantallas
   * de Spaceship: el modal escucha eventos de puntero y un click sintético lo
   * deja abierto sin decir nada, que es el peor modo de fallar.
   */
  clickAt(point: Point): Promise<void>;
  /** Centro de lo que matchee el selector, o `null` si no está visible. */
  centerOf(selectorJs: string): Promise<Point | null>;
  /** Qué elemento hay realmente bajo ese punto, como texto corto. */
  elementAt(point: Point): Promise<string>;
  close(): void;
}

/** Las pestañas e iframes que expone el navegador. */
export async function targets(base: string): Promise<Target[]> {
  const response = await fetch(`${base}/json`);
  if (!response.ok) {
    throw new Error(
      `El navegador no contestó en ${base} (HTTP ${response.status}). ` +
        "Revisá que Chrome esté abierto con --remote-debugging-port.",
    );
  }
  return (await response.json()) as Target[];
}

export async function attach(wsUrl: string): Promise<Cdp> {
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error(`no pude conectarme a ${wsUrl}`));
  });

  let seq = 0;

  const send = (method: string, params: Record<string, unknown> = {}): Promise<any> =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => {
        ws.removeEventListener("message", onMessage);
        reject(new Error(`timeout en ${method}`));
      }, 20_000);

      const onMessage = (event: MessageEvent): void => {
        const msg = JSON.parse(String(event.data)) as {
          id?: number;
          result?: unknown;
          error?: { message?: string };
        };
        if (msg.id !== id) return;
        clearTimeout(timer);
        ws.removeEventListener("message", onMessage);
        if (msg.error !== undefined) {
          reject(new Error(`${method}: ${msg.error.message ?? "error del protocolo"}`));
          return;
        }
        resolve(msg.result);
      };

      ws.addEventListener("message", onMessage);
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send("Runtime.enable");

  const evaluate = async <T,>(expression: string): Promise<T> => {
    const out = await send("Runtime.evaluate", { expression, returnByValue: true });
    if (out.exceptionDetails !== undefined) {
      throw new Error(`la página tiró: ${out.exceptionDetails.text ?? "excepción"}`);
    }
    return out.result?.value as T;
  };

  return {
    send,
    evaluate,

    async clickAt(point: Point): Promise<void> {
      const common = { x: point.x, y: point.y, button: "left", clickCount: 1 };
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...common });
      await send("Input.dispatchMouseEvent", { type: "mousePressed", ...common });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...common });
    },

    async centerOf(selectorJs: string): Promise<Point | null> {
      // El elemento tiene que tener área. Hay botones duplicados en el DOM con
      // rect (0,0): clickearlos no hace nada y parece que la página ignora todo.
      return evaluate<Point | null>(`(() => {
        const el = ${selectorJs};
        if (!el) return null;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return null;
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })()`);
    },

    async elementAt(point: Point): Promise<string> {
      return evaluate<string>(`(() => {
        const el = document.elementFromPoint(${point.x}, ${point.y});
        if (!el) return "(nada)";
        const clean = (s) => (s ?? "").replace(/\\s+/g, " ").trim();
        // Subir hasta el botón o link que lo contiene: el punto suele caer en un
        // <span> de adentro, y lo que importa es qué se va a accionar.
        let node = el;
        for (let i = 0; i < 4 && node.parentElement; i += 1) {
          if (["BUTTON", "A"].includes(node.tagName) || node.getAttribute("role") === "button") break;
          node = node.parentElement;
        }
        return node.tagName.toLowerCase() + ":" + clean(node.innerText).slice(0, 40);
      })()`);
    },

    close(): void {
      ws.close();
    },
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Helpers que se inyectan en la página. Se pegan al principio de cada expresión. */
export const PAGE_HELPERS = `
  const clean = (s) => (s ?? "").replace(/\\s+/g, " ").trim();
  const shown = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const byText = (selector, re) =>
    [...document.querySelectorAll(selector)].filter(shown).find((el) => re.test(clean(el.innerText)));
`;
