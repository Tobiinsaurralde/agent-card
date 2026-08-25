/**
 * Qué está mostrando el carrito ahora mismo.
 *
 * Reconocimiento puro: lee y no toca nada. Cuando el comprador dice "no llegué a
 * la pantalla de pago", la pregunta es qué vio, y adivinar desde el código del
 * merchant es más lento que preguntarle a la página.
 */
const target = process.argv[2];
if (target === undefined) {
  console.error("Uso: peek-cart.ts ws://…");
  process.exit(1);
}

const ws = new WebSocket(target);
let seq = 0;
const pending = new Map<number, (value: unknown) => void>();

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

/** Con `contacts`, abre "Domain Contacts" antes de mirar. Abrir un form no cobra. */
const openContacts = process.argv[3] === "contacts";

ws.onopen = async () => {
  if (openContacts) {
    const click = await send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        const label = (el) => (el.textContent || "").replace(/\\s+/g, " ").trim();
        const nodes = [...document.querySelectorAll("button, a")];
        const edit = nodes.find((el) => {
          if (!/^edit$/i.test(label(el))) return false;
          let p = el;
          for (let i = 0; i < 8 && p; i++) {
            if (/domain contacts|info required/i.test(p.innerText || "")) return true;
            p = p.parentElement;
          }
          return false;
        });
        if (!edit) return "no encontré el Edit de Domain Contacts";
        edit.click();
        return "clickeado";
      })()`,
    });
    console.error(`[contacts] ${click.result.value}`);
    await new Promise((r) => setTimeout(r, 6_000));
  }

  const { result } = await send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const clean = (s) => (s ?? "").replace(/\\s+/g, " ").trim();
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };

      const buttons = [...document.querySelectorAll("button, a[role=button], [type=submit]")]
        .filter(visible)
        .map((b) => ({
          text: clean(b.innerText || b.getAttribute("aria-label")),
          disabled: b.disabled === true || b.getAttribute("aria-disabled") === "true",
        }))
        .filter((b) => b.text !== "");

      const inputs = [...document.querySelectorAll("input, select, textarea")]
        .filter(visible)
        .map((i) => ({
          name: i.name || i.id || i.getAttribute("aria-label") || "(anónimo)",
          type: i.type ?? i.tagName.toLowerCase(),
          required: i.required === true,
          filled: clean(i.value) !== "",
        }));

      // Cualquier cosa que parezca un aviso o un error de validación.
      const notices = [...document.querySelectorAll("[class*=error i], [class*=alert i], [class*=warn i], [role=alert]")]
        .filter(visible)
        .map((n) => clean(n.innerText))
        .filter((t) => t !== "" && t.length < 200);

      const money = clean(document.body.innerText)
        .match(/(?:USD|\\$)\\s?[0-9]+[.,][0-9]{2}/g) ?? [];

      return {
        url: location.href,
        buttons,
        inputs,
        notices: [...new Set(notices)],
        money: [...new Set(money)],
        body: clean(document.body.innerText).slice(0, 1800),
      };
    })()`,
  });

  const data = result.value as Record<string, unknown>;
  console.log(JSON.stringify(data, null, 2));
  ws.close();
  process.exit(0);
};
