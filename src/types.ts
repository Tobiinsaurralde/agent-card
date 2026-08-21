/**
 * Montos siempre en centavos de USD. Nunca floats para dinero.
 */
export type Cents = number;

export type AuthKind =
  /** Autorización inicial (hold). */
  | "auth"
  /** Captura de una autorización previa. Puede diferir del monto autorizado. */
  | "capture"
  /** Autorización incremental sobre un hold existente (cloud, hoteles). */
  | "incremental"
  /** Devolución del merchant. */
  | "refund";

export interface AuthAttempt {
  amountCents: Cents;
  /** ISO 4217. El cargo puede venir en otra moneda que la del cap. */
  currency: string;
  merchant: string;
  /** Merchant Category Code de 4 dígitos, si el rail lo informa. */
  mcc?: string;
  kind: AuthKind;
  at: Date;
  /** Tarea del agente que originó el intento. Base de los recibos. */
  taskId?: string;
}

export interface RecordedCharge extends AuthAttempt {
  allowed: boolean;
  code: DecisionCode;
}

export interface CardPolicy {
  /** Cap por transacción. `null` = sin cap. */
  perTransactionCents: Cents | null;
  /**
   * Cap acumulado sobre toda la vida de la tarjeta. `null` = sin cap.
   * Es la única defensa contra structuring: sin esto, N cargos por debajo
   * del cap por transacción suman lo que quieran.
   */
  lifetimeCents: Cents | null;
  /** Vida máxima de la tarjeta en segundos. `null` = no expira nunca. */
  ttlSeconds: number | null;
  /** Merchants permitidos. `null` = cualquiera. Allowlist, no blacklist. */
  merchantAllowlist: string[] | null;
  /** MCCs permitidos. `null` = cualquiera. */
  mccAllowlist: string[] | null;
  /** Monedas permitidas. `null` = cualquiera, y ahí el cap en USD no significa nada. */
  allowedCurrencies: string[] | null;
  /** La tarjeta muere después del primer cargo exitoso. */
  singleUse: boolean;
  /** Cantidad máxima de cargos aprobados. `null` = sin tope. */
  maxCharges: number | null;
  /**
   * `true` = contabilidad bruta: un refund no devuelve margen de gasto.
   * `false` = contabilidad neta, que permite el ciclo refund → volver a comprar.
   */
  grossSpendAccounting: boolean;
  /** Cerrar la tarjeta cuando la tarea que la originó se marca completada. */
  closeOnTaskComplete: boolean;
}

export interface CardState {
  openedAt: Date;
  closed: boolean;
  /** La tarea que originó la tarjeta terminó. */
  taskComplete: boolean;
  /** Kill switch global disparado. */
  killed: boolean;
  charges: RecordedCharge[];
}

export type DecisionCode =
  | "ALLOWED"
  | "CARD_CLOSED"
  | "KILL_SWITCH"
  | "TASK_COMPLETE"
  | "EXPIRED"
  | "PER_TX_EXCEEDED"
  | "LIFETIME_EXCEEDED"
  | "MERCHANT_NOT_ALLOWED"
  | "MCC_NOT_ALLOWED"
  | "CURRENCY_NOT_ALLOWED"
  | "SINGLE_USE_CONSUMED"
  | "MAX_CHARGES_REACHED";

export interface Decision {
  allow: boolean;
  code: DecisionCode;
  /** Explicación legible, para el recibo y para el mensaje de error al agente. */
  reason: string;
}
