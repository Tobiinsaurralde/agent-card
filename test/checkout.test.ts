import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyOutcome,
  explain,
  isStructural,
  type PageEvidence,
} from "../src/checkout.js";

function page(url: string, text: string, title?: string): PageEvidence {
  return title === undefined ? { url, text } : { url, text, title };
}

test("una URL de confirmación alcanza para aprobar", () => {
  const outcome = classifyOutcome(
    page("https://porkbun.com/checkout/success?id=99", "Domain registered."),
  );
  assert.equal(outcome.kind, "aprobado");
  assert.equal(outcome.confidence, "alta");
});

test("el texto de gracias aprueba, pero con confianza media", () => {
  const outcome = classifyOutcome(
    page("https://shop.example/cart", "Thank you for your order! We sent a receipt."),
  );
  assert.equal(outcome.kind, "aprobado");
  assert.equal(outcome.confidence, "media");
  assert.match(explain(outcome), /evidencia es débil/);
});

test("una página ambigua es desconocida, nunca rechazada", () => {
  // El caso peligroso: si esto devolviera "rechazado", el agente reintentaría
  // un cobro que puede haber entrado.
  const outcome = classifyOutcome(page("https://shop.example/checkout", "Procesando..."));
  assert.equal(outcome.kind, "desconocido");
  assert.equal(isStructural(outcome), false);
  assert.match(explain(outcome), /no reintentes/i);
});

test("fondos insuficientes es nuestro problema, no estructural", () => {
  const outcome = classifyOutcome(
    page("https://shop.example/checkout", "Your card was declined: insufficient funds."),
  );
  assert.equal(outcome.kind, "rechazado");
  assert.equal(outcome.reason, "fondos_insuficientes");
  assert.equal(isStructural(outcome), false);
  assert.match(explain(outcome), /cargá más/i);
});

test("el AVS se lee como AVS y no como rechazo genérico", () => {
  // Es el orden de los patrones: la frase también contiene "was declined", y si
  // ganara el patrón genérico perderíamos justo el diagnóstico que buscamos.
  const outcome = classifyOutcome(
    page(
      "https://shop.example/checkout",
      "Your card was declined because the billing address does not match.",
    ),
  );
  assert.equal(outcome.reason, "domicilio_no_verificado");
  assert.equal(isStructural(outcome), true);
});

test("3DS no enrolada es rechazo estructural", () => {
  const outcome = classifyOutcome(
    page("https://shop.example/checkout", "This card is not enrolled in 3D Secure."),
  );
  assert.equal(outcome.kind, "rechazado");
  assert.equal(outcome.reason, "3ds_requerido");
  assert.equal(isStructural(outcome), true);
  assert.match(explain(outcome), /No reintentes/);
});

test("un desafío 3DS en curso no es un rechazo", () => {
  const outcome = classifyOutcome(
    page("https://acs.banco.com/challenge?tx=1", "Enter the code we sent to your phone."),
  );
  assert.equal(outcome.kind, "desafio_3ds");
  assert.equal(isStructural(outcome), false);
  assert.match(explain(outcome), /no es un rechazo/i);
});

test("un BIN prepago bloqueado es estructural", () => {
  const outcome = classifyOutcome(
    page("https://saas.example/billing", "Prepaid cards are not supported for subscriptions."),
  );
  assert.equal(outcome.reason, "bin_no_aceptado");
  assert.equal(isStructural(outcome), true);
});

test("do not honor se trata como estructural hasta probar lo contrario", () => {
  const outcome = classifyOutcome(
    page("https://shop.example/checkout", "Payment failed: do not honor (05)."),
  );
  assert.equal(outcome.reason, "rechazo_generico");
  assert.equal(isStructural(outcome), true);
});

test("un error de tipeo en la tarjeta no se confunde con la tarjeta", () => {
  const outcome = classifyOutcome(
    page("https://shop.example/checkout", "Invalid card number. Check your card details."),
  );
  assert.equal(outcome.reason, "datos_invalidos");
  assert.equal(isStructural(outcome), false);
});

test("un fallo sin motivo declarado se asume estructural", () => {
  const outcome = classifyOutcome(
    page("https://shop.example/checkout", "We could not process your payment."),
  );
  assert.equal(outcome.reason, "motivo_no_declarado");
  assert.equal(isStructural(outcome), true);
});

test("lee rechazos en castellano", () => {
  const rechazada = classifyOutcome(
    page("https://tienda.example/pago", "Tu tarjeta fue rechazada por el banco."),
  );
  assert.equal(rechazada.reason, "rechazo_generico");

  const saldo = classifyOutcome(
    page("https://tienda.example/pago", "Saldo insuficiente en la tarjeta."),
  );
  assert.equal(saldo.reason, "fondos_insuficientes");

  const exito = classifyOutcome(page("https://tienda.example/fin", "Compra exitosa. ¡Gracias!"));
  assert.equal(exito.kind, "aprobado");
});

test("el rechazo cita el fragmento que lo disparó", () => {
  const outcome = classifyOutcome(
    page("https://shop.example/checkout", "Order summary. Your card was declined. Try another."),
  );
  assert.match(outcome.evidence, /card was declined/i);
});

test("el título de la página también cuenta como evidencia", () => {
  const outcome = classifyOutcome(
    page("https://shop.example/x", "Volver al carrito", "Payment declined"),
  );
  assert.equal(outcome.kind, "rechazado");
});

test("una URL rota no rompe la clasificación", () => {
  const outcome = classifyOutcome(page("no-es-una-url", "Your card was declined."));
  assert.equal(outcome.kind, "rechazado");
});
