/**
 * Quién compra. El agente no puede inventar un titular: si el comercio pide
 * cuenta o WHOIS, estos datos tienen que venir configurados, igual que el
 * presupuesto. Pedírselos al humano en el checkout es hacer el checkout a mano.
 */

export interface BuyerIdentity {
  email: string;
  /**
   * Nombre de usuario para los comercios que piden cuenta. Casi ninguno acepta un
   * mail acá: Porkbun, por ejemplo, exige alfanumérico de 3 a 20, y mandarle el
   * mail hace que el formulario se rechace sin decir nada.
   */
  username: string;
  password: string;
  name: string;
  firstName: string;
  lastName: string;
  country: string;
  street: string | null;
  city: string | null;
  region: string | null;
  postal: string | null;
  phone: string | null;
}

export class MissingBuyerFieldError extends Error {
  constructor(readonly keys: string[]) {
    super(
      `El comercio pide datos del comprador que el agente no tiene: ${keys.join(", ")}. ` +
        "Van en .env, no se piden en el checkout.",
    );
    this.name = "MissingBuyerFieldError";
  }
}

export function buyerFromEnv(env: NodeJS.ProcessEnv = process.env): BuyerIdentity {
  const email = required(env, "AGENT_CARD_TEST_EMAIL");
  const password = required(env, "AGENT_CARD_TEST_PASSWORD");
  const name = required(env, "AGENT_CARD_TEST_NAME").trim();
  const parts = name.split(/\s+/).filter((p) => p !== "");
  const firstName = parts[0] ?? name;
  const lastName = parts.slice(1).join(" ") || firstName;

  return {
    email,
    username: emptyToNull(env.AGENT_CARD_TEST_USERNAME) ?? usernameFrom(email),
    password,
    name,
    firstName,
    lastName,
    country: env.AGENT_CARD_TEST_COUNTRY?.trim() || "AR",
    street: emptyToNull(env.AGENT_CARD_TEST_STREET),
    city: emptyToNull(env.AGENT_CARD_TEST_CITY),
    region: emptyToNull(env.AGENT_CARD_TEST_REGION),
    postal: emptyToNull(env.AGENT_CARD_TEST_POSTAL),
    phone: emptyToNull(env.AGENT_CARD_TEST_PHONE),
  };
}

export function requireContact(buyer: BuyerIdentity): void {
  const missing: string[] = [];
  if (buyer.street === null) missing.push("AGENT_CARD_TEST_STREET");
  if (buyer.city === null) missing.push("AGENT_CARD_TEST_CITY");
  if (buyer.phone === null) missing.push("AGENT_CARD_TEST_PHONE");
  if (missing.length > 0) throw new MissingBuyerFieldError(missing);
}

/**
 * Un usuario alfanumérico de 3 a 20 a partir del mail, que es el rango que piden
 * casi todos. Si queda corto, se rellena; los comercios rechazan menos de 3.
 */
export function usernameFrom(email: string): string {
  const local = email.split("@")[0] ?? email;
  const clean = local.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20);
  return clean.length >= 3 ? clean : `${clean}agent`.slice(0, 20);
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Falta ${key}. Es parte del perfil del agente, no del checkout.`);
  }
  return value.trim();
}

function emptyToNull(value: string | undefined): string | null {
  if (value === undefined || value.trim() === "") return null;
  return value.trim();
}
