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
    return deny("KILL_SWITCH", "Kill switch global activo.");
  }
  if (policy.closeOnTaskComplete && state.taskComplete) {
    return deny(
      "TASK_COMPLETE",
      "La tarea que originó la tarjeta ya terminó. Sin esto, una suscripción sigue renovando para siempre.",
    );
  }
  if (state.closed) {
    return deny("CARD_CLOSED", "La tarjeta está cerrada.");
  }
  if (policy.ttlSeconds !== null) {
    const ageSeconds = (attempt.at.getTime() - state.openedAt.getTime()) / 1000;
    if (ageSeconds > policy.ttlSeconds) {
      return deny(
        "EXPIRED",
        `La tarjeta expiró: ${Math.round(ageSeconds)}s de vida contra un TTL de ${policy.ttlSeconds}s.`,
      );
    }
  }

  // 2. Un refund entrante nunca se rechaza: es plata que vuelve.
  if (attempt.kind === "refund") {
    return { allow: true, code: "ALLOWED", reason: "Devolución del merchant." };
  }

  // 3. Alcance: quién puede cobrar y en qué moneda.
  if (policy.singleUse && approvedCount(state) >= 1) {
    return deny(
      "SINGLE_USE_CONSUMED",
      "Tarjeta de un solo uso, ya consumida. Si el PAN se filtró al contexto del agente, acá deja de servir.",
    );
  }
  if (policy.maxCharges !== null && approvedCount(state) >= policy.maxCharges) {
    return deny(
      "MAX_CHARGES_REACHED",
      `Se alcanzó el máximo de ${policy.maxCharges} cargos aprobados.`,
    );
  }
  if (
    policy.merchantAllowlist !== null &&
    !policy.merchantAllowlist.includes(attempt.merchant)
  ) {
    return deny(
      "MERCHANT_NOT_ALLOWED",
      `Merchant "${attempt.merchant}" fuera de la allowlist.`,
    );
  }
  if (policy.mccAllowlist !== null) {
    // Sin MCC informado no se puede validar la categoría. Se rechaza en vez de
    // asumir que está bien: un MCC ausente es el agujero del lock por categoría.
    if (attempt.mcc === undefined || !policy.mccAllowlist.includes(attempt.mcc)) {
      return deny(
        "MCC_NOT_ALLOWED",
        `MCC ${attempt.mcc ?? "ausente"} fuera de la allowlist.`,
      );
    }
  }
  if (
    policy.allowedCurrencies !== null &&
    !policy.allowedCurrencies.includes(attempt.currency)
  ) {
    return deny(
      "CURRENCY_NOT_ALLOWED",
      `Moneda ${attempt.currency} no permitida. Un cap en USD no limita un cargo en otra moneda.`,
    );
  }

  // 4. Montos: primero la transacción, después el acumulado.
  if (
    policy.perTransactionCents !== null &&
    attempt.amountCents > policy.perTransactionCents
  ) {
    return deny(
      "PER_TX_EXCEEDED",
      `${fmt(attempt.amountCents)} supera el cap por transacción de ${fmt(policy.perTransactionCents)}.`,
    );
  }
  if (policy.lifetimeCents !== null) {
    const after = committedCents(state, policy) + attempt.amountCents;
    if (after > policy.lifetimeCents) {
      return deny(
        "LIFETIME_EXCEEDED",
        `${fmt(after)} acumulados superarían el cap de ${fmt(policy.lifetimeCents)}.`,
      );
    }
  }

  return { allow: true, code: "ALLOWED", reason: "Dentro de la política." };
}

export function fmt(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}USD ${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
