import type {
  AuthAttempt,
  CardPolicy,
  CardState,
  Cents,
  Decision,
} from "./types.js";

/**
 * Suma comprometida por la tarjeta.
 *
 * Cada intento aprobado que no sea refund cuenta a su monto nominal. Eso
 * sobrecuenta el par auth→capture, porque son un solo evento económico y acá
 * suman dos veces. Es deliberado: en un control de gasto, sobrecontar es el
 * lado seguro del error. Un rail que matchea capturas contra su autorización
 * requiere el id del hold, y todavía no lo tenemos del proveedor.
 */
export function committedCents(state: CardState, policy: CardPolicy): Cents {
  let total = 0;
  for (const charge of state.charges) {
    if (!charge.allowed) continue;
    if (charge.kind === "refund") {
      // Contabilidad bruta: la devolución no libera margen. Sin esto, el ciclo
      // comprar → devolver → volver a comprar gasta por encima del cap.
      if (!policy.grossSpendAccounting) total -= charge.amountCents;
      continue;
    }
    total += charge.amountCents;
  }
  return total;
}

function approvedCount(state: CardState): number {
  return state.charges.filter((c) => c.allowed && c.kind !== "refund").length;
}

function deny(code: Decision["code"], reason: string): Decision {
  return { allow: false, code, reason };
}

/**
 * Decide si un intento de autorización se permite. `DENY` siempre gana: en
 * cuanto una regla rechaza, se corta.
 *
 * Se evalúa server-side, nunca dentro del prompt: un agente no puede negociar
 * su propio límite.
 */
export function evaluate(
  attempt: AuthAttempt,
  state: CardState,
  policy: CardPolicy,
): Decision {
  // 1. Cortes duros: estado de la tarjeta antes que cualquier monto.
  //
  // El orden va de la causa más específica a la más genérica. `completeTask()`
  // cierra la tarjeta, así que si `CARD_CLOSED` fuera primero taparía el motivo
  // real y el recibo diría "cerrada" en vez de "la tarea terminó".
  if (state.killed) {
    return deny("KILL_SWITCH", "Global kill switch is on.");
  }
  if (policy.closeOnTaskComplete && state.taskComplete) {
    return deny(
      "TASK_COMPLETE",
      "The task that scoped this card is done. Without this, a subscription keeps renewing forever.",
    );
  }
  if (state.closed) {
    return deny("CARD_CLOSED", "The card is closed.");
  }
  if (policy.ttlSeconds !== null) {
    const ageSeconds = (attempt.at.getTime() - state.openedAt.getTime()) / 1000;
    if (ageSeconds > policy.ttlSeconds) {
      return deny(
        "EXPIRED",
        `The card expired: ${Math.round(ageSeconds)}s of life against a TTL of ${policy.ttlSeconds}s.`,
      );
    }
  }

  // 2. Un refund entrante nunca se rechaza: es plata que vuelve.
  if (attempt.kind === "refund") {
    return { allow: true, code: "ALLOWED", reason: "Merchant refund." };
  }

  // 3. Alcance: quién puede cobrar y en qué moneda.
  if (policy.singleUse && approvedCount(state) >= 1) {
    return deny(
      "SINGLE_USE_CONSUMED",
      "Single-use card, already spent. If the PAN leaked into the agent context, it stops working here.",
    );
  }
  if (policy.maxCharges !== null && approvedCount(state) >= policy.maxCharges) {
    return deny(
      "MAX_CHARGES_REACHED",
      `Reached the maximum of ${policy.maxCharges} approved charges.`,
    );
  }
  if (
    policy.merchantAllowlist !== null &&
    !policy.merchantAllowlist.includes(attempt.merchant)
  ) {
    return deny(
      "MERCHANT_NOT_ALLOWED",
      `Merchant "${attempt.merchant}" is not on the allowlist.`,
    );
  }
  if (policy.mccAllowlist !== null) {
    // Sin MCC informado no se puede validar la categoría. Se rechaza en vez de
    // asumir que está bien: un MCC ausente es el agujero del lock por categoría.
    if (attempt.mcc === undefined || !policy.mccAllowlist.includes(attempt.mcc)) {
      return deny(
        "MCC_NOT_ALLOWED",
        `MCC ${attempt.mcc ?? "missing"} is not on the allowlist.`,
      );
    }
  }
  if (
    policy.allowedCurrencies !== null &&
    !policy.allowedCurrencies.includes(attempt.currency)
  ) {
    return deny(
      "CURRENCY_NOT_ALLOWED",
      `Currency ${attempt.currency} is not allowed. A USD cap does not limit a charge in another currency.`,
    );
  }

  // 4. Montos: primero la transacción, después el acumulado.
  if (
    policy.perTransactionCents !== null &&
    attempt.amountCents > policy.perTransactionCents
  ) {
    return deny(
      "PER_TX_EXCEEDED",
      `${fmt(attempt.amountCents)} exceeds the per-transaction cap of ${fmt(policy.perTransactionCents)}.`,
    );
  }
  if (policy.lifetimeCents !== null) {
    const after = committedCents(state, policy) + attempt.amountCents;
    if (after > policy.lifetimeCents) {
      return deny(
        "LIFETIME_EXCEEDED",
        `${fmt(after)} accumulated would exceed the cap of ${fmt(policy.lifetimeCents)}.`,
      );
    }
  }

  return { allow: true, code: "ALLOWED", reason: "Inside the policy." };
}

export function fmt(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}USD ${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
