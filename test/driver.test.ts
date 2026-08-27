import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { test } from "node:test";
import { findChrome, launchChrome } from "../harness/chrome.js";
import { CardCredentials } from "../src/credentials.js";
import { CheckoutDriver, FormNotFoundError } from "../src/driver.js";

/**
 * El driver contra un checkout falso, con un Chrome de verdad.
 *
 * Vale la pena el aparato: prueba el camino completo —conectar por CDP, encontrar
 * los campos dentro de un iframe como el de Stripe, llenar, enviar y leer el
 * veredicto— sin gastar un peso ni tocar un comercio real. Si esto no pasa, no
 * tiene sentido probar con una tarjeta de verdad.
 */

/**
 * Estos tests levantan un Chrome real, y en un runner compartido eso es
 * flaky por naturaleza: el mismo suite pasa y falla por timeout en commits
 * idénticos. El workflow de deploy los apaga con esta variable en vez de
 * confiar en la suerte; localmente corren siempre, que es donde el driver
 * de verdad se usa.
 */
function skipReason(): string | null {
  if (process.env["AGENT_CARD_SKIP_BROWSER_TESTS"] === "1") {
    return "tests de browser apagados por AGENT_CARD_SKIP_BROWSER_TESTS";
  }
  if (findChrome() === null) return "no hay Chrome en esta máquina";
  return null;
}

const CARD = CardCredentials.forTesting({
  pan: "4111111111111111",
  cvc: "123",
  expMonth: "09",
  expYear: "2028",
  name: "TOBIAS INSAURRALDE",
});

// El número que el comercio falso rechaza. Pasa Luhn: tiene que ser una tarjeta
// válida rechazada, no un número inválido.
const DECLINED = CardCredentials.forTesting({
  pan: "4000000000000002",
  cvc: "123",
  expMonth: "09",
  expYear: "2028",
  name: "TOBIAS INSAURRALDE",
});

test("el driver llena un checkout con iframe, envía y lee la aprobación", async (t) => {
  const reason = skipReason();
  if (reason !== null) return t.skip(reason);
  const { origin, stop } = await fakeCheckout();
  const chrome = await launchChrome();

  try {
    const report = await new CheckoutDriver().attempt({
      url: `${origin}/checkout`,
      card: CARD,
      connectUrl: chrome.cdpUrl,
      verdictTimeoutMs: 15_000,
    });

    // El número vive en un iframe: si esto pasa, la búsqueda cross-frame anda.
    assert.deepEqual(report.filled, ["número", "vencimiento", "CVC", "titular"]);
    assert.equal(report.outcome.kind, "aprobado");
    assert.equal(report.outcome.confidence, "alta");
    assert.match(report.finalUrl, /\/success/);
  } finally {
    await chrome.kill();
    await stop();
  }
});

test("el driver lee el rechazo del comercio y su motivo", async (t) => {
  const reason = skipReason();
  if (reason !== null) return t.skip(reason);
  const { origin, stop } = await fakeCheckout();
  const chrome = await launchChrome();

  try {
    const report = await new CheckoutDriver().attempt({
      url: `${origin}/checkout`,
      card: DECLINED,
      connectUrl: chrome.cdpUrl,
      verdictTimeoutMs: 15_000,
    });

    assert.equal(report.outcome.kind, "rechazado");
    assert.equal(report.outcome.reason, "rechazo_generico");
  } finally {
    await chrome.kill();
    await stop();
  }
});

test("si no hay formulario, falla con lo que vio y no envía nada", async (t) => {
  const reason = skipReason();
  if (reason !== null) return t.skip(reason);
  const { origin, stop } = await fakeCheckout();
  const chrome = await launchChrome();

  try {
    await assert.rejects(
      new CheckoutDriver().attempt({
        url: `${origin}/no-form`,
        card: CARD,
        connectUrl: chrome.cdpUrl,
        verdictTimeoutMs: 5_000,
      }),
      (error: unknown) => {
        assert.ok(error instanceof FormNotFoundError, `esperaba FormNotFoundError, vino ${error}`);
        // El mensaje tiene que servir para arreglar los selectores.
        assert.match(error.message, /número de tarjeta/);
        assert.match(error.message, /Campos que vi/);
        assert.doesNotMatch(error.message, /4111/);
        return true;
      },
    );
  } finally {
    await chrome.kill();
    await stop();
  }
});

/**
 * Un checkout que imita lo que rompe en la vida real: el número de tarjeta en un
 * iframe aparte, como Stripe Elements, y el resto en el frame principal.
 */
async function fakeCheckout(): Promise<{ origin: string; stop: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];

    if (path === "/card-frame") {
      return html(
        res,
        `<input autocomplete="cc-number" id="num" placeholder="Card number" />`,
      );
    }
    if (path === "/checkout") {
      return html(
        res,
        `<h1>Pagar</h1>
         <iframe id="frame" src="/card-frame" title="card"></iframe>
         <input autocomplete="cc-exp" placeholder="MM / YY" />
         <input autocomplete="cc-csc" placeholder="CVC" />
         <input autocomplete="cc-name" placeholder="Name on card" />
         <button type="submit" id="pay">Pay</button>
         <p id="msg"></p>
         <script>
           document.getElementById('pay').addEventListener('click', function () {
             var frame = document.getElementById('frame');
             var pan = frame.contentDocument.getElementById('num').value.replace(/\\D/g, '');
             // El comercio falso decide por el BIN, como uno real por el rango.
             if (pan.slice(-4) === '1111') { location.href = '/success'; }
             else { document.getElementById('msg').textContent = 'Your card was declined by the issuer.'; }
           });
         </script>`,
      );
    }
    if (path === "/success") {
      return html(res, `<h1>Thank you for your order</h1><p>Order #1234</p>`);
    }
    if (path === "/no-form") {
      return html(res, `<h1>Carrito vacío</h1><input name="cupon" placeholder="Cupón" />`);
    }
    res.writeHead(404).end("no");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("sin puerto");

  return {
    origin: `http://127.0.0.1:${address.port}`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function html(res: import("node:http").ServerResponse, body: string): void {
  res
    .writeHead(200, { "content-type": "text/html; charset=utf-8" })
    .end(`<!doctype html><meta charset="utf-8"><title>Checkout</title>${body}`);
}
