import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CreditCard,
  Moon,
  RotateCcw,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { permissivePolicy, safePolicy } from "../src/defaults.js";
import { fmt } from "../src/policy.js";
import type { ControlledCard } from "../src/card.js";
import type { AuthKind, CardPolicy } from "../src/types.js";
import {
  openCard,
  runStep,
  scenarioDefs,
  simulate,
  usdToCents,
  type LogRow,
  type ScenarioDef,
} from "./simulate.js";
import { Badge, Button, Checkbox, Field, Input, Panel, Select } from "./ui.js";

type Preset = "safe" | "permissive";

interface Config {
  budget: string;
  merchant: string;
  perTx: string;
  ttlHours: string;
  singleUse: boolean;
}

interface Attempt {
  amount: string;
  merchant: string;
  currency: string;
  kind: AuthKind;
  dayOffset: string;
}

interface Comparison {
  def: ScenarioDef;
  safeCents: number;
  permissiveCents: number;
}

const initialConfig: Config = {
  budget: "10",
  merchant: "api-credits",
  perTx: "10",
  ttlHours: "24",
  singleUse: false,
};

const initialAttempt: Attempt = {
  amount: "9",
  merchant: "api-credits",
  currency: "USD",
  kind: "capture",
  dayOffset: "0",
};

function useTheme() {
  const [dark, setDark] = useState<boolean>(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

export function App() {
  const { dark, toggle } = useTheme();
  const [preset, setPreset] = useState<Preset>("safe");
  const [config, setConfig] = useState<Config>(initialConfig);
  const [attempt, setAttempt] = useState<Attempt>(initialAttempt);
  const [card, setCard] = useState<ControlledCard | null>(null);
  const [rows, setRows] = useState<LogRow[]>([]);
  const [errors, setErrors] = useState<Partial<Record<keyof Config, string>>>({});
  const [attemptError, setAttemptError] = useState<string | undefined>(undefined);
  const [fatal, setFatal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [comparison, setComparison] = useState<Comparison | null>(null);

  const budgetRef = useRef<HTMLInputElement>(null);
  const merchantRef = useRef<HTMLInputElement>(null);
  const perTxRef = useRef<HTMLInputElement>(null);

  const approvedCents = useMemo(
    () =>
      rows
        .filter((r) => r.approved && r.kind !== "refund")
        .reduce((sum, r) => sum + r.amountCents, 0),
    [rows],
  );

  const capCents = card?.policy.lifetimeCents ?? null;
  const capUsage =
    capCents !== null && capCents > 0
      ? Math.min(100, Math.round((approvedCents / capCents) * 100))
      : null;

  function buildPolicy(): CardPolicy {
    const budgetCents = usdToCents(config.budget);
    const perTxCents =
      config.perTx.trim() === "" ? budgetCents : usdToCents(config.perTx);
    if (preset === "permissive") {
      return permissivePolicy(perTxCents ?? 0);
    }
    return safePolicy({
      budgetCents: budgetCents ?? 0,
      merchant: config.merchant.trim(),
      perTransactionCents: perTxCents ?? 0,
      ttlSeconds: Number(config.ttlHours) * 3600,
      singleUse: config.singleUse,
    });
  }

  async function handleIssue(event: FormEvent) {
    event.preventDefault();
    setAttemptError(undefined);
    setComparison(null);

    const budgetCents = usdToCents(config.budget);
    const perTxCents =
      config.perTx.trim() === "" ? budgetCents : usdToCents(config.perTx);
    const ttlHours = Number(config.ttlHours);
    const next: Partial<Record<keyof Config, string>> = {};

    if (budgetCents === null || budgetCents === 0) {
      next.budget = "Poné un monto mayor a cero. Por ejemplo: 10";
    }
    if (perTxCents === null) {
      next.perTx = "Monto inválido. Usá números, por ejemplo 9.50";
    } else if (budgetCents !== null && perTxCents > budgetCents) {
      next.perTx = "No puede superar el presupuesto total.";
    }
    if (preset === "safe") {
      if (config.merchant.trim() === "") {
        next.merchant =
          "Hace falta el merchant: sin allowlist la tarjeta cobra en cualquier lado.";
      }
      if (!Number.isFinite(ttlHours) || ttlHours <= 0) {
        next.ttlHours = "Poné una cantidad de horas mayor a cero.";
      }
    }

    setErrors(next);
    if (Object.keys(next).length > 0) {
      // El foco va al primer campo inválido para que no lo tenga que buscar.
      if (next.budget !== undefined) budgetRef.current?.focus();
      else if (next.perTx !== undefined) perTxRef.current?.focus();
      else if (next.merchant !== undefined) merchantRef.current?.focus();
      return;
    }

    setBusy(true);
    try {
      const policy = buildPolicy();
      const funded = (budgetCents ?? 0) * 5;
      const fresh = await openCard(policy, funded, new Date());
      setCard(fresh);
      setRows([]);
      setFatal(null);
      setAttempt((a) => ({ ...a, merchant: config.merchant.trim() || a.merchant }));
    } catch (error) {
      setFatal(error instanceof Error ? error.message : "Error desconocido.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAttempt(event: FormEvent) {
    event.preventDefault();
    if (card === null) return;

    const amountCents = usdToCents(attempt.amount);
    if (amountCents === null || amountCents === 0) {
      setAttemptError("Poné un monto mayor a cero. Por ejemplo: 9");
      return;
    }
    setAttemptError(undefined);

    setBusy(true);
    try {
      const row = await runStep(
        card,
        {
          amountCents,
          merchant: attempt.merchant.trim(),
          dayOffset: Number(attempt.dayOffset) || 0,
          currency: attempt.currency,
          kind: attempt.kind,
        },
        rows.length + 1,
      );
      setRows((prev) => [...prev, row]);
    } catch (error) {
      setFatal(error instanceof Error ? error.message : "Error desconocido.");
    } finally {
      setBusy(false);
    }
  }

  async function handleScenario(def: ScenarioDef) {
    setBusy(true);
    setErrors({});
    setAttemptError(undefined);
    try {
      const safe = safePolicy({
        budgetCents: def.budgetCents,
        merchant: def.merchant,
        perTransactionCents: def.perTransactionCents,
        ttlSeconds: def.ttlHours * 3600,
      });
      const permissive = permissivePolicy(def.perTransactionCents);
      const [safeSim, permissiveSim] = await Promise.all([
        simulate(safe, def.fundedCents, def.script),
        simulate(permissive, def.fundedCents, def.script),
      ]);

      setConfig({
        budget: (def.budgetCents / 100).toString(),
        merchant: def.merchant,
        perTx: (def.perTransactionCents / 100).toString(),
        ttlHours: def.ttlHours.toString(),
        singleUse: false,
      });
      setAttempt((a) => ({ ...a, merchant: def.merchant }));

      const live = preset === "safe" ? safeSim : permissiveSim;
      setCard(live.card);
      setRows(live.rows);
      setComparison({
        def,
        safeCents: safeSim.approvedCents,
        permissiveCents: permissiveSim.approvedCents,
      });
      setFatal(null);
    } catch (error) {
      setFatal(error instanceof Error ? error.message : "Error desconocido.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCompleteTask() {
    if (card === null) return;
    await card.completeTask();
    setRows((prev) => [...prev]);
  }

  async function handleKill() {
    if (card === null) return;
    await card.kill();
    setRows((prev) => [...prev]);
  }

  function handleReset() {
    setCard(null);
    setRows([]);
    setErrors({});
    setAttemptError(undefined);
    setComparison(null);
    setFatal(null);
    setConfig(initialConfig);
    setAttempt(initialAttempt);
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 md:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <CreditCard className="size-5 text-foreground" aria-hidden="true" />
            <span className="font-mono text-sm font-semibold">agent-card</span>
          </div>
          <button
            type="button"
            onClick={toggle}
            aria-label={dark ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
            className="inline-flex size-10 items-center justify-center rounded-md border border-border text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {dark ? (
              <Sun className="size-4" aria-hidden="true" />
            ) : (
              <Moon className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 md:px-6 md:py-12 lg:px-8">
        <div className="max-w-prose space-y-4">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
            Defaults seguros para tarjetas de agentes
          </h1>
          <p className="text-base text-muted-foreground">
            Un agente de IA llega al checkout y se traba en el pago. La solución
            es darle una tarjeta virtual propia — pero los límites que trae el
            proveedor tienen agujeros. Probá acá qué cobros pasan y cuáles no.
          </p>
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted p-3">
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0 text-foreground"
              aria-hidden="true"
            />
            <p className="text-xs text-foreground">
              Esto es una simulación. El emisor es un mock local: no hay tarjeta
              real y no se mueve un peso. Mide la política, no el rail.
            </p>
          </div>
        </div>

        {fatal !== null && (
          <div
            role="alert"
            className="mt-8 flex flex-col items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4"
          >
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-4" aria-hidden="true" />
              <p className="text-sm font-medium">No se pudo emitir la tarjeta</p>
            </div>
            <p className="text-xs text-muted-foreground">{fatal}</p>
            <Button variant="secondary" onClick={handleReset}>
              Empezar de nuevo
            </Button>
          </div>
        )}

        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-1">
            <Panel
              title="Configuración de la tarjeta"
              description="Elegí qué reglas se aplican antes de mandar el cobro al rail."
            >
              <fieldset className="mb-6">
                <legend className="mb-2 text-xs font-medium text-muted-foreground">
                  Perfil de política
                </legend>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant={preset === "safe" ? "primary" : "ghost"}
                    onClick={() => setPreset("safe")}
                    aria-pressed={preset === "safe"}
                  >
                    <ShieldCheck className="size-4" aria-hidden="true" />
                    Seguros
                  </Button>
                  <Button
                    variant={preset === "permissive" ? "primary" : "ghost"}
                    onClick={() => setPreset("permissive")}
                    aria-pressed={preset === "permissive"}
                  >
                    Permisiva
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {preset === "safe"
                    ? "Cap acumulado y TTL obligatorios, allowlist de merchant, cierre al terminar la tarea."
                    : "Solo cap por transacción. Es lo que escribe todo el mundo primero, y lo que el proveedor acepta como válido."}
                </p>
              </fieldset>

              <form onSubmit={handleIssue} className="space-y-4">
                <Field
                  id="budget"
                  label="Presupuesto total (USD)"
                  required
                  hint="El techo acumulado de la tarea."
                  error={errors.budget}
                >
                  <Input
                    id="budget"
                    ref={budgetRef}
                    inputMode="decimal"
                    value={config.budget}
                    placeholder="10"
                    spellCheck={false}
                    aria-invalid={errors.budget !== undefined ? "true" : undefined}
                    aria-describedby={
                      errors.budget !== undefined ? "budget-error" : "budget-hint"
                    }
                    onChange={(e) =>
                      setConfig((c) => ({ ...c, budget: e.target.value }))
                    }
                  />
                </Field>

                <Field
                  id="perTx"
                  label="Cap por transacción (USD)"
                  hint="Vacío = todo el presupuesto en un solo cargo."
                  error={errors.perTx}
                >
                  <Input
                    id="perTx"
                    ref={perTxRef}
                    inputMode="decimal"
                    value={config.perTx}
                    placeholder="10"
                    spellCheck={false}
                    aria-invalid={errors.perTx !== undefined ? "true" : undefined}
                    aria-describedby={
                      errors.perTx !== undefined ? "perTx-error" : "perTx-hint"
                    }
                    onChange={(e) =>
                      setConfig((c) => ({ ...c, perTx: e.target.value }))
                    }
                  />
                </Field>

                <Field
                  id="merchant"
                  label="Merchant permitido"
                  required={preset === "safe"}
                  hint={
                    preset === "safe"
                      ? "Allowlist, no blacklist."
                      : "Ignorado: la config permisiva no filtra merchant."
                  }
                  error={errors.merchant}
                >
                  <Input
                    id="merchant"
                    ref={merchantRef}
                    value={config.merchant}
                    placeholder="api-credits"
                    spellCheck={false}
                    aria-invalid={
                      errors.merchant !== undefined ? "true" : undefined
                    }
                    aria-describedby={
                      errors.merchant !== undefined
                        ? "merchant-error"
                        : "merchant-hint"
                    }
                    onChange={(e) =>
                      setConfig((c) => ({ ...c, merchant: e.target.value }))
                    }
                  />
                </Field>

                <Field
                  id="ttlHours"
                  label="Vida de la tarjeta (horas)"
                  required={preset === "safe"}
                  hint={
                    preset === "safe"
                      ? "Pasado el TTL se rechaza todo."
                      : "Ignorado: la config permisiva no expira."
                  }
                  error={errors.ttlHours}
                >
                  <Input
                    id="ttlHours"
                    inputMode="numeric"
                    value={config.ttlHours}
                    placeholder="24"
                    spellCheck={false}
                    aria-invalid={
                      errors.ttlHours !== undefined ? "true" : undefined
                    }
                    aria-describedby={
                      errors.ttlHours !== undefined
                        ? "ttlHours-error"
                        : "ttlHours-hint"
                    }
                    onChange={(e) =>
                      setConfig((c) => ({ ...c, ttlHours: e.target.value }))
                    }
                  />
                </Field>

                <Checkbox
                  id="singleUse"
                  label="Un solo uso"
                  hint="La tarjeta muere después del primer cobro aprobado."
                  checked={config.singleUse}
                  onChange={(next) =>
                    setConfig((c) => ({ ...c, singleUse: next }))
                  }
                />

                <div className="flex flex-col gap-2 pt-2 sm:flex-row">
                  <Button type="submit" disabled={busy} aria-busy={busy}>
                    <CreditCard className="size-4" aria-hidden="true" />
                    {card === null ? "Emitir la tarjeta" : "Emitir una nueva"}
                  </Button>
                  <Button variant="ghost" onClick={handleReset} disabled={busy}>
                    <RotateCcw className="size-4" aria-hidden="true" />
                    Reiniciar
                  </Button>
                </div>
              </form>
            </Panel>
          </div>

          <div className="space-y-6 lg:col-span-2">
            <Panel
              title="Escenarios"
              description="Los dos agujeros que importan, corridos con las dos configuraciones."
            >
              <div className="grid gap-3 sm:grid-cols-2">
                {scenarioDefs.map((def) => (
                  <div
                    key={def.id}
                    className="flex flex-col gap-3 rounded-md border border-border p-3"
                  >
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">
                        {def.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {def.hypothesis}
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      onClick={() => handleScenario(def)}
                      disabled={busy}
                      className="mt-auto"
                    >
                      Correr
                    </Button>
                  </div>
                ))}
              </div>

              {comparison !== null && (
                <div className="mt-4 space-y-2 rounded-md border border-border bg-muted p-3">
                  <p className="text-xs font-medium text-foreground">
                    {comparison.def.name} · techo pretendido{" "}
                    {fmt(comparison.def.intendedCapCents)}
                  </p>
                  <dl className="grid gap-2 sm:grid-cols-2">
                    <div className="flex items-baseline justify-between gap-2 rounded border border-border bg-background px-3 py-2">
                      <dt className="text-xs text-muted-foreground">
                        Config permisiva
                      </dt>
                      <dd className="font-mono text-sm font-semibold text-destructive">
                        {fmt(comparison.permissiveCents)}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-2 rounded border border-border bg-background px-3 py-2">
                      <dt className="text-xs text-muted-foreground">
                        Defaults seguros
                      </dt>
                      <dd className="font-mono text-sm font-semibold text-success">
                        {fmt(comparison.safeCents)}
                      </dd>
                    </div>
                  </dl>
                </div>
              )}
            </Panel>

            {card === null ? (
              <Panel title="Cobros" description="Todavía no hay tarjeta emitida.">
                <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                  <CreditCard
                    className="size-10 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">
                      Emití una tarjeta para empezar
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Elegí un perfil de política a la izquierda, o corré uno de
                      los escenarios de arriba.
                    </p>
                  </div>
                </div>
              </Panel>
            ) : (
              <>
                <Panel
                  title="Estado de la tarjeta"
                  description={`Perfil ${preset === "safe" ? "seguro" : "permisivo"}.`}
                >
                  <div className="space-y-4">
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="text-xs text-muted-foreground">
                        Aprobado
                      </span>
                      <span className="font-mono text-2xl font-semibold text-foreground">
                        {fmt(approvedCents)}
                      </span>
                    </div>
                    {capCents !== null ? (
                      <div className="space-y-1.5">
                        <div
                          role="progressbar"
                          aria-valuenow={capUsage ?? 0}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label="Consumo del cap acumulado"
                          className="h-2 w-full overflow-hidden rounded-full bg-muted"
                        >
                          <div
                            className="h-full rounded-full bg-primary transition-[width] duration-300"
                            style={{ width: `${capUsage ?? 0}%` }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Cap acumulado {fmt(capCents)}
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs font-medium text-destructive">
                        Sin cap acumulado. El gasto total no tiene techo.
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="ghost"
                        onClick={handleCompleteTask}
                        disabled={busy || card.state.taskComplete}
                      >
                        {card.state.taskComplete
                          ? "Tarea terminada"
                          : "Marcar tarea terminada"}
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={handleKill}
                        disabled={busy || card.state.killed}
                      >
                        <Ban className="size-4" aria-hidden="true" />
                        Kill switch
                      </Button>
                    </div>
                  </div>
                </Panel>

                <Panel
                  title="Intentar un cobro"
                  description="Cambiá el merchant, la moneda o los días para probar cada regla."
                >
                  <form onSubmit={handleAttempt} className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field
                        id="amount"
                        label="Monto (USD)"
                        required
                        error={attemptError}
                      >
                        <Input
                          id="amount"
                          inputMode="decimal"
                          value={attempt.amount}
                          placeholder="9"
                          spellCheck={false}
                          aria-invalid={
                            attemptError !== undefined ? "true" : undefined
                          }
                          aria-describedby={
                            attemptError !== undefined ? "amount-error" : undefined
                          }
                          onChange={(e) =>
                            setAttempt((a) => ({ ...a, amount: e.target.value }))
                          }
                        />
                      </Field>
                      <Field id="attemptMerchant" label="Merchant">
                        <Input
                          id="attemptMerchant"
                          value={attempt.merchant}
                          placeholder="api-credits"
                          spellCheck={false}
                          onChange={(e) =>
                            setAttempt((a) => ({ ...a, merchant: e.target.value }))
                          }
                        />
                      </Field>
                      <Field id="currency" label="Moneda">
                        <Select
                          id="currency"
                          value={attempt.currency}
                          onChange={(e) =>
                            setAttempt((a) => ({ ...a, currency: e.target.value }))
                          }
                        >
                          <option value="USD">USD</option>
                          <option value="EUR">EUR</option>
                          <option value="ARS">ARS</option>
                        </Select>
                      </Field>
                      <Field id="kind" label="Tipo">
                        <Select
                          id="kind"
                          value={attempt.kind}
                          onChange={(e) =>
                            setAttempt((a) => ({
                              ...a,
                              kind: e.target.value as AuthKind,
                            }))
                          }
                        >
                          <option value="capture">Captura</option>
                          <option value="auth">Autorización</option>
                          <option value="incremental">Incremental</option>
                          <option value="refund">Devolución</option>
                        </Select>
                      </Field>
                      <Field
                        id="dayOffset"
                        label="Días desde la emisión"
                        hint="Para probar el TTL sin esperar."
                      >
                        <Input
                          id="dayOffset"
                          inputMode="numeric"
                          value={attempt.dayOffset}
                          placeholder="0"
                          spellCheck={false}
                          aria-describedby="dayOffset-hint"
                          onChange={(e) =>
                            setAttempt((a) => ({
                              ...a,
                              dayOffset: e.target.value,
                            }))
                          }
                        />
                      </Field>
                    </div>
                    <Button type="submit" disabled={busy} aria-busy={busy}>
                      Intentar cobro
                    </Button>
                  </form>
                </Panel>

                <Panel
                  title="Historial"
                  description="Cada intento con el motivo exacto de la decisión."
                >
                  {rows.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                      <p className="text-sm font-medium text-foreground">
                        Todavía no hubo intentos
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Probá un cobro de USD 9 y después otro igual.
                      </p>
                    </div>
                  ) : (
                    <ol className="space-y-2">
                      {rows.map((row) => (
                        <li
                          key={`${row.n}-${row.code}`}
                          className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-md border border-border p-3"
                        >
                          <span className="font-mono text-xs text-muted-foreground">
                            {row.n}
                          </span>
                          <span className="font-mono text-sm font-medium text-foreground">
                            {fmt(row.amountCents)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {row.merchant} · {row.currency} · día {row.dayOffset}
                          </span>
                          <span className="ml-auto flex items-center gap-2">
                            {row.approved ? (
                              <CheckCircle2
                                className="size-4 text-success"
                                aria-hidden="true"
                              />
                            ) : (
                              <Ban
                                className="size-4 text-destructive"
                                aria-hidden="true"
                              />
                            )}
                            <Badge tone={row.approved ? "success" : "destructive"}>
                              {row.approved ? "Aprobado" : "Rechazado"}
                            </Badge>
                          </span>
                          <p className="w-full text-xs text-muted-foreground">
                            <span className="font-mono">{row.code}</span> —{" "}
                            {row.reason}
                          </p>
                        </li>
                      ))}
                    </ol>
                  )}
                </Panel>
              </>
            )}
          </div>
        </div>

        <footer className="mt-12 border-t border-border pt-6">
          <p className="max-w-prose text-xs text-muted-foreground">
            La emisión, el BIN, el banco y el KYC se compran a un proveedor. Esta
            capa solo decide si el cobro sale. El PAN nunca pasa por nuestro
            backend.
          </p>
        </footer>
      </main>
    </div>
  );
}
