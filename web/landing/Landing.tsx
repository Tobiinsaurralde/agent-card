import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowRight,
  Ban,
  Clock,
  FileText,
  FlaskConical,
  Languages,
  Lock,
  Play,
  ShieldCheck,
  Wallet,
  Zap,
} from "lucide-react";
import { Chip, cx, focusRing } from "../ui.js";
import { VirtualCard } from "../components/VirtualCard.js";

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function CtaLink({
  href,
  variant = "blue",
  children,
  external = false,
}: {
  href: string;
  variant?: "blue" | "ink" | "outline";
  children: ReactNode;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className={cx(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold",
        "transition-[background-color,border-color,color,transform,box-shadow] duration-100 ease-out active:translate-x-px active:translate-y-px active:shadow-none",
        focusRing,
        variant === "blue" && "shadow-soft bg-accent text-white hover:bg-accent/90",
        variant === "ink" && "shadow-soft bg-primary text-primary-foreground hover:bg-primary/85",
        variant === "outline" &&
          "shadow-soft border border-foreground/20 bg-card text-foreground hover:border-foreground/45",
      )}
    >
      {children}
    </a>
  );
}

/**
 * Dónde caen los mails de la waitlist. Se define en build (`.env`), no acá.
 *
 * Si no está, el formulario no se dibuja. Es deliberado: un form sin destino
 * acepta el mail, dice "gracias" y lo tira, y eso es peor que no tener waitlist
 * porque nadie se entera hasta que se buscan los registros y no hay ninguno.
 */
const WAITLIST_ENDPOINT = (import.meta.env["VITE_WAITLIST_ENDPOINT"] ?? "").trim();

type SendState = { kind: "idle" | "sending" | "ok" } | { kind: "error"; message: string };

function Waitlist() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<SendState>({ kind: "idle" });
  // Trampa para bots: un humano no ve este campo, así que si viene lleno es spam.
  const [trap, setTrap] = useState("");

  if (WAITLIST_ENDPOINT === "") return null;

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (state.kind === "sending") return;
    if (trap !== "") {
      setState({ kind: "ok" });
      return;
    }

    setState({ kind: "sending" });
    try {
      const response = await fetch(WAITLIST_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setState({ kind: "ok" });
      setEmail("");
    } catch {
      // Nunca decir "listo" si no llegó: el que se anotó no va a volver a intentar.
      setState({
        kind: "error",
        message: "Couldn't sign you up. Try again in a moment.",
      });
    }
  }

  if (state.kind === "ok") {
    return (
      <p className="mt-8 text-base font-medium text-gold" role="status">
        You're on the list. We'll write when it charges for real.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="mt-8 max-w-lg">
      <label htmlFor="waitlist-email" className="text-sm font-medium">
        Leave your email and we'll tell you when it charges for real.
      </label>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <input
          id="waitlist-email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={cx(
            "min-h-11 flex-1 rounded-lg border border-foreground/20 bg-background px-4 text-sm",
            "placeholder:text-muted-foreground",
            focusRing,
          )}
        />
        <input
          type="text"
          name="company"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          value={trap}
          onChange={(e) => setTrap(e.target.value)}
          className="hidden"
        />
        <button
          type="submit"
          disabled={state.kind === "sending"}
          className={cx(
            "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold",
            "shadow-soft bg-accent text-white transition-colors hover:bg-accent/90",
            "disabled:cursor-not-allowed disabled:opacity-60",
            focusRing,
          )}
        >
          {state.kind === "sending" ? "Sending…" : "Notify me"}
        </button>
      </div>
      <p className="mt-3 min-h-5 text-sm text-muted-foreground" role="status" aria-live="polite">
        {state.kind === "error" ? state.message : ""}
      </p>
    </form>
  );
}

function Reveal({
  children,
  className,
  delayMs = 0,
}: {
  children: ReactNode;
  className?: string;
  delayMs?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    if (prefersReducedMotion()) {
      setShown(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setShown(true);
          observer.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={delayMs > 0 ? { transitionDelay: `${delayMs}ms` } : undefined}
      className={cx(
        "transition-[opacity,transform,filter] duration-500 ease-out",
        shown ? "translate-y-0 opacity-100 blur-none" : "translate-y-5 opacity-0 blur-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Etiqueta de sección: tag mono bordeada, no un eyebrow suelto. */
function SectionTag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block rounded-md border border-gold/45 bg-gold-soft px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.2em] text-gold">
      {children}
    </span>
  );
}

function SectionHeading({
  eyebrow,
  title,
  lead,
  align = "left",
}: {
  eyebrow: string;
  title: ReactNode;
  lead?: string;
  align?: "left" | "right";
}) {
  return (
    <div className={cx("max-w-3xl", align === "right" && "ml-auto text-right")}>
      <SectionTag>{eyebrow}</SectionTag>
      <h2 className="font-display mt-5 text-4xl leading-[1.04] md:text-5xl">{title}</h2>
      {lead !== undefined && (
        <p
          className={cx(
            "mt-5 max-w-prose text-base leading-relaxed text-muted-foreground md:text-lg",
            align === "right" && "ml-auto",
          )}
        >
          {lead}
        </p>
      )}
    </div>
  );
}

const hoverLift =
  "transition-[transform,box-shadow,border-color] duration-150 ease-out hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-float";

const navLinks = [
  { href: "#problem", label: "PROBLEM" },
  { href: "#defaults", label: "DEFAULTS" },
  { href: "#how-it-works", label: "HOW" },
  { href: "docs.html", label: "DOCS" },
  { href: "whitepaper.html", label: "WHITEPAPER" },
  { href: "tokenomics.html", label: "$KNX" },
];

/** La terminal del diagrama: cada línea entra sola, con cursor titilando. */
function HeroTerminal() {
  const lines = [
    { text: "> charge api-credits USD 9.00", tone: "plain" },
    { text: "✓ APPROVED · receipt #01", tone: "ok" },
    { text: "> charge api-credits USD 9.00", tone: "plain" },
    { text: "✗ DENY · LIFETIME_EXCEEDED", tone: "bad" },
  ] as const;

  return (
    <div className="shadow-float overflow-hidden rounded-xl border border-foreground/20 bg-[oklch(0.19_0.022_265)] text-left">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <span className="font-mono text-[10px] tracking-[0.18em] text-white/45">
          KONEX · MCP
        </span>
        <span aria-hidden="true" className="font-mono text-[10px] text-white/30">
          stdio
        </span>
      </div>
      <div className="num space-y-1.5 px-4 py-3.5 text-xs leading-relaxed">
        {lines.map((line, index) => (
          <p
            key={line.text + String(index)}
            className={cx(
              "animate-fade-up",
              line.tone === "plain" && "text-white/80",
              line.tone === "ok" && "text-[oklch(0.8_0.15_155)]",
              line.tone === "bad" && "text-[oklch(0.74_0.17_24)]",
            )}
            style={{ animationDelay: `${600 + index * 350}ms` }}
          >
            {line.text}
          </p>
        ))}
        <p className="animate-fade-up text-white/60" style={{ animationDelay: "2050ms" }}>
          <span className="animate-blink">▌</span>
        </p>
      </div>
    </div>
  );
}

/** La política como ficha: lo que definís antes de que exista la tarjeta. */
function SpecCard() {
  return (
    <div className="shadow-float rounded-xl border border-foreground/20 bg-card p-4 text-left">
      <p className="num text-[10px] font-semibold tracking-[0.18em] text-muted-foreground">
        request_card
      </p>
      <dl className="mt-3 space-y-2 border-t border-border pt-3">
        {[
          { k: "Cap", v: "USD 10.00" },
          { k: "Expires", v: "24 h" },
          { k: "Merchant", v: "1 · allowlist" },
          { k: "On deny", v: "says why" },
        ].map((row) => (
          <div key={row.k} className="flex items-baseline justify-between gap-4">
            <dt className="text-xs text-muted-foreground">{row.k}</dt>
            <dd className="num text-xs font-semibold">{row.v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Paso del diagrama del hero: etiqueta mono arriba, el objeto abajo. */
function FlowStep({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="w-full">
      <p className="mb-2.5 text-center font-mono text-[10px] font-semibold tracking-[0.22em] text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}

function FlowArrow() {
  return (
    <div aria-hidden="true" className="flex items-center justify-center px-1 py-1 md:pt-7">
      <ArrowRight className="hidden size-5 text-gold md:block" />
      <ArrowDown className="size-5 text-gold md:hidden" />
    </div>
  );
}

const DEFAULTS_MARQUEE = [
  "LIFETIME CAP",
  "TTL WITH AUTO-CLOSE",
  "MERCHANT ALLOWLIST",
  "KILL SWITCH",
  "RECEIPT PER CHARGE",
  "PLAIN REASONS",
];

function Marquee() {
  return (
    <div className="marquee border-y border-foreground/15 bg-card py-3">
      <div className="marquee-track">
        {[0, 1].map((copy) => (
          <ul
            key={copy}
            aria-hidden={copy === 1}
            className="flex shrink-0 items-center font-mono text-xs font-semibold tracking-[0.2em] text-foreground/80"
          >
            {DEFAULTS_MARQUEE.map((item) => (
              <li key={item} className="flex items-center">
                <span className="px-5">{item}</span>
                <span aria-hidden="true" className="text-gold">
                  ✦
                </span>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}

export function Landing() {
  return (
    <div className="min-h-screen overflow-x-clip">
      <a
        href="#content"
        className={cx(
          "sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground",
        )}
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-foreground/15 bg-background/90 backdrop-blur-md">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2.5 md:px-6">
          <a href="index.html" className={cx("flex items-center gap-2.5 rounded-md", focusRing)}>
            <img src="logo-light.png" alt="" className="size-8 rounded-md border border-border" />
            <span className="font-display text-lg leading-none">Konex</span>
          </a>
          <div className="hidden items-center gap-5 md:flex">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className={cx(
                  "rounded-sm font-mono text-[11px] font-semibold tracking-[0.18em] text-muted-foreground transition-colors duration-100 ease-out hover:text-accent",
                  focusRing,
                )}
              >
                {link.label}
              </a>
            ))}
            <a
              href="panel.html"
              className={cx(
                "rounded-sm font-mono text-[11px] font-semibold tracking-[0.18em] text-muted-foreground transition-colors duration-100 ease-out hover:text-accent",
                focusRing,
              )}
            >
              DASHBOARD
            </a>
          </div>
          <CtaLink href="simulador.html" variant="ink">
            Try the simulator
            <ArrowRight className="size-4" aria-hidden="true" />
          </CtaLink>
        </nav>
      </header>

      <main id="content">
        <section className="relative">
          <div className="mx-auto max-w-4xl px-4 pt-16 text-center md:px-6 md:pt-24">
            <div className="animate-fade-up flex justify-center">
              <span className="inline-flex items-center gap-2 rounded-md border border-foreground/20 bg-card px-3 py-1.5 font-mono text-[11px] font-semibold tracking-[0.18em] text-muted-foreground">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-gold" />
                ONE CARD · ONE TASK · ONE CAP
              </span>
            </div>
            <h1
              className="font-display animate-fade-up mt-7 text-5xl leading-[1.02] md:text-7xl"
              style={{ animationDelay: "80ms" }}
            >
              The card that knows
              <br />
              how to say <span className="display-stamp">NO.</span>
            </h1>
            <p
              className="animate-fade-up mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground"
              style={{ animationDelay: "160ms" }}
            >
              A control layer for virtual cards that AI agents use to shop.
              You set the budget, the merchant and the lifespan. A licensed
              issuer opens the card. We decide if the charge goes through,
              with the exact reason on the receipt.
            </p>
            <div
              className="animate-fade-up mt-8 flex flex-wrap items-center justify-center gap-3"
              style={{ animationDelay: "240ms" }}
            >
              <CtaLink href="simulador.html">
                Try the simulator
                <ArrowRight className="size-4" aria-hidden="true" />
              </CtaLink>
              <CtaLink href="panel.html" variant="outline">
                See the panel
              </CtaLink>
            </div>
            <p
              className="animate-fade-up mx-auto mt-6 flex max-w-xl items-center justify-center gap-2 text-xs text-muted-foreground"
              style={{ animationDelay: "320ms" }}
            >
              <FlaskConical className="size-3.5 shrink-0" aria-hidden="true" />
              Today this is a simulator with a mock issuer: no real money.
              Integrating a KYC issuer is the next step, not a vague promise.
            </p>
          </div>

          {/* La historia del producto en una línea: política → tarjeta → decisión. */}
          <div
            className="animate-fade-up mx-auto mt-14 max-w-6xl px-4 pb-16 md:mt-20 md:px-6 md:pb-20"
            style={{ animationDelay: "380ms" }}
          >
            <div className="grid items-start gap-2 md:grid-cols-[1fr_auto_1.15fr_auto_1fr] md:gap-3">
              <FlowStep label="01 · YOU SET THE POLICY">
                <SpecCard />
              </FlowStep>
              <FlowArrow />
              <FlowStep label="02 · THE ISSUER OPENS A CARD">
                <VirtualCard
                  issued
                  last4="4021"
                  status="activa"
                  ttlLabel="24 H"
                  presetLabel="SAFE"
                  className="shadow-float"
                />
              </FlowStep>
              <FlowArrow />
              <FlowStep label="03 · EVERY CHARGE IS DECIDED">
                <HeroTerminal />
              </FlowStep>
            </div>
          </div>

          <Marquee />
        </section>

        <section id="problem" className="relative">
          <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-24">
            <Reveal>
              <SectionHeading
                eyebrow="THE PROBLEM"
                title={
                  <>
                    An agent with your card is an employee with the cash drawer{" "}
                    <span className="display-accent">open.</span>
                  </>
                }
                lead="Card providers sell you primitives: per-transaction limits, MCC, velocity. They don't tell you what to set. 90% of the risk lives in the configuration, and these are the three holes the typical config leaves open."
              />
            </Reveal>
            <div className="mt-14 grid gap-5 md:grid-cols-3">
              {[
                {
                  n: "01",
                  icon: Zap,
                  title: "Structuring",
                  body: "A USD 10 per-charge cap and no cumulative cap: two USD 9 charges spend USD 18. The limit you configured didn't limit anything.",
                  code: "USD 18.00 spent with a USD 10.00 cap",
                },
                {
                  n: "02",
                  icon: Clock,
                  title: "Zombie subscription",
                  body: "The task ended a month ago. The card stayed alive. The SaaS renewed anyway, and it will renew again next month.",
                  code: "renewal approved · day 30",
                },
                {
                  n: "03",
                  icon: Ban,
                  title: "Any merchant",
                  body: "The card was meant for API credits. Without an allowlist, nothing stops the same number from paying anywhere else.",
                  code: "casino-online · APPROVED",
                },
              ].map((item, index) => (
                <Reveal key={item.title} delayMs={index * 80}>
                  <article
                    className={cx(
                      "shadow-soft relative h-full rounded-xl border border-foreground/20 bg-card p-6",
                      hoverLift,
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="flex size-10 items-center justify-center rounded-md bg-destructive-soft text-destructive">
                        <item.icon className="size-5" aria-hidden="true" />
                      </span>
                      <span className="num rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground">
                        {item.n}
                      </span>
                    </div>
                    <h3 className="font-display mt-5 text-2xl">{item.title}</h3>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                      {item.body}
                    </p>
                    <p className="num mt-5 rounded-md bg-destructive-soft px-3 py-2 text-xs font-medium text-destructive">
                      {item.code}
                    </p>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section id="defaults" className="relative border-t border-foreground/10">
          <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-24">
            <Reveal>
              <SectionHeading
                align="right"
                eyebrow="THE PRODUCT"
                title={
                  <>
                    Defaults that are{" "}
                    <span className="display-accent">not negotiable.</span>
                  </>
                }
                lead="We don't sell the primitive: we sell the opinion. These rules ship from the factory and can't be turned off, because each one plugs a real hole."
              />
            </Reveal>
            <div className="mt-14 grid gap-4 md:grid-cols-6">
              {[
                {
                  icon: ShieldCheck,
                  title: "Mandatory lifetime cap",
                  body: "A LIFETIME ceiling on top of the per-charge limit. A card without a total cap cannot be requested: structuring dies here.",
                  span: "md:col-span-4",
                },
                {
                  icon: Clock,
                  title: "A lifespan with automatic closure",
                  body: "Every scoped card starts with a TTL. Past it, everything is declined. No subscription outlives its task.",
                  span: "md:col-span-2",
                },
                {
                  icon: Lock,
                  title: "Allowlist, not blacklist",
                  body: "The card only charges at the merchants you declared. Anything unlisted is declined by default.",
                  span: "md:col-span-2",
                },
                {
                  icon: Ban,
                  title: "Global kill switch",
                  body: "One button that stops everything, now. And when you mark the task as done, the card closes itself.",
                  span: "md:col-span-2",
                },
                {
                  icon: FileText,
                  title: "A receipt per charge",
                  body: "Agent, task, merchant, amount and the exact decision code. Approved or declined, you always know why.",
                  span: "md:col-span-2",
                },
                {
                  icon: Languages,
                  title: "Plain-language reasons",
                  body: "Errors and receipts say exactly why, in words a solo builder can read. Not bank-speak for a finance team.",
                  span: "md:col-span-6",
                },
              ].map((item, index) => (
                <Reveal key={item.title} delayMs={(index % 3) * 70} className={item.span}>
                  <article
                    className={cx(
                      "shadow-soft flex h-full flex-col rounded-xl border border-foreground/20 bg-card p-6",
                      hoverLift,
                    )}
                  >
                    <span
                      className={cx(
                        "flex size-10 items-center justify-center rounded-md",
                        index % 2 === 0
                          ? "bg-accent-soft text-accent"
                          : "bg-gold-soft text-gold",
                      )}
                    >
                      <item.icon className="size-5" aria-hidden="true" />
                    </span>
                    <h3 className="font-display mt-5 text-2xl">{item.title}</h3>
                    <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">
                      {item.body}
                    </p>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="relative border-t border-foreground/10">
          <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-24">
            <Reveal>
              <SectionHeading
                eyebrow="HOW IT WORKS"
                title={
                  <>
                    Three steps, and the policy always decides{" "}
                    <span className="display-accent">before the rail.</span>
                  </>
                }
              />
            </Reveal>
            <ol className="mt-12 divide-y divide-border">
              {[
                {
                  n: "01",
                  title: "You define the policy",
                  body: "Total budget, allowed merchant, lifespan. The cap is mandatory: a card without a ceiling cannot be requested.",
                  code: 'request_card { amount: 10, merchant: "api-credits", ttl: "24h" }',
                },
                {
                  n: "02",
                  title: "The agent gets a handle",
                  body: "Never a card number through our backend: the PAN travels from the issuer to the agent with a short-lived token. PCI scope: zero.",
                  code: "card_handle: crd_7f2… (the PAN never touches our server)",
                },
                {
                  n: "03",
                  title: "Every charge gets decided",
                  body: "The policy is evaluated server-side, outside the prompt. DENY wins. The agent can't negotiate its own limit.",
                  code: "DENY · LIFETIME_EXCEEDED · USD 10.00 cap",
                },
              ].map((step, index) => (
                <Reveal key={step.n} delayMs={index * 80}>
                  <li className="grid gap-4 py-8 md:grid-cols-[auto_1.1fr_1fr] md:gap-10">
                    <span
                      aria-hidden="true"
                      className="font-display text-outline text-6xl leading-none md:text-7xl"
                    >
                      {step.n}
                    </span>
                    <div>
                      <h3 className="font-display text-2xl md:text-3xl">{step.title}</h3>
                      <p className="mt-3 max-w-prose text-sm leading-relaxed text-muted-foreground md:text-base">
                        {step.body}
                      </p>
                    </div>
                    <p className="num shadow-soft self-center break-words rounded-lg border border-foreground/15 bg-card px-4 py-3 text-xs text-muted-foreground">
                      {step.code}
                    </p>
                  </li>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        <section id="principles" className="relative border-t border-foreground/10">
          <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-24">
            <Reveal>
              <SectionHeading
                align="right"
                eyebrow="PRINCIPLES"
                title={
                  <>
                    Three rules we{" "}
                    <span className="display-accent">don't negotiate.</span>
                  </>
                }
              />
            </Reveal>
            <div className="mt-14 grid gap-5 lg:grid-cols-3">
              {[
                {
                  n: "01",
                  icon: Wallet,
                  title: "Your money should never be mine.",
                  body: "Where this is going: funds that stay in your wallet under an allowance you can revoke. That part is not built. Today the balance sits with the card issuer, like every card program does, and we'd rather you read it here than find out later.",
                },
                {
                  n: "02",
                  icon: Lock,
                  title: "The PAN never touches our backend.",
                  body: "The card number goes straight from the issuer to the agent. If our server goes down or leaks, your card isn't in it.",
                },
                {
                  n: "03",
                  icon: ShieldCheck,
                  title: "DENY wins.",
                  body: "The decision lives outside the prompt and is evaluated server-side. There is no jailbreak that talks a policy into overspending.",
                },
              ].map((rule, index) => (
                <Reveal key={rule.title} delayMs={index * 70} className="h-full">
                  <div
                    className={cx(
                      "shadow-soft flex h-full flex-col rounded-xl border border-foreground/20 bg-card p-6",
                      hoverLift,
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="flex size-10 items-center justify-center rounded-md bg-gold-soft text-gold">
                        <rule.icon className="size-5" aria-hidden="true" />
                      </span>
                      <span
                        aria-hidden="true"
                        className="font-display text-outline text-5xl leading-none"
                      >
                        {rule.n}
                      </span>
                    </div>
                    <h3 className="font-display mt-5 text-2xl">{rule.title}</h3>
                    <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">
                      {rule.body}
                    </p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="relative border-t border-foreground/10">
          <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-24">
            <Reveal>
              <div className="shadow-float relative overflow-hidden rounded-xl border border-foreground/20 bg-card p-8 md:p-12">
                <Chip tone="warning" dot={false}>
                  <FlaskConical className="size-3" aria-hidden="true" />
                  WHERE WE ARE, NO SMOKE
                </Chip>
                <h2 className="font-display mt-5 max-w-3xl text-4xl leading-[1.04] md:text-5xl">
                  Today: a policy engine tested against a{" "}
                  <span className="display-accent">simulated</span> issuer.
                </h2>
                <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
                  The engine has tests and a harness that runs the attacks on
                  this page. What's next is measuring against the real world:
                  a USD 5 online charge on a KYC issuer, then the structuring
                  test with real money. If the bypass doesn't get through even
                  with the provider's permissive config, this product has no
                  reason to exist, and we'll say it right here.
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <CtaLink href="simulador.html">
                    <Play className="size-4" aria-hidden="true" />
                    Run the attacks yourself
                  </CtaLink>
                </div>
                <Waitlist />
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="border-t border-foreground/15">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 md:flex-row md:items-center md:justify-between md:px-6">
          <div className="flex items-center gap-3">
            <img src="logo-light.png" alt="" className="size-9 rounded-md border border-border" />
            <span className="font-display text-lg">Konex</span>
          </div>
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            A control layer, not an issuer. The BIN, the bank and the KYC are
            bought from a provider; we decide whether the charge goes through.
          </p>
          <div className="flex flex-wrap gap-4">
            {[
              { href: "docs.html", label: "DOCS" },
              { href: "whitepaper.html", label: "WHITEPAPER" },
              { href: "tokenomics.html", label: "$KNX" },
              { href: "simulador.html", label: "SIMULATOR" },
            ].map((link) => (
              <a
                key={link.href}
                href={link.href}
                className={cx(
                  "rounded-sm font-mono text-[11px] font-semibold tracking-[0.18em] text-accent underline-offset-4 hover:underline",
                  focusRing,
                )}
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
