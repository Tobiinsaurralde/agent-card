import { useEffect, useReducer, useState } from "react";
import {
  Ban,
  Bot,
  Check,
  CreditCard,
  FlaskConical,
  Lock,
  Moon,
  Plus,
  Power,
  Receipt,
  ShieldCheck,
  Sun,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import {
  PanelStore,
  seed,
  usd,
  usdToCents,
  type CardRow,
  type ReceiptRow,
  type Treasury,
} from "./store.js";
import { VirtualCard } from "../components/VirtualCard.js";
import {
  Button,
  Checkbox,
  Chip,
  Field,
  Input,
  Panel as Card,
  Select,
  cx,
  focusRing,
} from "../ui.js";

function useTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

export function PanelApp() {
  const { dark, toggle } = useTheme();
  const [store] = useState(() => new PanelStore());
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [ready, setReady] = useState(false);
  const [live, setLive] = useState("");

  useEffect(() => {
    let active = true;
    void seed(store).then(() => {
      if (!active) return;
      setReady(true);
      bump();
    });
    return () => {
      active = false;
    };
  }, [store]);

  const treasury = store.treasury();
  const cards = store.cards();
  const agents = store.agentRows();
  const receipts = store.receiptRows();

  async function run(action: () => Promise<string>): Promise<void> {
    const message = await action();
    setLive(message);
    bump();
  }

  return (
    <div className="relative min-h-screen overflow-x-clip">
      <p role="status" aria-live="polite" className="sr-only">
        {live}
      </p>

      <header className="sticky top-3 z-40 px-3 md:top-4">
        <div className="shadow-soft mx-auto flex max-w-6xl items-center justify-between gap-3 rounded-full border border-border bg-card/95 py-2 pl-3 pr-2 backdrop-blur-md">
          <div className="flex min-w-0 items-center gap-2.5">
            <a
              href="index.html"
              aria-label="Volver a la página principal"
              className={cx("flex items-center gap-2.5 rounded-full", focusRing)}
            >
              <img
                src="logo-light.png"
                alt=""
                className="size-8 shrink-0 rounded-full border border-border"
              />
              <span className="font-display text-xl leading-none">Konex</span>
            </a>
            <Chip tone="warning" dot={false}>
              <FlaskConical className="size-3" aria-hidden="true" />
              <span className="hidden sm:inline">DEMO · SIN DINERO REAL</span>
              <span className="sm:hidden">DEMO</span>
            </Chip>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <a
              href="simulador.html"
              className={cx(
                "hidden rounded-full px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground sm:inline-flex",
                focusRing,
              )}
            >
              Simulador
            </a>
            <button
              type="button"
              onClick={toggle}
              aria-label={dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
              className={cx(
                "inline-flex size-10 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground",
                focusRing,
              )}
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
            PANEL DE CONTROL
          </p>
          <h1 className="font-display mt-3 text-4xl leading-[1.02] md:text-5xl">
            Tus agentes y <span className="display-accent">su plata.</span>
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Emitís tarjetas con topes obligatorios, mirás cada cobro con su motivo y
            cortás todo con un botón. El emisor es un mock local: las decisiones son
            reales, la plata no.
          </p>
        </div>

        {!ready && (
          <p className="mt-8 text-sm text-muted-foreground">Cargando el panel…</p>
        )}

        {ready && (
          <>
            <TreasuryStrip
              treasury={treasury}
              killed={store.killed}
              onKill={() =>
                run(async () => {
                  const n = await store.killAll();
                  return `Kill switch activado. ${n} tarjetas cerradas.`;
                })
              }
              onRelease={() =>
                run(async () => {
                  store.releaseKill();
                  return "Kill switch desactivado.";
                })
              }
              onDeposit={(cents) =>
                run(async () => {
                  store.deposit(cents);
                  return `Depositaste ${usd(cents)}.`;
                })
              }
            />

            <div className="mt-6 grid gap-5 lg:grid-cols-12">
              <div className="space-y-5 lg:col-span-5">
                <IssueForm store={store} onDone={run} />
                <AgentsPanel agents={agents} />
              </div>

              <div className="space-y-5 lg:col-span-7">
                <CardsPanel store={store} cards={cards} onDone={run} />
              </div>
            </div>

            <ReceiptsPanel receipts={receipts} />
          </>
        )}

        <footer className="mt-12 border-t border-border pt-5">
          <p className="text-xs text-muted-foreground">
            Konex — capa de control con defaults seguros. No emitimos tarjetas:
            la emisión la provee un tercero y esta capa va delante.
          </p>
        </footer>
      </main>
    </div>
  );
}

function TreasuryStrip({
  treasury,
  killed,
  onKill,
  onRelease,
  onDeposit,
}: {
  treasury: Treasury;
  killed: boolean;
  onKill: () => void;
  onRelease: () => void;
  onDeposit: (cents: number) => void;
}) {
  const [amount, setAmount] = useState("25.00");
  const cents = usdToCents(amount);

  return (
    <section className="shadow-soft mt-8 overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-5">
        <div className="flex items-center gap-2">
          <Wallet className="size-4 text-gold" aria-hidden="true" />
          <h2 className="font-display text-lg">Presupuesto · simulado</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="deposit" className="sr-only">
            Monto a depositar
          </label>
          <Input
            id="deposit"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            // max-w en vez de w: el componente ya trae w-full y no se puede pisar.
            className="num max-w-24"
            aria-invalid={cents === null}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={cents === null || cents === 0}
            onClick={() => cents !== null && onDeposit(cents)}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Depositar
          </Button>
          {killed ? (
            <Button variant="outline" size="sm" onClick={onRelease}>
              <Check className="size-3.5" aria-hidden="true" />
              Desactivar kill
            </Button>
          ) : (
            <Button variant="danger" size="sm" onClick={onKill}>
              <Power className="size-3.5" aria-hidden="true" />
              Kill switch
            </Button>
          )}
        </div>
      </div>

      {killed && (
        <p className="flex items-center gap-2 border-b border-border bg-destructive-soft px-4 py-2.5 text-xs font-semibold text-destructive md:px-5">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
          Kill switch activo: todas las tarjetas están muertas y no se puede emitir.
        </p>
      )}

      <dl className="grid grid-cols-2 divide-border sm:grid-cols-4 sm:divide-x">
        <Stat label="Depositado" value={usd(treasury.depositedCents)} />
        <Stat label="Gastado" value={usd(treasury.spentCents)} />
        <Stat
          label="Comprometido"
          value={usd(treasury.committedCents)}
          hint="Presupuesto de tarjetas vivas sin gastar"
        />
        <Stat
          label="Disponible"
          value={usd(treasury.availableCents)}
          tone={treasury.availableCents <= 0 ? "warning" : "gold"}
        />
      </dl>
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "gold" | "warning";
}) {
  return (
    <div className="border-t border-border px-4 py-4 first:border-t-0 sm:border-t-0 md:px-5">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd
        className={cx(
          "num mt-1 text-xl font-semibold",
          tone === "gold" && "text-gold",
          tone === "warning" && "text-warning",
        )}
      >
        {value}
      </dd>
      {hint !== undefined && (
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

const MERCHANTS = ["api-credits", "saas-x", "cloud-host", "domains-co"];

function IssueForm({
  store,
  onDone,
}: {
  store: PanelStore;
  onDone: (action: () => Promise<string>) => Promise<void>;
}) {
  const [agentId, setAgentId] = useState(store.agents[0]?.id ?? "");
  const [merchant, setMerchant] = useState(MERCHANTS[0] ?? "");
  const [budget, setBudget] = useState("10.00");
  const [perTx, setPerTx] = useState("10.00");
  const [ttlHours, setTtlHours] = useState("24");
  const [singleUse, setSingleUse] = useState(false);
  const [task, setTask] = useState("task-103");
  const [error, setError] = useState<string | undefined>(undefined);

  const budgetCents = usdToCents(budget);
  const perTxCents = usdToCents(perTx);
  const blocker = budgetCents !== null ? store.issueBlocker(budgetCents) : null;

  async function submit(): Promise<void> {
    if (budgetCents === null || budgetCents === 0) {
      setError("Poné un presupuesto válido.");
      return;
    }
    if (perTxCents === null || perTxCents === 0) {
      setError("Poné un cap por transacción válido.");
      return;
    }
    if (perTxCents > budgetCents) {
      setError("El cap por transacción no puede superar el presupuesto.");
      return;
    }
    if (blocker !== null) {
      setError(blocker);
      return;
    }
    setError(undefined);
    await onDone(async () => {
      const row = await store.issue({
        agentId,
        merchant,
        budgetCents,
        perTransactionCents: perTxCents,
        ttlHours: Number(ttlHours),
        singleUse,
        taskId: task.trim() === "" ? "sin-tarea" : task.trim(),
      });
      return `Tarjeta ••${row.last4} emitida para ${row.agentName} por ${usd(row.budgetCents)}.`;
    });
  }

  return (
    <Card
      title="Emitir tarjeta"
      description="Los topes no son opcionales. Esa es la diferencia con pedirla directo al emisor."
    >
      <div className="space-y-4">
        <Field id="agent" label="Agente" required>
          <Select
            id="agent"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
          >
            {store.agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name} — {agent.purpose}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          id="merchant"
          label="Comercio"
          required
          hint="Allowlist, no blacklist: la tarjeta solo cobra acá."
        >
          <Select
            id="merchant"
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
          >
            {MERCHANTS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="budget" label="Presupuesto total" required>
            <Input
              id="budget"
              inputMode="decimal"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              className="num"
              aria-invalid={budgetCents === null}
            />
          </Field>
          <Field id="pertx" label="Cap por cobro" required>
            <Input
              id="pertx"
              inputMode="decimal"
              value={perTx}
              onChange={(e) => setPerTx(e.target.value)}
              className="num"
              aria-invalid={perTxCents === null}
            />
          </Field>
        </div>

        <Field id="ttl" label="Vive por">
          <Select
            id="ttl"
            value={ttlHours}
            onChange={(e) => setTtlHours(e.target.value)}
          >
            <option value="1">1 hora</option>
            <option value="24">24 horas</option>
            <option value="72">3 días</option>
            <option value="168">7 días</option>
          </Select>
        </Field>

        <Field id="task" label="Tarea que la origina" hint="Va en cada recibo.">
          <Input id="task" value={task} onChange={(e) => setTask(e.target.value)} />
        </Field>

        <Checkbox
          id="single"
          label="Un solo uso"
          hint="Muere después del primer cobro aprobado, incluso si el número se filtró."
          checked={singleUse}
          onChange={setSingleUse}
        />

        <div className="rounded-xl border border-border bg-muted/50 p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Lock className="size-3" aria-hidden="true" />
            No se puede apagar
          </p>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            <li>Cap acumulado igual al presupuesto — corta el structuring.</li>
            <li>Vencimiento obligatorio — ninguna tarjeta vive para siempre.</li>
            <li>Se cierra sola cuando la tarea termina — mata la suscripción zombie.</li>
            <li>Una devolución no devuelve margen para gastar.</li>
          </ul>
        </div>

        {(error ?? blocker) !== null && (error ?? blocker) !== undefined && (
          <p className="flex items-start gap-1.5 text-xs font-medium text-destructive">
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            {error ?? blocker}
          </p>
        )}

        <Button onClick={submit} className="w-full" disabled={blocker !== null}>
          <CreditCard className="size-4" aria-hidden="true" />
          Emitir con defaults seguros
        </Button>
      </div>
    </Card>
  );
}

function AgentsPanel({
  agents,
}: {
  agents: Array<{
    id: string;
    name: string;
    purpose: string;
    activeCards: number;
    spentCents: number;
  }>;
}) {
  return (
    <Card title="Agentes" description="Quién gasta y cuánto lleva gastado.">
      <ul className="divide-y divide-border">
        {agents.map((agent) => (
          <li key={agent.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <Bot className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{agent.name}</p>
              <p className="truncate text-xs text-muted-foreground">{agent.purpose}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="num text-sm font-semibold">{usd(agent.spentCents)}</p>
              <p className="text-[11px] text-muted-foreground">
                {agent.activeCards} {agent.activeCards === 1 ? "activa" : "activas"}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function CardsPanel({
  store,
  cards,
  onDone,
}: {
  store: PanelStore;
  cards: CardRow[];
  onDone: (action: () => Promise<string>) => Promise<void>;
}) {
  return (
    <Card
      title="Tarjetas"
      description="Cada una atada a un agente, un comercio y una tarea."
      actions={
        <Chip tone="muted" dot={false}>
          {cards.filter((c) => c.status === "activa").length} activas
        </Chip>
      }
    >
      {cards.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Todavía no emitiste ninguna tarjeta.
        </p>
      ) : (
        <ul className="space-y-4">
          {cards.map((card) => (
            <CardItem key={card.id} card={card} store={store} onDone={onDone} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function CardItem({
  card,
  store,
  onDone,
}: {
  card: CardRow;
  store: PanelStore;
  onDone: (action: () => Promise<string>) => Promise<void>;
}) {
  const [amount, setAmount] = useState("9.00");
  const [withCaptcha, setWithCaptcha] = useState(false);
  const cents = usdToCents(amount);
  const pct =
    card.budgetCents === 0
      ? 0
      : Math.min(100, Math.round((card.spentCents / card.budgetCents) * 100));

  return (
    <li className="rounded-xl border border-border bg-background/40 p-3 sm:p-4">
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="w-full shrink-0 sm:w-52">
          <VirtualCard
            issued
            last4={card.last4}
            status={card.status}
            ttlLabel={`${Math.round(card.ttlSeconds / 3600)}H`}
            presetLabel={card.singleUse ? "1 USO" : "SEGURA"}
            holder={`${card.agentName.toUpperCase()} · ${card.taskId.toUpperCase()}`}
            compact
          />
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{card.merchant}</p>
              <p className="truncate text-xs text-muted-foreground">
                {card.agentName} · {card.taskId} · vence{" "}
                {card.expiresAt.toLocaleString("es-AR", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
            <Chip
              tone={
                card.status === "activa"
                  ? "success"
                  : card.status === "kill"
                    ? "destructive"
                    : "muted"
              }
            >
              {card.status === "activa"
                ? "ACTIVA"
                : card.status === "kill"
                  ? "KILL"
                  : "CERRADA"}
            </Chip>
          </div>

          <div>
            <div className="flex items-baseline justify-between text-xs">
              <span className="num font-semibold">
                {usd(card.spentCents)}{" "}
                <span className="font-normal text-muted-foreground">
                  de {usd(card.budgetCents)}
                </span>
              </span>
              <span className="num text-muted-foreground">
                queda {usd(card.remainingCents)}
              </span>
            </div>
            <div
              className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Gastado en ${card.merchant}`}
            >
              <div
                className={cx(
                  "h-full rounded-full transition-[width] duration-300 ease-out",
                  pct >= 100 ? "bg-warning" : "bg-accent",
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          {card.status === "activa" ? (
            <div className="space-y-2 border-t border-border pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor={`amt-${card.id}`} className="sr-only">
                  Monto del cobro
                </label>
                <Input
                  id={`amt-${card.id}`}
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="num max-w-24"
                  aria-invalid={cents === null}
                />
                <Button
                  size="sm"
                  disabled={cents === null || cents === 0}
                  onClick={() =>
                    cents !== null &&
                    void onDone(async () => {
                      const r = await store.charge(card.id, {
                        amountCents: cents,
                        withCaptcha,
                      });
                      return r.approved
                        ? `Cobro de ${usd(r.amountCents)} aprobado.`
                        : `Cobro rechazado: ${r.code}.`;
                    })
                  }
                >
                  Probar cobro
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void onDone(async () => {
                      await store.closeCard(card.id);
                      return `Tarjeta ••${card.last4} cerrada.`;
                    })
                  }
                >
                  <Ban className="size-3.5" aria-hidden="true" />
                  Cerrar
                </Button>
              </div>
              <Checkbox
                id={`cap-${card.id}`}
                label="El checkout tiene captcha"
                hint="Steel lo resuelve en la misma sesión y queda en el recibo."
                checked={withCaptcha}
                onChange={setWithCaptcha}
              />
            </div>
          ) : (
            <p className="border-t border-border pt-3 text-xs text-muted-foreground">
              {card.approvedCharges}{" "}
              {card.approvedCharges === 1 ? "cobro aprobado" : "cobros aprobados"}. La
              tarjeta ya no acepta nada.
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

function ReceiptsPanel({ receipts }: { receipts: ReceiptRow[] }) {
  return (
    <section className="mt-5">
      <Card
        title="Recibos"
        description="Cada cobro con su agente, su tarea y el motivo exacto."
        actions={
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Receipt className="size-3.5" aria-hidden="true" />
            {receipts.length}
          </span>
        }
      >
        {receipts.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Todavía no hubo cobros.
          </p>
        ) : (
          <ol className="divide-y divide-border">
            {receipts.map((r, index) => (
              <li
                key={r.id}
                className={cx("py-3 first:pt-0 last:pb-0", index === 0 && "animate-row-in")}
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="num w-7 shrink-0 text-xs text-muted-foreground">
                    #{String(r.id).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.merchant}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.agentName} · ••{r.cardLast4} · {r.taskId} ·{" "}
                      {r.at.toLocaleTimeString("es-AR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <span
                    className={cx(
                      "num text-sm font-semibold",
                      r.approved
                        ? "text-foreground"
                        : "text-muted-foreground line-through",
                    )}
                  >
                    {usd(r.amountCents)}
                  </span>
                  <Chip tone={r.approved ? "success" : "destructive"}>
                    {r.approved ? "APROBADO" : "RECHAZADO"}
                  </Chip>
                </div>
                <p className="mt-1.5 pl-10 text-xs leading-relaxed text-muted-foreground">
                  <span
                    className={cx(
                      "num",
                      !r.approved && "font-semibold text-destructive",
                    )}
                  >
                    {r.code}
                  </span>{" "}
                  — {r.reason}
                </p>
                {r.captcha !== null && (
                  <p className="mt-1.5 flex items-center gap-1.5 pl-10 text-xs text-muted-foreground">
                    <ShieldCheck className="size-3.5 shrink-0 text-gold" aria-hidden="true" />
                    Captcha <span className="num">{r.captcha.kind}</span> resuelto en el
                    checkout
                    {r.captcha.durationMs !== undefined && (
                      <span className="num"> · {r.captcha.durationMs}ms</span>
                    )}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>
    </section>
  );
}
