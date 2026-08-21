import type { ReactNode } from "react";
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

/** Link styled as a button: the landing navigates, it doesn't execute. */
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
        "transition-[background-color,border-color,color,transform] duration-100 ease-out active:scale-[0.98]",
        focusRing,
        variant === "primary"
          ? "bg-primary text-primary-foreground hover:bg-primary/85"
          : "border border-border bg-card text-foreground hover:bg-muted",
      )}
    >
      {children}
    </a>
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
    <div className="max-w-2xl">
      <p className="font-mono text-xs font-semibold tracking-[0.2em] text-gold">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
        {title}
      </h2>
      {lead !== undefined && (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground md:text-base">
          {lead}
        </p>
      )}
    </div>
  );
}

const navLinks = [
  { href: "#problem", label: "The problem" },
  { href: "#defaults", label: "Defaults" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#principles", label: "Principles" },
];

export function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <a
        href="#content"
        className={cx(
          "sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground",
        )}
      >
        Skip to content
      </a>

      {/* ─── Nav ─── */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 md:px-6">
          <a
            href="/"
            className={cx("flex items-center gap-2.5 rounded-lg", focusRing)}
          >
            <img
              src="/logo-light.png"
              alt=""
              className="size-8 rounded-lg border border-border"
            />
            <span className="font-mono text-sm font-semibold tracking-tight">
              agent-card
            </span>
          </a>
          <div className="hidden items-center gap-1 md:flex">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className={cx(
                  "rounded-lg px-3 py-2 text-sm text-muted-foreground transition-[color,background-color] duration-100 ease-out hover:bg-muted hover:text-foreground",
                  focusRing,
                )}
              >
                {link.label}
              </a>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <a
              href="https://github.com/Tobiinsaurralde/agent-card"
              target="_blank"
              rel="noreferrer"
              className={cx(
                "hidden rounded-lg px-3 py-2 text-sm text-muted-foreground transition-[color,background-color] duration-100 ease-out hover:bg-muted hover:text-foreground sm:block",
                focusRing,
              )}
            >
              GitHub
            </a>
            <CtaLink href="/simulador.html">
              Try the simulator
              <ArrowRight className="size-4" aria-hidden="true" />
            </CtaLink>
          </div>
        </nav>
      </header>

      <main id="content">
        {/* ─── Hero ─── */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(60% 45% at 70% 0%, oklch(0.66 0.16 255 / 8%) 0%, transparent 70%), radial-gradient(45% 35% at 15% 100%, oklch(0.85 0.13 92 / 4%) 0%, transparent 70%)",
            }}
          />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 md:px-6 md:py-24 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <Chip tone="accent" dot={false}>
                USDC ON SOLANA · NON-CUSTODIAL · SPANISH-FIRST
              </Chip>
              <h1 className="mt-5 text-4xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
                The card that
                <br />
                knows how to say{" "}
                <span className="text-gold">no.</span>
              </h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
                Virtual cards with safe defaults for AI agents that shop on
                their own. You set the budget, the merchant and the lifespan.
                The agent buys. Everything else gets declined — with the exact
                reason on the receipt.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <CtaLink href="/simulador.html">
                  <Play className="size-4" aria-hidden="true" />
                  Try the simulator
                </CtaLink>
                <CtaLink
                  href="https://github.com/Tobiinsaurralde/agent-card"
                  variant="outline"
                  external
                >
                  View the code
                </CtaLink>
              </div>
              <p className="mt-5 flex items-center gap-2 text-xs text-muted-foreground">
                <FlaskConical className="size-3.5 shrink-0" aria-hidden="true" />
                Today this is a simulator with a mock issuer: no real money.
                Integrating a KYC issuer is the next step, not a vague promise.
              </p>
            </div>

            {/* The card and the receipt: the hero moment is the decline. */}
            <div className="relative mx-auto w-full max-w-md">
              <VirtualCard
                issued
                last4="4021"
                status="activa"
                ttlLabel="24 H"
                presetLabel="SAFE"
              />
              <div className="relative z-10 -mt-6 ml-auto w-[88%] rounded-xl border border-border bg-card p-4 shadow-xl">
                <p className="mb-3 text-[11px] font-medium tracking-wide text-muted-foreground">
                  LEDGER · TASK-DEMO
                </p>
                <div className="space-y-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">api-credits</p>
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
                        <p className="truncate text-sm font-medium">api-credits</p>
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
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
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
        </section>

        {/* ─── The problem ─── */}
        <section id="problem" className="border-t border-border">
          <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-20">
            <SectionHeading
              eyebrow="THE PROBLEM"
              title="An agent with your card is an employee with the cash drawer open."
              lead="Card providers sell you primitives: per-transaction limits, MCC, velocity. They don't tell you what to set. 90% of the risk lives in the configuration — and these are the three holes the typical config leaves open."
            />
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {[
                {
                  icon: Zap,
                  title: "Structuring",
                  body: "A USD 10 per-charge cap and no cumulative cap: two USD 9 charges spend USD 18. The limit you configured didn't limit anything.",
                  code: "USD 18.00 spent with a USD 10.00 cap",
                },
                {
                  icon: Clock,
                  title: "Zombie subscription",
                  body: "The task ended a month ago. The card stayed alive. The SaaS renewed anyway — and it will renew again next month.",
                  code: "renewal approved · day 30",
                },
                {
                  icon: Ban,
                  title: "Any merchant",
                  body: "The card was meant for API credits. Without an allowlist, nothing stops the same number from paying anywhere else.",
                  code: "casino-online · APPROVED",
                },
              ].map((item) => (
                <article
                  key={item.title}
                  className="rounded-xl border border-border bg-card p-5"
                >
                  <span className="flex size-9 items-center justify-center rounded-lg bg-destructive-soft text-destructive">
                    <item.icon className="size-4" aria-hidden="true" />
                  </span>
                  <h3 className="mt-4 text-base font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {item.body}
                  </p>
                  <p className="num mt-4 rounded-md bg-muted px-3 py-2 text-xs text-destructive">
                    {item.code}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ─── Defaults ─── */}
        <section id="defaults" className="border-t border-border">
          <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-20">
            <SectionHeading
              eyebrow="THE PRODUCT"
              title="Defaults that are not negotiable."
              lead="We don't sell the primitive: we sell the opinion. These rules ship from the factory and can't be turned off, because each one plugs a real hole."
            />
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  icon: ShieldCheck,
                  title: "Mandatory lifetime cap",
                  body: "A LIFETIME ceiling on top of the per-charge limit. A card without a total cap simply can't exist: structuring dies here.",
                },
                {
                  icon: Clock,
                  title: "A lifespan with automatic closure",
                  body: "Every card is born with a TTL. Past it, everything is declined. No subscription outlives its task.",
                },
                {
                  icon: Lock,
                  title: "Allowlist, not blacklist",
                  body: "The card only charges at the merchants you declared. Anything unlisted is declined by default.",
                },
                {
                  icon: Ban,
                  title: "Global kill switch",
                  body: "One button that stops everything, now. And when you mark the task as done, the card closes itself.",
                },
                {
                  icon: FileText,
                  title: "A receipt per charge",
                  body: "Agent, task, merchant, amount and the exact decision code. Approved or declined, you always know why.",
                },
                {
                  icon: Languages,
                  title: "Spanish-first",
                  body: "Errors, docs and onboarding in Spanish. Built for a solo dev in LATAM, not a finance team in the US.",
                },
              ].map((item) => (
                <article
                  key={item.title}
                  className="rounded-xl border border-border bg-card p-5"
                >
                  <span className="flex size-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
                    <item.icon className="size-4" aria-hidden="true" />
                  </span>
                  <h3 className="mt-4 text-base font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {item.body}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ─── How it works ─── */}
        <section id="how-it-works" className="border-t border-border">
          <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-20">
            <SectionHeading
              eyebrow="HOW IT WORKS"
              title="Three steps, and the policy always decides before the rail."
            />
            <ol className="mt-10 grid gap-4 md:grid-cols-3">
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
              ].map((step) => (
                <li
                  key={step.n}
                  className="flex flex-col rounded-xl border border-border bg-card p-5"
                >
                  <span className="num text-xs font-semibold text-accent">
                    {step.n}
                  </span>
                  <h3 className="mt-3 text-base font-semibold">{step.title}</h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                  <p className="num mt-4 break-words rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                    {step.code}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ─── Principles ─── */}
        <section id="principles" className="border-t border-border">
          <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-20">
            <SectionHeading eyebrow="PRINCIPLES" title="Three rules that don't break." />
            <div className="mt-10 space-y-0 divide-y divide-border rounded-xl border border-border bg-card">
              {[
                {
                  icon: Wallet,
                  title: "Your money is never mine.",
                  body: "No pool, no aggregated balance, no one-way withdrawals. Funds stay in your wallet; the limit is an on-chain allowance you can revoke whenever you want.",
                },
                {
                  icon: Lock,
                  title: "The PAN never touches our backend.",
                  body: "The card number goes straight from the issuer to the agent. If our server goes down or leaks, your card isn't in it.",
                },
                {
                  icon: ShieldCheck,
                  title: "DENY wins.",
                  body: "The decision lives outside the prompt and is evaluated server-side. There is no jailbreak that talks a policy into overspending.",
                },
              ].map((rule) => (
                <div key={rule.title} className="flex gap-4 p-5 md:items-start md:p-6">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                    <rule.icon className="size-4" aria-hidden="true" />
                  </span>
                  <div>
                    <h3 className="text-base font-semibold md:text-lg">{rule.title}</h3>
                    <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                      {rule.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── Honest status + final CTA ─── */}
        <section className="border-t border-border">
          <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-20">
            <div className="rounded-2xl border border-border bg-card p-6 md:p-10">
              <div className="max-w-2xl">
                <Chip tone="warning" dot={false}>
                  <FlaskConical className="size-3" aria-hidden="true" />
                  WHERE WE ARE, NO SMOKE
                </Chip>
                <h2 className="mt-4 text-2xl font-semibold tracking-tight md:text-3xl">
                  Today: a policy engine tested against a simulated issuer.
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground md:text-base">
                  The engine has tests and a harness that runs the attacks on
                  this page. What's next is measuring against the real world: a
                  USD 5 online charge on a KYC issuer, then the structuring test
                  with real money. If the bypass doesn't get through even with
                  the provider's permissive config, this product has no reason
                  to exist — and we'll say it right here.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <CtaLink href="/simulador.html">
                    <Play className="size-4" aria-hidden="true" />
                    Run the attacks yourself
                  </CtaLink>
                  <CtaLink
                    href="https://github.com/Tobiinsaurralde/agent-card"
                    variant="outline"
                    external
                  >
                    Follow the progress on GitHub
                  </CtaLink>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ─── Footer ─── */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 md:flex-row md:items-center md:justify-between md:px-6">
          <div className="flex items-center gap-2.5">
            <img
              src="/logo-light.png"
              alt=""
              className="size-7 rounded-md border border-border"
            />
            <span className="font-mono text-xs font-semibold">agent-card</span>
          </div>
          <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
            A control layer, not an issuer. The BIN, the bank and the KYC are
            bought from a provider; we decide whether the charge goes through.
          </p>
          <div className="flex gap-4 text-xs">
            <a
              href="/simulador.html"
              className={cx("rounded-sm text-accent underline-offset-2 hover:underline", focusRing)}
            >
              Simulator
            </a>
            <a
              href="https://github.com/Tobiinsaurralde/agent-card"
              target="_blank"
              rel="noreferrer"
              className={cx("rounded-sm text-accent underline-offset-2 hover:underline", focusRing)}
            >
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
