import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Ban,
  CheckCircle2,
  CreditCard,
  FlaskConical,
  Moon,
  Play,
  RotateCcw,
  ShieldCheck,
  Sun,
  Zap,
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
import { Button, Checkbox, Chip, Field, Input, Panel, Segmented, Select, cx } from "./ui.js";
import { VirtualCard, type CardVisualStatus } from "./components/VirtualCard.js";
import { Ledger } from "./components/Ledger.js";

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

interface Verdict {
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
  const [dark, setDark] = useState(false);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

function randomLast4(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function App() {
  const { dark, toggle } = useTheme();
  const [preset, setPreset] = useState<Preset>("safe");
  const [config, setConfig] = useState<Config>(initialConfig);
  const [attempt, setAttempt] = useState<Attempt>(initialAttempt);
  const [card, setCard] = useState<ControlledCard | null>(null);
  const [issuedPreset, setIssuedPreset] = useState<Preset>("safe");
  const [last4, setLast4] = useState<string>("0000");
  const [rows, setRows] = useState<LogRow[]>([]);
  const [errors, setErrors] = useState<Partial<Record<keyof Config, string>>>({});
  const [attemptError, setAttemptError] = useState<string | undefined>(undefined);
  const [fatal, setFatal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verdicts, setVerdicts] = useState<Partial<Record<string, Verdict>>>({});
  const [liveMessage, setLiveMessage] = useState("");

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
  const approvedCount = rows.filter((r) => r.approved).length;
  const rejectedCount = rows.length - approvedCount;

  const capCents = card?.policy.lifetimeCents ?? null;
  const capPct =
    capCents !== null && capCents > 0
      ? Math.min(100, Math.round((approvedCents / capCents) * 100))
      : null;
  const availableCents =
    capCents !== null ? Math.max(0, capCents - approvedCents) : null;

  const cardStatus: CardVisualStatus =
    card === null
      ? "activa"
      : card.state.killed
        ? "kill"
        : card.state.closed || card.state.taskComplete
          ? "cerrada"
          : "activa";

  const ttlLabel =
    card?.policy.ttlSeconds != null
      ? `${Math.round(card.policy.ttlSeconds / 3600)} H`
      : "NO TTL";

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
      setIssuedPreset(preset);
      setLast4(randomLast4());
      setRows([]);
      setFatal(null);
      setAttempt((a) => ({ ...a, merchant: config.merchant.trim() || a.merchant }));
      setLiveMessage("Tarjeta emitida.");
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
      setLiveMessage(
        row.approved
          ? `Cobro de ${fmt(row.amountCents)} en ${row.merchant} aprobado.`
          : `Cobro de ${fmt(row.amountCents)} en ${row.merchant} rechazado: ${row.code}.`,
      );
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
      setIssuedPreset(preset);
      setLast4(randomLast4());
      setRows(live.rows);
      setVerdicts((prev) => ({
        ...prev,
        [def.id]: {
          safeCents: safeSim.approvedCents,
          permissiveCents: permissiveSim.approvedCents,
        },
      }));
      setFatal(null);
      setLiveMessage(
        `Escenario ${def.name}: la config permisiva aprobó ${fmt(permissiveSim.approvedCents)}, los defaults seguros ${fmt(safeSim.approvedCents)}.`,
      );
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
    setLiveMessage("Tarea marcada como terminada. La tarjeta quedó cerrada.");
  }

  async function handleKill() {
    if (card === null) return;
    await card.kill();
    setRows((prev) => [...prev]);
    setLiveMessage("Kill switch activado. Todo cobro futuro se rechaza.");
  }

  function handleReset() {
    setCard(null);
    setRows([]);
    setErrors({});
    setAttemptError(undefined);
    setVerdicts({});
    setFatal(null);
    setConfig(initialConfig);
    setAttempt(initialAttempt);
    setLiveMessage("");
  }

  const quickFills: Array<{ label: string; patch: Partial<Attempt> }> = [
    { label: "Otro merchant", patch: { merchant: "casino-online" } },
    { label: "Moneda EUR", patch: { currency: "EUR" } },
    { label: "30 días después", patch: { dayOffset: "30" } },
  ];

  return (
    <div className="landing relative min-h-screen overflow-x-hidden">
      <div aria-hidden="true" className="landing-grain" />
      <div aria-hidden="true" className="orb orb-blue animate-orb -right-20 -top-16 size-[22rem]" />
      <div
        aria-hidden="true"
        className="orb orb-gold animate-orb-delayed -bottom-32 -left-16 size-[18rem]"
      />

      {/* Los lectores de pantalla anuncian cada decisión sin mover el foco. */}
      <p role="status" aria-live="polite" className="sr-only">
        {liveMessage}
      </p>

      <div aria-hidden="true" className="brand-bar h-1.5 w-full" />

      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 md:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <a
              href="/"
              aria-label="Volver a la página principal"
              className="flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <img
                src="/logo-light.png"
                alt=""
                className="size-9 shrink-0 rounded-lg border border-border shadow-sm"
              />
              <span className="font-display text-base font-bold tracking-tight">
                agent-card
              </span>
            </a>
            <Chip tone="warning" dot={false}>
              <FlaskConical className="size-3" aria-hidden="true" />
              <span className="hidden sm:inline">SIMULACIÓN · SIN DINERO REAL</span>
              <span className="sm:hidden">SIMULACIÓN</span>
            </Chip>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <a
              href="/panel.html"
              className="hidden rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-[background-color,color] duration-100 ease-out hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:inline-flex"
            >
              Panel
            </a>
            <button
              type="button"
              onClick={toggle}
              aria-label={dark ? "Cambiar a pergamino" : "Cambiar a navy"}
              className="inline-flex size-10 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-[background-color,color] duration-100 ease-out hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {dark ? (
                <Sun className="size-4" aria-hidden="true" />
              ) : (
                <Moon className="size-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-6xl px-4 py-8 md:px-6 md:py-10">
        <div className="max-w-2xl">
          <p className="font-mono text-xs font-semibold tracking-[0.22em] text-gold">
            POLICY SIMULATOR
          </p>
          <h1 className="font-display mt-3 text-3xl font-extrabold leading-[1.05] text-foreground md:text-5xl">
            La tarjeta que sabe decir que{" "}
            <span className="text-gradient-brand">no.</span>
          </h1>
          <span
            aria-hidden="true"
            className="mt-4 block h-1 w-16 rounded-full bg-gradient-to-r from-accent to-gold"
          />
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground md:text-base">
            Defaults seguros para agentes de IA que compran solos. Configurá la
            política, intentá cobros y mirá exactamente qué se rechaza y por qué.
            El emisor es un mock local: esto mide la política, no el rail.
          </p>
        </div>

        {fatal !== null && (
          <div
            role="alert"
            className="mt-6 flex flex-col items-start gap-3 rounded-xl border border-destructive/35 bg-destructive-soft p-4"
          >
            <p className="text-sm font-medium text-destructive">
              No se pudo emitir la tarjeta
            </p>
            <p className="text-xs text-muted-foreground">{fatal}</p>
            <Button variant="outline" onClick={handleReset}>
              Empezar de nuevo
            </Button>
          </div>
        )}

        <div className="mt-8 grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
          {/* ─── Riel izquierdo: el objeto y su política ─── */}
          <div className="space-y-5">
            <VirtualCard
              issued={card !== null}
              last4={last4}
              status={cardStatus}
              ttlLabel={ttlLabel}
              presetLabel={issuedPreset === "safe" ? "SAFE" : "PERMISSIVE"}
              className="card-glow"
            />

            {card !== null && (
              <div className="space-y-4 rounded-2xl border border-border bg-card p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xs font-medium text-muted-foreground">
                    Comprometido
                  </span>
                  <span className="num text-xl font-semibold text-foreground">
                    {fmt(approvedCents)}
                  </span>
                </div>
                {capCents !== null ? (
                  <div className="space-y-1.5">
                    <div
                      role="progressbar"
                      aria-valuenow={capPct ?? 0}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label="Consumo del cap acumulado"
                      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                    >
                      <div
                        className={cx(
                          "h-full w-full origin-left rounded-full transition-transform duration-300 ease-out",
                          (capPct ?? 0) >= 100
                            ? "bg-destructive"
                            : (capPct ?? 0) >= 80
                              ? "bg-warning"
                              : "bg-accent",
                        )}
                        style={{ transform: `scaleX(${(capPct ?? 0) / 100})` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>
                        Disponible{" "}
                        <span className="num font-medium text-foreground">
                          {fmt(availableCents ?? 0)}
                        </span>
                      </span>
                      <span className="num">cap {fmt(capCents)}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs font-medium text-destructive">
                    Sin cap acumulado: el gasto total no tiene techo.
                  </p>
                )}
                <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCompleteTask}
                    disabled={busy || card.state.taskComplete}
                  >
                    <CheckCircle2 className="size-3.5" aria-hidden="true" />
                    {card.state.taskComplete ? "Tarea terminada" : "Terminar tarea"}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={handleKill}
                    disabled={busy || card.state.killed}
                  >
                    <Ban className="size-3.5" aria-hidden="true" />
                    Kill switch
                  </Button>
                </div>
              </div>
            )}

            <Panel
              title="Política"
              description="Las reglas que se evalúan antes de que el cobro llegue al rail."
            >
              <div className="mb-5 space-y-2">
                <Segmented
                  label="Perfil de política"
                  value={preset}
                  onChange={setPreset}
                  options={[
                    {
                      value: "safe",
                      label: (
                        <>
                          <ShieldCheck className="size-3.5" aria-hidden="true" />
                          Segura
                        </>
                      ),
                    },
                    {
                      value: "permissive",
                      label: (
                        <>
                          <Zap className="size-3.5" aria-hidden="true" />
                          Permisiva
                        </>
                      ),
                    },
                  ]}
                />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {preset === "safe"
                    ? "Cap acumulado y TTL obligatorios, allowlist de merchant, cierre al terminar la tarea."
                    : "Solo cap por transacción. Es lo que escribe todo el mundo primero — y lo que el proveedor acepta como válido."}
                </p>
              </div>

              <form onSubmit={handleIssue} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    id="budget"
                    label="Presupuesto (USD)"
                    required
                    error={errors.budget}
                  >
                    <Input
                      id="budget"
                      ref={budgetRef}
                      inputMode="decimal"
                      value={config.budget}
                      placeholder="10"
                      spellCheck={false}
                      className="num"
                      aria-invalid={errors.budget !== undefined ? "true" : undefined}
                      aria-describedby={
                        errors.budget !== undefined ? "budget-error" : undefined
                      }
                      onChange={(e) =>
                        setConfig((c) => ({ ...c, budget: e.target.value }))
                      }
                    />
                  </Field>
                  <Field id="perTx" label="Cap por cobro (USD)" error={errors.perTx}>
                    <Input
                      id="perTx"
                      ref={perTxRef}
                      inputMode="decimal"
                      value={config.perTx}
                      placeholder="10"
                      spellCheck={false}
                      className="num"
                      aria-invalid={errors.perTx !== undefined ? "true" : undefined}
                      aria-describedby={
                        errors.perTx !== undefined ? "perTx-error" : undefined
                      }
                      onChange={(e) =>
                        setConfig((c) => ({ ...c, perTx: e.target.value }))
                      }
                    />
                  </Field>
                </div>

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
                    aria-invalid={errors.merchant !== undefined ? "true" : undefined}
                    aria-describedby={
                      errors.merchant !== undefined ? "merchant-error" : "merchant-hint"
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
                    className="num"
                    aria-invalid={errors.ttlHours !== undefined ? "true" : undefined}
                    aria-describedby={
                      errors.ttlHours !== undefined ? "ttlHours-error" : "ttlHours-hint"
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
                  onChange={(next) => setConfig((c) => ({ ...c, singleUse: next }))}
                />

                <div className="flex gap-2 pt-1">
                  <Button type="submit" disabled={busy} aria-busy={busy} className="flex-1">
                    <CreditCard className="size-4" aria-hidden="true" />
                    {card === null ? "Emitir tarjeta" : "Emitir una nueva"}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={handleReset}
                    disabled={busy}
                    aria-label="Reiniciar todo"
                  >
                    <RotateCcw className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </form>
            </Panel>

            <p className="px-1 text-xs leading-relaxed text-muted-foreground">
              La emisión, el BIN, el banco y el KYC se compran a un proveedor. Esta
              capa solo decide si el cobro sale. El PAN nunca pasa por nuestro backend.
            </p>
          </div>

          {/* ─── Columna principal: actividad ─── */}
          <div className="space-y-5">
            {card !== null && (
              <dl className="grid grid-cols-2 divide-x-0 divide-y divide-border overflow-hidden rounded-2xl bg-primary text-primary-foreground sm:grid-cols-4 sm:divide-x sm:divide-y-0">
                <StatCell label="Intentos" value={String(rows.length)} />
                <StatCell label="Aprobados" value={String(approvedCount)} tone="success" />
                <StatCell label="Rechazados" value={String(rejectedCount)} tone="destructive" />
                <StatCell
                  label="Disponible"
                  value={availableCents !== null ? fmt(availableCents) : "Sin techo"}
                  tone={availableCents === 0 ? "warning" : undefined}
                />
              </dl>
            )}

            <Panel
              title="Ataques conocidos"
              description="Los dos agujeros que importan, corridos contra ambas configuraciones a la vez."
            >
              <div className="grid gap-3 md:grid-cols-2">
                {scenarioDefs.map((def) => {
                  const verdict = verdicts[def.id];
                  return (
                    <article
                      key={def.id}
                      className="flex flex-col gap-3 rounded-xl border border-border bg-background/50 p-3.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-semibold text-foreground">
                          {def.name}
                        </h3>
                        <span className="num shrink-0 text-xs text-muted-foreground">
                          techo {fmt(def.intendedCapCents)}
                        </span>
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {def.hypothesis}
                      </p>

                      {verdict !== undefined && (
                        <dl className="animate-row-in space-y-1.5 rounded-md bg-muted/60 p-2.5">
                          <VerdictRow
                            label="Permisiva"
                            cents={verdict.permissiveCents}
                            capCents={def.intendedCapCents}
                          />
                          <VerdictRow
                            label="Segura"
                            cents={verdict.safeCents}
                            capCents={def.intendedCapCents}
                          />
                        </dl>
                      )}

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleScenario(def)}
                        disabled={busy}
                        className="mt-auto"
                      >
                        <Play className="size-3.5" aria-hidden="true" />
                        {verdict === undefined ? "Correr ataque" : "Correr de nuevo"}
                      </Button>
                    </article>
                  );
                })}
              </div>
            </Panel>

            {card === null ? (
              <Panel title="Terminal de cobros" description="Todavía no hay tarjeta emitida.">
                <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                  <span className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                    <CreditCard className="size-5" aria-hidden="true" />
                  </span>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">
                      Emití una tarjeta para empezar
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Elegí un perfil de política a la izquierda, o corré uno de los
                      ataques de arriba: emiten y cobran solos.
                    </p>
                  </div>
                </div>
              </Panel>
            ) : (
              <>
                <Panel
                  title="Terminal de cobros"
                  description="Cambiá el merchant, la moneda o los días para gatillar cada regla."
                >
                  <form onSubmit={handleAttempt} className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <Field id="amount" label="Monto (USD)" required error={attemptError}>
                        <Input
                          id="amount"
                          inputMode="decimal"
                          value={attempt.amount}
                          placeholder="9"
                          spellCheck={false}
                          className="num"
                          aria-invalid={attemptError !== undefined ? "true" : undefined}
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
                          className="num"
                          aria-describedby="dayOffset-hint"
                          onChange={(e) =>
                            setAttempt((a) => ({ ...a, dayOffset: e.target.value }))
                          }
                        />
                      </Field>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button type="submit" disabled={busy} aria-busy={busy}>
                        Intentar cobro
                      </Button>
                      <span className="text-xs text-muted-foreground" aria-hidden="true">
                        o probá:
                      </span>
                      {quickFills.map((quick) => (
                        <Button
                          key={quick.label}
                          variant="ghost"
                          size="sm"
                          onClick={() => setAttempt((a) => ({ ...a, ...quick.patch }))}
                        >
                          {quick.label}
                        </Button>
                      ))}
                    </div>
                  </form>
                </Panel>

                <Panel
                  title="Libro mayor"
                  description="Cada intento con el motivo exacto de la decisión. Lo más nuevo arriba."
                >
                  <Ledger rows={rows} />
                </Panel>
              </>
            )}
          </div>
        </div>

        <footer className="mt-12 border-t border-border pt-5">
          <p className="text-xs text-muted-foreground">
            agent-card — capa de control con defaults seguros.
          </p>
        </footer>
      </main>
      <div aria-hidden="true" className="brand-bar h-1.5 w-full" />
    </div>
  );
}

function StatCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "destructive" | "warning" | undefined;
}) {
  return (
    <div className="px-4 py-3">
      <dt className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-primary-foreground/70">
        {label}
      </dt>
      <dd
        className={cx(
          "num mt-0.5 text-lg font-bold",
          tone === "success" && "text-success",
          tone === "destructive" && "text-destructive",
          tone === "warning" && "text-warning",
          tone === undefined && "text-primary-foreground",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function VerdictRow({
  label,
  cents,
  capCents,
}: {
  label: string;
  cents: number;
  capCents: number;
}) {
  const exceeded = cents > capCents;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="flex items-baseline gap-2">
        <span className="num text-xs font-semibold text-foreground">{fmt(cents)}</span>
        <Chip tone={exceeded ? "destructive" : "success"}>
          {exceeded ? "VULNERABLE" : "CONTUVO"}
        </Chip>
      </dd>
    </div>
  );
}
