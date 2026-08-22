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
  variant = "primary",
  children,
  external = false,
}: {
  href: string;
  variant?: "primary" | "outline";
  children: ReactNode;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className={cx(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-5 text-sm font-medium",
        "transition-[background-color,border-color,color,transform,box-shadow] duration-100 ease-out active:scale-[0.98]",
        focusRing,
        variant === "primary"
          ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
          : "border border-border bg-card/80 text-foreground hover:border-accent/50 hover:bg-accent-soft",
      )}
    >
      {children}
    </a>
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
  title: string;
  lead?: string;
}) {
  return (
    <div className="max-w-3xl">
      <p className="font-mono text-xs font-semibold tracking-[0.22em] text-gold">
        {eyebrow}
      </p>
      <h2 className="font-display mt-3 text-3xl font-bold leading-[1.05] md:text-5xl">
        {title}
      </h2>
      <span
        aria-hidden="true"
        className="mt-5 block h-1 w-16 rounded-full bg-gradient-to-r from-accent to-gold"
      />
      {lead !== undefined && (
        <p className="mt-5 max-w-prose text-base leading-relaxed text-muted-foreground md:text-lg">
          {lead}
        </p>
      )}
    </div>
  );
}

const hoverLift =
  "transition-[transform,box-shadow,border-color] duration-150 ease-out hover:-translate-y-1 hover:shadow-lg";

const navLinks = [
  { href: "#problem", label: "The problem" },
  { href: "#defaults", label: "Defaults" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#principles", label: "Principles" },
];

export function Landing() {
  return (
    <div className="landing min-h-screen">
      <div aria-hidden="true" className="landing-grain" />
      <a
        href="#content"
        className={cx(
          "sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground",
        )}
      >
        Skip to content
      </a>

      <div aria-hidden="true" className="brand-bar h-1.5 w-full" />

      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 md:px-6">
          <a
            href="/"
            className={cx("flex items-center gap-2.5 rounded-lg", focusRing)}
          >
            <img
              src="/logo-light.png"
              alt=""
              className="size-9 rounded-lg border border-border shadow-sm"
            />
            <span className="font-display text-base font-bold tracking-tight">
              agent-card
            </span>
          </a>
          <div className="hidden items-center gap-1 md:flex">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className={cx(
                  "rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-[color,background-color] duration-100 ease-out hover:bg-accent-soft hover:text-accent",
                  focusRing,
                )}
              >
                {link.label}
              </a>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/panel.html"
              className={cx(
                "hidden rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-[color,background-color] duration-100 ease-out hover:bg-accent-soft hover:text-accent sm:inline-flex",
                focusRing,
              )}
            >
              Dashboard
            </a>
            <CtaLink href="/simulador.html">
              Try the simulator
              <ArrowRight className="size-4" aria-hidden="true" />
            </CtaLink>
          </div>
        </nav>
      </header>

      <main id="content">
        <section className="relative overflow-hidden">
          <div aria-hidden="true" className="orb orb-blue animate-orb -right-16 -top-20 size-[28rem]" />
          <div
            aria-hidden="true"
            className="orb orb-gold animate-orb-delayed -bottom-24 -left-16 size-[22rem]"
          />
          <p
            aria-hidden="true"
            className="watermark pointer-events-none absolute -right-6 top-8 text-[11rem] font-extrabold text-gold/25 md:right-8 md:text-[16rem]"
          >
            NO
          </p>
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 md:px-6 md:py-24 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <div className="animate-fade-up">
                <Chip tone="accent" dot={false}>
                  USDC ON SOLANA · NON-CUSTODIAL · SPANISH-FIRST
                </Chip>
              </div>
              <h1
                className="font-display animate-fade-up mt-6 text-5xl font-extrabold leading-[0.95] md:text-7xl"
                style={{ animationDelay: "60ms" }}
              >
                The card that
                <br />
                knows how to say{" "}
                <span className="text-gradient-brand">no.</span>
              </h1>
              <p
                className="animate-fade-up mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground md:text-xl"
                style={{ animationDelay: "120ms" }}
              >
                Virtual cards with safe defaults for AI agents that shop on
                their own. You set the budget, the merchant and the lifespan.
                The agent buys. Everything else gets declined — with the exact
                reason on the receipt.
              </p>
              <div
                className="animate-fade-up mt-8 flex flex-wrap items-center gap-3"
                style={{ animationDelay: "180ms" }}
              >
                <CtaLink href="/simulador.html">
                  <Play className="size-4" aria-hidden="true" />
                  Try the simulator
                </CtaLink>
              </div>
              <p
                className="animate-fade-up mt-5 flex items-center gap-2 text-xs text-muted-foreground"
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
              <TiltCard>
                <VirtualCard
                  issued
                  last4="4021"
                  status="activa"
                  ttlLabel="24 H"
                  presetLabel="SAFE"
                  className="card-glow"
                />
              </TiltCard>
              <div className="animate-float relative z-10 -mt-8 ml-auto w-[90%] rounded-2xl border-2 border-gold/40 bg-card p-5 shadow-xl">
                <p className="mb-3 font-mono text-[11px] font-semibold tracking-[0.18em] text-gold">
                  LEDGER · TASK-DEMO
                </p>
                <div className="space-y-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">api-credits</p>
                      <p className="num text-xs text-muted-foreground">
                        #01 · capture · day 0
                      </p>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="num text-sm font-semibold">USD 9.00</span>
                      <Chip tone="success">APPROVED</Chip>
                    </div>
                  </div>
                  <div className="border-t border-border pt-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">api-credits</p>
                        <p className="num text-xs text-muted-foreground">
                          #02 · capture · day 0
                        </p>
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="num text-sm font-semibold text-muted-foreground line-through">
                          USD 9.00
                        </span>
                        <Chip tone="destructive">DECLINED</Chip>
                      </div>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      <span className="num font-semibold text-destructive">
                        LIFETIME_EXCEEDED
                      </span>{" "}
                      — USD 18.00 accumulated would exceed the USD 10.00 cap.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="relative border-y border-border bg-primary text-primary-foreground">
            <dl className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:grid-cols-3 md:px-6">
              {[
                { k: "Lifetime cap", v: "USD 10.00" },
                { k: "Time to live", v: "24 hours" },
                { k: "Merchants allowed", v: "1 · allowlist" },
              ].map((stat) => (
                <div key={stat.k} className="flex flex-col gap-1">
                  <dt className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-primary-foreground/70">
                    {stat.k}
                  </dt>
                  <dd className="font-display text-2xl font-bold">{stat.v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section id="problem" className="field-navy relative overflow-hidden">
          <div aria-hidden="true" className="orb orb-gold -right-24 top-10 size-80 opacity-40" />
          <div className="relative mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
            <Reveal>
              <SectionHeading
                eyebrow="THE PROBLEM"
                title="An agent with your card is an employee with the cash drawer open."
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
                      "relative h-full overflow-hidden rounded-2xl border border-border bg-card p-6",
                      hoverLift,
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="font-display absolute -right-2 -top-3 text-7xl font-extrabold text-gold/20"
                    >
                      {item.n}
                    </span>
                    <span className="flex size-10 items-center justify-center rounded-xl bg-destructive-soft text-destructive">
                      <item.icon className="size-5" aria-hidden="true" />
                    </span>
                    <h3 className="font-display mt-5 text-xl font-bold">{item.title}</h3>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                      {item.body}
                    </p>
                    <p className="num mt-5 rounded-lg bg-destructive-soft px-3 py-2 text-xs font-medium text-destructive">
                      {item.code}
                    </p>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section id="defaults" className="field-gold relative overflow-hidden">
          <div aria-hidden="true" className="orb orb-blue -left-16 bottom-0 size-72 opacity-50" />
          <div className="relative mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
            <Reveal>
              <SectionHeading
                eyebrow="THE PRODUCT"
                title="Defaults that are not negotiable."
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
                      "flex h-full flex-col rounded-2xl border border-border bg-card p-6",
                      hoverLift,
                    )}
                  >
                    <span
                      className={cx(
                        "flex size-11 items-center justify-center rounded-xl",
                        index % 2 === 0
                          ? "bg-accent-soft text-accent"
                          : "bg-gold-soft text-gold",
                      )}
                    >
                      <item.icon className="size-5" aria-hidden="true" />
                    </span>
                    <h3 className="font-display mt-5 text-xl font-bold">{item.title}</h3>
                    <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">
                      {item.body}
                    </p>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="field-ice relative overflow-hidden">
          <div className="relative mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
            <Reveal>
              <SectionHeading
                eyebrow="HOW IT WORKS"
                title="Three steps, and the policy always decides before the rail."
              />
            </Reveal>
            <ol className="relative mt-14 grid gap-6 md:grid-cols-3">
              <span
                aria-hidden="true"
                className="absolute top-10 right-[16%] left-[16%] hidden h-1 rounded-full bg-gradient-to-r from-accent via-gold to-accent md:block"
              />
              {[
                {
                  n: "01",
                  title: "You define the policy",
                  body: "Total budget, allowed merchant, lifespan. Fund it with USDC on Solana: the funds stay in your wallet, not in ours.",
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
                      "relative flex h-full flex-col rounded-2xl border border-border bg-card p-6",
                      hoverLift,
                    )}
                  >
                    <span className="font-display text-gradient-brand relative z-10 text-5xl font-extrabold">
                      {step.n}
                    </span>
                    <h3 className="font-display mt-5 text-xl font-bold">{step.title}</h3>
                    <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">
                      {step.body}
                    </p>
                    <p className="num mt-5 break-words rounded-lg bg-muted px-3 py-2.5 text-xs text-muted-foreground">
                      {step.code}
                    </p>
                  </li>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        <section id="principles" className="field-navy relative overflow-hidden">
          <div aria-hidden="true" className="orb orb-blue -left-20 bottom-10 size-96 opacity-30" />
          <div className="relative mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
            <Reveal>
              <SectionHeading eyebrow="PRINCIPLES" title="Three rules that don't break." />
            </Reveal>
            <div className="mt-14 space-y-6">
              {[
                {
                  n: "01",
                  icon: Wallet,
                  title: "Your money is never mine.",
                  body: "No pool, no aggregated balance, no one-way withdrawals. Funds stay in your wallet; the limit is an on-chain allowance you can revoke whenever you want.",
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
                  <div className="grid items-start gap-6 rounded-2xl border border-border bg-card p-6 md:grid-cols-[auto_1fr] md:p-8">
                    <span className="font-display text-6xl font-extrabold leading-none text-gold/40 md:text-7xl">
                      {rule.n}
                    </span>
                    <div className="flex gap-4">
                      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gold-soft text-gold">
                        <rule.icon className="size-5" aria-hidden="true" />
                      </span>
                      <div>
                        <h3 className="font-display text-2xl font-bold md:text-3xl">
                          {rule.title}
                        </h3>
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

        <section className="field-gold relative overflow-hidden">
          <div aria-hidden="true" className="orb orb-blue right-0 -top-10 size-80 opacity-40" />
          <div className="relative mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
            <Reveal>
              <div className="relative overflow-hidden rounded-3xl border-2 border-primary/20 bg-card p-8 shadow-xl md:p-12">
                <Chip tone="warning" dot={false}>
                  <FlaskConical className="size-3" aria-hidden="true" />
                  WHERE WE ARE, NO SMOKE
                </Chip>
                <h2 className="font-display mt-5 text-3xl font-bold leading-tight md:text-5xl">
                  Today: a policy engine tested against a simulated issuer.
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
                  <CtaLink href="/simulador.html">
                    <Play className="size-4" aria-hidden="true" />
                    Run the attacks yourself
                  </CtaLink>
                </div>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="field-navy">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 md:flex-row md:items-center md:justify-between md:px-6">
          <div className="flex items-center gap-3">
            <img
              src="/logo-light.png"
              alt=""
              className="size-9 rounded-lg border border-border"
            />
            <span className="font-display text-base font-bold">agent-card</span>
          </div>
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            A control layer, not an issuer. The BIN, the bank and the KYC are
            bought from a provider; we decide whether the charge goes through.
          </p>
          <a
            href="/simulador.html"
            className={cx("rounded-sm text-sm font-medium text-gold underline-offset-4 hover:underline", focusRing)}
          >
            Simulator
          </a>
        </div>
        <div aria-hidden="true" className="brand-bar h-1.5 w-full" />
      </footer>
    </div>
  );
}
