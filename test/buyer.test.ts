import assert from "node:assert/strict";
import { test } from "node:test";
import { buyerFromEnv, requireContact, usernameFrom, MissingBuyerFieldError } from "../src/buyer.js";

const BASE = {
  AGENT_CARD_TEST_EMAIL: "tinsaurralde17@gmail.com",
  AGENT_CARD_TEST_PASSWORD: "una-clave-larguita",
  AGENT_CARD_TEST_NAME: "T. Insaurralde",
} satisfies NodeJS.ProcessEnv;

/**
 * Porkbun pide alfanumérico de 3 a 20. Mandarle el mail hacía que el formulario
 * se rechazara sin mostrar ningún motivo, y desde afuera parecía un muro del
 * comercio en vez de un bug nuestro.
 */
test("el usuario sale del mail y respeta alfanumérico de 3 a 20", () => {
  assert.equal(usernameFrom("tinsaurralde17@gmail.com"), "tinsaurralde17");
  assert.equal(usernameFrom("t.obias+bot@x.com"), "tobiasbot");
  assert.match(usernameFrom("un.nombre.larguisimo.de.verdad@x.com"), /^[a-z0-9]{3,20}$/);
  assert.equal(usernameFrom("un.nombre.larguisimo.de.verdad@x.com").length, 20);
});

test("un mail casi sin letras igual da un usuario usable", () => {
  const user = usernameFrom("a.@x.com");
  assert.ok(user.length >= 3, `"${user}" es más corto de lo que acepta cualquier comercio`);
  assert.match(user, /^[a-z0-9]+$/);
});

test("se puede fijar el usuario a mano", () => {
  const buyer = buyerFromEnv({ ...BASE, AGENT_CARD_TEST_USERNAME: "konextech" });
  assert.equal(buyer.username, "konextech");
});

test("el nombre se parte en nombre y apellido", () => {
  const buyer = buyerFromEnv(BASE);
  assert.equal(buyer.firstName, "T.");
  assert.equal(buyer.lastName, "Insaurralde");
});

test("faltar datos de contacto es un error con la lista de lo que falta", () => {
  const buyer = buyerFromEnv(BASE);
  assert.throws(
    () => requireContact(buyer),
    (error: unknown) => {
      assert.ok(error instanceof MissingBuyerFieldError);
      assert.deepEqual(error.keys, [
        "AGENT_CARD_TEST_STREET",
        "AGENT_CARD_TEST_CITY",
        "AGENT_CARD_TEST_PHONE",
      ]);
      return true;
    },
  );
});
