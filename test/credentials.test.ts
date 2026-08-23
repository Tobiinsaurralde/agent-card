import assert from "node:assert/strict";
import { inspect } from "node:util";
import { test } from "node:test";
import { CardCredentials } from "../src/credentials.js";

const VISA = "4111111111111111";

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    AGENT_CARD_ALLOW_MANUAL_PAN: "1",
    AGENT_CARD_TEST_PAN: VISA,
    AGENT_CARD_TEST_CVC: "123",
    AGENT_CARD_TEST_EXP: "09/28",
    AGENT_CARD_TEST_NAME: "TOBIAS INSAURRALDE",
    ...extra,
  };
}

test("sin el gate explícito no se lee ninguna tarjeta", () => {
  assert.throws(
    () => CardCredentials.fromEnv(env({ AGENT_CARD_ALLOW_MANUAL_PAN: "" })),
    /AGENT_CARD_ALLOW_MANUAL_PAN=1/,
  );
});

test("un PAN mal tipeado se corta acá y no en el comercio", () => {
  // Importa el motivo: si el número inválido llegara al checkout, el comercio
  // diría "datos inválidos" y concluiríamos que la tarjeta no sirve.
  assert.throws(() => CardCredentials.fromEnv(env({ AGENT_CARD_TEST_PAN: "4111111111111112" })), /Luhn/);
});

test("acepta el PAN con espacios, como se copia de la app del banco", () => {
  const card = CardCredentials.fromEnv(env({ AGENT_CARD_TEST_PAN: "4111 1111 1111 1111" }));
  assert.equal(card.last4, "1111");
  assert.equal(card.reveal().pan, VISA);
});

test("entiende las formas en que se escribe un vencimiento", () => {
  const exp = (value: string) => {
    const { expMonth, expYear } = CardCredentials.fromEnv(
      env({ AGENT_CARD_TEST_EXP: value }),
    ).reveal();
    return `${expMonth}/${expYear}`;
  };

  assert.equal(exp("09/28"), "09/2028");
  assert.equal(exp("09/2028"), "09/2028");
  assert.equal(exp("09-2028"), "09/2028");
  assert.equal(exp("0928"), "09/2028");
  assert.equal(exp("092028"), "09/2028");
  // Un dígito, que es como queda al copiarlo a mano.
  assert.equal(exp("9/28"), "09/2028");
  assert.equal(exp("9/2028"), "09/2028");
});

test("un mes inexistente falla", () => {
  assert.throws(() => CardCredentials.fromEnv(env({ AGENT_CARD_TEST_EXP: "13/28" })), /no existe/);
});

test("un campo faltante dice cuál falta", () => {
  assert.throws(() => CardCredentials.fromEnv(env({ AGENT_CARD_TEST_CVC: "" })), /AGENT_CARD_TEST_CVC/);
});

test("reconoce la marca por el BIN", () => {
  assert.equal(CardCredentials.fromEnv(env()).brand, "visa");
  assert.equal(
    CardCredentials.fromEnv(env({ AGENT_CARD_TEST_PAN: "5555555555554444" })).brand,
    "mastercard",
  );
});

test("el PAN no aparece al loguear, serializar ni interpolar", () => {
  const card = CardCredentials.forTesting({
    pan: VISA,
    cvc: "123",
    expMonth: "09",
    expYear: "2028",
    name: "TOBIAS INSAURRALDE",
  });

  // Las tres formas en que un secreto se escapa sin que nadie lo quiera.
  assert.doesNotMatch(JSON.stringify(card), /4111/);
  assert.doesNotMatch(inspect(card), /4111/);
  assert.doesNotMatch(`${card}`, /4111/);

  // Y anidado, que es el caso real: un objeto de contexto que se loguea entero.
  assert.doesNotMatch(inspect({ intento: 1, tarjeta: card }), /4111/);
  assert.doesNotMatch(JSON.stringify({ intento: 1, tarjeta: card }), /4111/);

  // Los últimos cuatro sí: hacen falta para saber con qué tarjeta se probó.
  assert.match(`${card}`, /1111/);
});

test("redact saca el PAN de un texto, con y sin espacios", () => {
  const card = CardCredentials.forTesting({
    pan: VISA,
    cvc: "987",
    expMonth: "09",
    expYear: "2028",
    name: "TOBIAS INSAURRALDE",
  });

  const dump = card.redact(
    `Error al llenar: value="${VISA}" y también "4111 1111 1111 1111", cvc=987`,
  );
  assert.doesNotMatch(dump, /4111/);
  assert.doesNotMatch(dump, /987/);
  assert.match(dump, /«PAN ••1111»/);
  assert.match(dump, /«CVC»/);
});
