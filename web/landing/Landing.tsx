import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
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
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-6 text-sm font-medium",
        "transition-[background-color,border-color,color,transform,box-shadow] duration-100 ease-out active:scale-[0.98]",
        focusRing,
        variant === "blue" && "shadow-soft bg-accent text-white hover:bg-accent/90",
        variant === "ink" && "shadow-soft bg-primary text-primary-foreground hover:bg-primary/85",
        variant === "outline" &&
          "shadow-soft border border-border bg-card text-foreground hover:border-foreground/25",
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
            "min-h-11 flex-1 rounded-full border border-border bg-background px-5 text-sm",
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
            "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-6 text-sm font-medium",
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
        "transition-[opacity,transform] duration-300 ease-out",
        shown ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

function TiltCard({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef(0);

  function handleMove(event: ReactPointerEvent<HTMLDivElement>) {
    const el = ref.current;
    if (el === null || prefersReducedMotion()) return;
    const rect = el.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width - 0.5;
    const py = (event.clientY - rect.top) / rect.height - 0.5;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      el.style.transform = `perspective(900px) rotateX(${(py * -8).toFixed(2)}deg) rotateY(${(px * 10).toFixed(2)}deg)`;
    });
  }

  function handleLeave() {
    const el = ref.current;
    if (el === null) return;
    cancelAnimationFrame(frame.current);
    el.style.transform = "perspective(900px) rotateX(0deg) rotateY(0deg)";
  }

  return (
    <div
      ref={ref}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      className="transition-transform duration-200 ease-out will-change-transform"
    >
      {children}
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  lead,
}: {
  eyebrow: string;
  title: ReactNode;
  lead?: string;
}) {
  return (
    <div className="max-w-3xl">
      <p className="font-mono text-xs font-semibold tracking-[0.22em] text-gold">
        {eyebrow}
      </p>
      <h2 className="font-display mt-4 text-4xl leading-[1.02] md:text-6xl">{title}</h2>
      {lead !== undefined && (
        <p className="mt-5 max-w-prose text-base leading-relaxed text-muted-foreground md:text-lg">
          {lead}
        </p>
      )}
    </div>
  );
}

const hoverLift =
  "transition-[transform,box-shadow,border-color] duration-150 ease-out hover:-translate-y-1 hover:shadow-float";

const navLinks = [
  { href: "#problem", label: "The problem" },
  { href: "#defaults", label: "Defaults" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#principles", label: "Principles" },
];

/** La mini terminal del hero: la decisión como objeto, en mono sobre tinta. */
function HeroTerminal() {
  return (
    <div className="shadow-float overflow-hidden rounded-2xl bg-[oklch(0.19_0.022_265)] text-left">
      <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-2.5">
        <span aria-hidden="true" className="size-2.5 rounded-full bg-[oklch(0.68_0.19_24)]" />
        <span aria-hidden="true" className="size-2.5 rounded-full bg-[oklch(0.83_0.14_90)]" />
        <span aria-hidden="true" className="size-2.5 rounded-full bg-[oklch(0.72_0.15_155)]" />
        <span className="ml-2 font-mono text-[10px] tracking-[0.18em] text-white/40">
          KONEX · MCP
        </span>
      </div>
      <div className="num space-y-1.5 px-4 py-3.5 text-xs leading-relaxed">
        <p className="text-white/80">
          <span className="text-white/35">&gt;</span> charge api-credits USD 9.00
        </p>
        <p className="text-[oklch(0.8_0.15_155)]">✓ APPROVED · receipt #01</p>
        <p className="text-white/80">
          <span className="text-white/35">&gt;</span> charge api-credits USD 9.00
        </p>
        <p className="text-[oklch(0.74_0.17_24)]">
          ✗ DENY · LIFETIME_EXCEEDED — cap USD 10.00
        </p>
      </div>
    </div>
  );
}

/** La tarjetita de specs que flota al lado de la tarjeta, estilo ficha técnica. */
function SpecCard() {
  return (
    <div className="shadow-float rounded-2xl border border-border bg-card p-4">
      <p className="font-display text-lg leading-none">Issue a card</p>
      <dl className="mt-3 space-y-2">
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

export function Landing() {
  return (
    <div className="min-h-screen overflow-x-clip">
      <a
        href="#content"
        className={cx(
          "sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground",
        )}
      >
        Skip to content
      </a>

      <header className="sticky top-3 z-40 px-3 md:top-4">
        <nav className="shadow-soft mx-auto flex max-w-5xl items-center justify-between gap-4 rounded-full border border-border bg-card/95 py-2 pl-3 pr-2 backdrop-blur-md">
          <a href="index.html" className={cx("flex items-center gap-2.5 rounded-full", focusRing)}>
            <img src="logo-light.png" alt="" className="size-8 rounded-full border border-border" />
            <span className="font-display text-xl leading-none">Konex</span>
          </a>
          <div className="hidden items-center gap-1 md:flex">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className={cx(
                  "rounded-full px-3 py-2 text-sm font-medium text-muted-foreground transition-[color,background-color] duration-100 ease-out hover:bg-muted hover:text-foreground",
                  focusRing,
                )}
              >
                {link.label}
              </a>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <a
              href="panel.html"
              className={cx(
                "hidden rounded-full px-3 py-2 text-sm font-medium text-muted-foreground transition-[color,background-color] duration-100 ease-out hover:bg-muted hover:text-foreground sm:inline-flex",
                focusRing,
              )}
            >
              Dashboard
            </a>
            <CtaLink href="simulador.html" variant="ink">
              Try the simulator
              <ArrowRight className="size-4" aria-hidden="true" />
            </CtaLink>
          </div>
        </nav>
      </header>

      <main id="content">
        <section className="relative">
          <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 pb-16 pt-14 md:px-6 md:pb-24 md:pt-20 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <div className="animate-fade-up">
                <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 font-mono text-[11px] font-semibold tracking-[0.18em] text-muted-foreground">
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-gold" />
                  ONE CARD · ONE TASK · ONE CAP
                </span>
              </div>
              <h1
                className="font-display animate-fade-up mt-6 text-6xl leading-[0.98] md:text-[5.4rem]"
                style={{ animationDelay: "60ms" }}
              >
                The card that
                <br />
                knows how to
                <br />
                say <span className="display-accent">no.</span>
              </h1>
              <p
                className="animate-fade-up mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground"
                style={{ animationDelay: "120ms" }}
              >
                Virtual cards with safe defaults for AI agents that shop on their
                own. You set the budget, the merchant and the lifespan. The agent
                buys. Everything else gets declined — with the exact reason on
                the receipt.
              </p>
              <div
                className="animate-fade-up mt-8 flex flex-wrap items-center gap-3"
                style={{ animationDelay: "180ms" }}
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
                className="animate-fade-up mt-6 flex max-w-xl items-center gap-2 text-xs text-muted-foreground"
                style={{ animationDelay: "240ms" }}
              >
                <FlaskConical className="size-3.5 shrink-0" aria-hidden="true" />
                Today this is a simulator with a mock issuer: no real money.
                Integrating a KYC issuer is the next step, not a vague promise.
              </p>
            </div>

            <div
              className="animate-fade-up relative mx-auto w-full max-w-md"
              style={{ animationDelay: "200ms" }}
            >
              {/* La línea punteada que une la política con la decisión. */}
              <div
                aria-hidden="true"
                className="absolute left-[30%] top-[30%] hidden h-[55%] border-l-2 border-dashed border-foreground/15 sm:block"
              />
              <div className="relative rotate-[3deg]">
                <TiltCard>
                  <VirtualCard
                    issued
                    last4="4021"
                    status="activa"
                    ttlLabel="24 H"
                    presetLabel="SAFE"
                    className="shadow-float"
                  />
                </TiltCard>
              </div>
              <div className="animate-float relative z-10 -mt-9 ml-auto w-[62%] -rotate-2 sm:-mr-6">
                <SpecCard />
              </div>
              <div className="animate-float-slow relative z-10 mt-4 w-[88%] rotate-1">
                <HeroTerminal />
              </div>
            </div>
          </div>

          <div className="mx-auto max-w-6xl px-4 pb-16 md:px-6 md:pb-20">
            <p className="font-mono text-[11px] font-semibold tracking-[0.22em] text-muted-foreground">
              SAFE DEFAULTS · ALWAYS ON
            </p>
            <ul className="mt-4 flex flex-wrap gap-2">
              {[
                "Lifetime cap",
                "TTL with auto-close",
                "Merchant allowlist",
                "Kill switch",
                "Receipt per charge",
                "Spanish-first",
              ].map((label) => (
                <li
                  key={label}
                  className="shadow-soft rounded-full border border-border bg-card px-4 py-2 text-sm font-medium"
                >
                  {label}
                </li>
              ))}
            </ul>
          </div>
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
                lead="Card providers sell you primitives: per-transaction limits, MCC, velocity. They don't tell you what to set. 90% of the risk lives in the configuration — and these are the three holes the typical config leaves open."
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
                  body: "The task ended a month ago. The card stayed alive. The SaaS renewed anyway — and it will renew again next month.",
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
                      "shadow-soft relative h-full overflow-hidden rounded-3xl border border-border bg-card p-6",
                      hoverLift,
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="font-display absolute -right-1 -top-4 text-8xl italic text-gold/25"
                    >
                      {item.n}
                    </span>
                    <span className="flex size-10 items-center justify-center rounded-full bg-destructive-soft text-destructive">
                      <item.icon className="size-5" aria-hidden="true" />
                    </span>
                    <h3 className="font-display mt-5 text-2xl">{item.title}</h3>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                      {item.body}
                    </p>
                    <p className="num mt-5 rounded-xl bg-destructive-soft px-3 py-2 text-xs font-medium text-destructive">
                      {item.code}
                    </p>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section id="defaults" className="relative">
          <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-24">
            <Reveal>
              <SectionHeading
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
                  body: "A LIFETIME ceiling on top of the per-charge limit. A card without a total cap simply can't exist: structuring dies here.",
                  span: "md:col-span-4",
                },
                {
                  icon: Clock,
                  title: "A lifespan with automatic closure",
                  body: "Every card is born with a TTL. Past it, everything is declined. No subscription outlives its task.",
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
                  title: "Spanish-first",
                  body: "Errors, docs and onboarding in Spanish. Built for a solo dev in LATAM, not a finance team in the US.",
                  span: "md:col-span-6",
                },
              ].map((item, index) => (
                <Reveal key={item.title} delayMs={(index % 3) * 70} className={item.span}>
                  <article
                    className={cx(
                      "shadow-soft flex h-full flex-col rounded-3xl border border-border bg-card p-6",
                      hoverLift,
                    )}
                  >
                    <span
                      className={cx(
                        "flex size-11 items-center justify-center rounded-full",
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

        <section id="how-it-works" className="relative">
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
            <ol className="relative mt-14 grid gap-6 md:grid-cols-3">
              <span
                aria-hidden="true"
                className="absolute left-[16%] right-[16%] top-10 hidden border-t-2 border-dashed border-foreground/15 md:block"
              />
              {[
                {
                  n: "01",
                  title: "You define the policy",
                  body: "Total budget, allowed merchant, lifespan. The cap is mandatory: a card without a ceiling can't be created.",
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
                  code: "DENY · LIFETIME_EXCEEDED — USD 10.00 cap",
                },
              ].map((step, index) => (
                <Reveal key={step.n} delayMs={index * 80} className="h-full">
                  <li
                    className={cx(
                      "shadow-soft relative flex h-full flex-col rounded-3xl border border-border bg-card p-6",
                      hoverLift,
                    )}
                  >
                    <span className="font-display relative z-10 text-5xl italic text-accent">
                      {step.n}
                    </span>
                    <h3 className="font-display mt-5 text-2xl">{step.title}</h3>
                    <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">
                      {step.body}
                    </p>
                    <p className="num mt-5 break-words rounded-xl bg-muted px-3 py-2.5 text-xs text-muted-foreground">
                      {step.code}
                    </p>
                  </li>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        <section id="principles" className="relative">
          <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-24">
            <Reveal>
              <SectionHeading
                eyebrow="PRINCIPLES"
                title={
                  <>
                    Three rules we{" "}
                    <span className="display-accent">don't negotiate.</span>
                  </>
                }
              />
            </Reveal>
            <div className="mt-14 space-y-5">
              {[
                {
                  n: "01",
                  icon: Wallet,
                  title: "Your money should never be mine.",
                  body: "Where this is going: funds that stay in your wallet under an allowance you can revoke. That part is not built. Today the balance sits with the card issuer, like every card program does — and we'd rather you read it here than find out later.",
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
                <Reveal key={rule.title} delayMs={index * 70}>
                  <div className="shadow-soft grid items-start gap-6 rounded-3xl border border-border bg-card p-6 md:grid-cols-[auto_1fr] md:p-8">
                    <span className="font-display text-6xl italic leading-none text-gold/40 md:text-7xl">
                      {rule.n}
                    </span>
                    <div className="flex gap-4">
                      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gold-soft text-gold">
                        <rule.icon className="size-5" aria-hidden="true" />
                      </span>
                      <div>
                        <h3 className="font-display text-3xl md:text-4xl">{rule.title}</h3>
                        <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
                          {rule.body}
                        </p>
                      </div>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="relative">
          <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-24">
            <Reveal>
              <div className="shadow-float relative overflow-hidden rounded-3xl border border-border bg-card p-8 md:p-12">
                <Chip tone="warning" dot={false}>
                  <FlaskConical className="size-3" aria-hidden="true" />
                  WHERE WE ARE, NO SMOKE
                </Chip>
                <h2 className="font-display mt-5 text-4xl leading-[1.02] md:text-6xl">
                  Today: a policy engine tested against a{" "}
                  <span className="display-accent">simulated</span> issuer.
                </h2>
                <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
                  The engine has tests and a harness that runs the attacks on
                  this page. What's next is measuring against the real world:
                  a USD 5 online charge on a KYC issuer, then the structuring
                  test with real money. If the bypass doesn't get through even
                  with the provider's permissive config, this product has no
                  reason to exist — and we'll say it right here.
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

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 md:flex-row md:items-center md:justify-between md:px-6">
          <div className="flex items-center gap-3">
            <img src="logo-light.png" alt="" className="size-9 rounded-full border border-border" />
            <span className="font-display text-xl">Konex</span>
          </div>
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            A control layer, not an issuer. The BIN, the bank and the KYC are
            bought from a provider; we decide whether the charge goes through.
          </p>
          <a
            href="simulador.html"
            className={cx(
              "rounded-sm text-sm font-medium text-accent underline-offset-4 hover:underline",
              focusRing,
            )}
          >
            Simulator
          </a>
        </div>
      </footer>
    </div>
  );
}
