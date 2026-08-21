import type { CardPolicy, Cents } from "./types.js";

/**
 * La config que escribe todo el mundo primero, y que los proveedores aceptan
 * como válida. Interlace ofrece `transactionLimitsType: NA` —tarjeta sin límite
 * propio— como opción legítima; esto es apenas un paso mejor que eso.
 *
 * Es el grupo de control del benchmark, no una recomendación.
 */
export function permissivePolicy(perTransactionCents: Cents): CardPolicy {
  return {
    perTransactionCents,
    lifetimeCents: null,
    ttlSeconds: null,
    merchantAllowlist: null,
    mccAllowlist: null,
    allowedCurrencies: null,
    singleUse: false,
    maxCharges: null,
    grossSpendAccounting: false,
    closeOnTaskComplete: false,
  };
}

export interface SafeCardRequest {
  /** Presupuesto total de la tarea. Es el cap acumulado, y es obligatorio. */
  budgetCents: Cents;
  /** Merchant esperado. Obligatorio: allowlist por defecto, no blacklist. */
  merchant: string;
  /** Cap por transacción. Por defecto, todo el presupuesto en un solo cargo. */
  perTransactionCents?: Cents;
  /** Vida de la tarjeta. Por defecto 24 h. */
  ttlSeconds?: number;
  mcc?: string;
  currency?: string;
  singleUse?: boolean;
  maxCharges?: number;
}

/**
 * Los defaults del producto. La diferencia con un proveedor no es tener más
 * primitivas —tienen las mismas— sino que acá **no se puede** emitir una
 * tarjeta sin cap acumulado ni sin TTL. La opinión es el producto.
 */
export function safePolicy(req: SafeCardRequest): CardPolicy {
  if (req.budgetCents <= 0) {
    throw new Error("El presupuesto debe ser mayor a cero.");
  }
  if (req.merchant.trim() === "") {
    throw new Error(
      "Falta el merchant. La allowlist es obligatoria: una tarjeta que puede cobrar en cualquier lado no está limitada.",
    );
  }

  const perTransactionCents = req.perTransactionCents ?? req.budgetCents;
  if (perTransactionCents > req.budgetCents) {
    throw new Error(
      "El cap por transacción no puede superar el presupuesto total.",
    );
  }

  return {
    perTransactionCents,
    // Obligatorio. Es la única defensa contra structuring.
    lifetimeCents: req.budgetCents,
    // Obligatorio. Es la única defensa contra la suscripción zombie.
    ttlSeconds: req.ttlSeconds ?? 24 * 60 * 60,
    merchantAllowlist: [req.merchant],
    mccAllowlist: req.mcc !== undefined ? [req.mcc] : null,
    allowedCurrencies: [req.currency ?? "USD"],
    singleUse: req.singleUse ?? false,
    maxCharges: req.maxCharges ?? null,
    grossSpendAccounting: true,
    closeOnTaskComplete: true,
  };
}
