/**
 * El combo de "Registrant" del modal de Domain Contacts.
 *
 * Spaceship no pide tipear la dirección: pide elegir una guardada. Es la razón
 * por la que el comprador no encontraba nada que llenar — buscaba
 * `input[name="firstName"]` en una pantalla que solo tiene un combobox.
 *
 * Con `--pick <texto>` elige la opción que contenga ese texto y aplica. Sin eso,
 * solo lista lo que hay: nunca conviene elegir a ciegas en una pantalla que
 * tiene un "Pay now" a dos pulgadas.
 */
const target = process.argv[2];
const pickAt = process.argv.indexOf("--pick");
const pick = pickAt === -1 ? null : process.argv[pickAt + 1] ?? null;
const apply = process.argv.includes("--apply");

if (target === undefined) {
  console.error("Uso: pick-registrant.ts ws://… [--pick <texto>] [--apply]");
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

async function evaluate(expression: string): Promise<unknown> {
  const { result } = await send("Runtime.evaluate", { returnByValue: true, expression });
  return result.value;
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

ws.onmessage = (event: MessageEvent) => {
  const msg = JSON.parse(String(event.data)) as { id?: number; result?: unknown };
  if (msg.id !== undefined) pending.get(msg.id)?.(msg.result);
};

/** Solo confirmar lo ya elegido, sin volver a abrir el combo. */
const applyOnly = process.argv.includes("--apply-only");

/**
 * Click con el mouse de verdad, por coordenadas.
 *
 * `element.click()` no alcanza acá: el modal escucha eventos de puntero y un
 * click sintético lo deja abierto sin decir nada, que es el peor modo de fallar.
 */
async function clickAt(rect: { x: number; y: number }): Promise<void> {
  const common = { x: rect.x, y: rect.y, button: "left", clickCount: 1 };
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...common });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...common });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...common });
}

async function clickApply(): Promise<void> {
  const rect = (await evaluate(`(() => {
    const clean = (s) => (s ?? "").replace(/\\s+/g, " ").trim();
    // Solo "Apply", y solo el que se ve. Hay otro Apply escondido en el DOM con
    // rect (0,0): clickearlo no hace nada y parece que el modal se ignora.
    // Nada que diga "pay" se toca desde acá.
    const btn = [...document.querySelectorAll("button")].find((b) => {
      if (!/^apply$/i.test(clean(b.innerText)) || b.disabled) return false;
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`)) as { x: number; y: number } | null;

  if (rect === null) {
    console.log("aplicar: no hay Apply habilitado");
    return;
  }

  await clickAt(rect);
  console.log(`aplicar: click en (${Math.round(rect.x)}, ${Math.round(rect.y)})`);
  await wait(5_000);
  console.log(
    "estado:",
    await evaluate(`(() => {
      const t = (document.body.innerText || "").replace(/\\s+/g, " ");
      return /info required/i.test(t) ? "SIGUE pidiendo datos" : "ya no pide datos";
    })()`),
  );
}

ws.onopen = async () => {
  if (applyOnly) {
    await clickApply();
    ws.close();
    process.exit(0);
  }

  // Cerrar lo que hubiera abierto. El selector de pago del checkout vive en la
  // misma pantalla, y confundirlo con este combo fue el error de la vuelta
  // anterior.
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", windowsVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", windowsVirtualKeyCode: 27 });
  await wait(1_500);

  // El combo de Registrant, scopeado al modal de "Domain contacts". Buscar un
  // `[role=combobox]` en toda la página agarra el de la tarjeta, que está a dos
  // pulgadas de un "Pay now".
  console.log(
    "abrir combo:",
    await evaluate(`(() => {
      const dialog = [...document.querySelectorAll('[role=dialog], [class*=modal i], [class*=drawer i]')]
        .find((d) => /domain contacts/i.test(d.innerText || ""));
      if (!dialog) return "no encontré el modal de Domain contacts";
      // El control es un div[role=button] con clase gb-select__anchor. No es un
      // <select> ni un role=combobox, que es por lo que no aparecía.
      const combo = dialog.querySelector(".gb-select__anchor, [role=button][tabindex]");
      if (!combo) return "el modal no tiene combo";
      combo.scrollIntoView({ block: "center" });
      combo.click();
      return "abierto";
    })()`),
  );
  await wait(2_500);

  const options = (await evaluate(`(() => {
    const clean = (s) => (s ?? "").replace(/\\s+/g, " ").trim();
    const seen = new Set();
    const out = [];
    for (const el of document.querySelectorAll('[role=option], [role=listbox] li, [class*=option i]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const text = clean(el.innerText);
      if (text === "" || seen.has(text)) continue;
      seen.add(text);
      out.push(text);
    }
    return out;
  })()`)) as string[];

  console.log("opciones:", JSON.stringify(options, null, 1));

  if (pick === null) {
    ws.close();
    process.exit(0);
  }

  console.log(
    "elegir:",
    await evaluate(`(() => {
      const clean = (s) => (s ?? "").replace(/\\s+/g, " ").trim();
      const wanted = ${JSON.stringify(pick)}.toLowerCase();
      const opts = [...document.querySelectorAll('[role=option], [role=listbox] li, [class*=option i]')]
        .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      const hit = opts.find((el) => clean(el.innerText).toLowerCase().includes(wanted));
      if (!hit) return "no encontré la opción";
      hit.click();
      return "elegida: " + clean(hit.innerText);
    })()`),
  );
  await wait(2_500);

  if (apply) {
    console.log(
      "aplicar:",
      await evaluate(`(() => {
        const clean = (s) => (s ?? "").replace(/\\s+/g, " ").trim();
        // Solo "Apply". Nada que diga "pay" se toca desde acá.
        const btn = [...document.querySelectorAll("button")].find(
          (b) => /^apply$/i.test(clean(b.innerText)) && !b.disabled,
        );
        if (!btn) return "no hay Apply habilitado";
        btn.click();
        return "aplicado";
      })()`),
    );
    await wait(4_000);
    console.log(
      "estado:",
      await evaluate(`(() => {
        const t = (document.body.innerText || "").replace(/\\s+/g, " ");
        return /info required/i.test(t) ? "SIGUE pidiendo datos" : "ya no pide datos";
      })()`),
    );
  }

  ws.close();
  process.exit(0);
};
