import type { ReactNode } from "react";
import { Coins, Flame, Lock, ShieldCheck } from "lucide-react";
import {
  Callout,
  H3,
  InlineCode,
  PageIntro,
  ProseLayout,
  Section,
  SiteFooter,
  SiteHeader,
  Table,
} from "../site/chrome.js";

/**
 * La página del token se publica antes que el token, y eso crea el riesgo que
 * la página misma tiene que desactivar: en cuanto exista "$KNX" como nombre
 * público van a aparecer contratos falsos. Por eso el aviso de no-deployado
 * no es un footer legal: es el primer bloque, en rojo, arriba de todo.
 */

const TOC = [
  { id: "status", label: "Status: not deployed" },
  { id: "design", label: "Design principles" },
  { id: "mechanisms", label: "The three mechanisms" },
  { id: "not", label: "What $KNX does not do" },
  { id: "undecided", label: "Not decided yet" },
  { id: "verify", label: "How to verify" },
];

function Mechanism({
  icon,
  tag,
  title,
  body,
  facts,
}: {
  icon: ReactNode;
  tag: string;
  title: string;
  body: string;
  facts: Array<[string, string]>;
}) {
  return (
    <article className="shadow-soft rounded-xl border border-foreground/20 bg-card p-6">
      <div className="flex items-center justify-between">
        <span className="flex size-10 items-center justify-center rounded-md bg-gold-soft text-gold">
          {icon}
        </span>
        <span className="rounded-md border border-border px-2 py-1 font-mono text-[10px] font-semibold tracking-[0.16em] text-muted-foreground">
          {tag}
        </span>
      </div>
      <h3 className="font-display mt-5 text-2xl">{title}</h3>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{body}</p>
      <dl className="mt-4 space-y-2 border-t border-border pt-4">
        {facts.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-4">
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="num text-xs font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

export function Tokenomics() {
  return (
    <div className="min-h-screen overflow-x-clip">
      <SiteHeader current="tokenomics.html" />
      <main>
        <PageIntro
          tag="$KNX · TOKEN MODEL"
          title={
            <>
              A token tied to usage, published{" "}
              <span className="display-accent">before it exists.</span>
            </>
          }
          lead={
            <p>
              $KNX is the planned utility token of the Konex control layer,
              designed for Solana. This page is the design we intend to ship
              and the record we are willing to be held to. It is published
              before deployment on purpose, so there is exactly one source of
              truth about what is real.
            </p>
          }
        />

        <ProseLayout toc={TOC}>
          <Section id="status" title="Status: designed, not deployed">
            <Callout tone="danger" title="THERE IS NO $KNX CONTRACT · ANYTHING TRADING AS KNX TODAY IS FAKE">
              <p>
                No contract has been deployed on Solana or any other chain. No
                address, no presale, no airdrop, no allocation, nothing to buy.
                If you see a token named KNX or Konex anywhere, it is not ours.
              </p>
              <p>
                When the contract exists, its address will be published on this
                page and on the official Konex accounts before anywhere else.
                Verify here first, always.
              </p>
            </Callout>
            <Table
              head={["FIELD", "VALUE"]}
              rows={[
                ["Ticker", <InlineCode key="v">$KNX</InlineCode>],
                ["Chain", "Solana"],
                ["Contract", "none · not deployed"],
                ["Supply", "not defined · see below"],
                ["Governance", "none at launch"],
              ]}
            />
          </Section>

          <Section id="design" title="Design principles">
            <p>
              <strong>Usage is the only engine.</strong> Every mechanism below
              is fed by real activity on the control layer: fees actually paid,
              cards actually issued. No emissions schedule, no rewards for
              holding still.
            </p>
            <p>
              <strong>The token is never in the money path.</strong> $KNX does
              not custody user funds, does not back card balances, and is not
              what your agent spends. Konex's first principle, your money
              should never be mine, applies to the token too.
            </p>
            <p>
              <strong>Optional for users, structural for the protocol.</strong>{" "}
              Konex works without holding $KNX. The token buys headroom, not
              access.
            </p>
          </Section>

          <Section id="mechanisms" title="The three mechanisms">
            <div className="grid gap-4">
              <Mechanism
                icon={<Coins className="size-5" aria-hidden="true" />}
                tag="BUYBACK"
                title="Protocol fees buy $KNX back."
                body="Konex charges a flat fee per agent per month. A fixed share of that revenue buys $KNX on the open market. The link between product usage and token demand is fee revenue, not narrative."
                facts={[
                  ["Source", "subscription fees"],
                  ["Share", "to be published at deploy"],
                  ["Destination", "market buyback"],
                ]}
              />
              <Mechanism
                icon={<Flame className="size-5" aria-hidden="true" />}
                tag="BURN"
                title="Part of every card fee burns."
                body="Each scoped card issued through the layer carries a small fee, and a share of it is used to burn $KNX. More tasks, more cards, less supply. Burns will be verifiable on-chain from day one."
                facts={[
                  ["Source", "per-card fee"],
                  ["Destination", "burn, verifiable on-chain"],
                  ["Cadence", "per issuance"],
                ]}
              />
              <Mechanism
                icon={<Lock className="size-5" aria-hidden="true" />}
                tag="STAKING"
                title="Staking raises your ceilings."
                body="Staking $KNX in a non-custodial vault unlocks higher account budgets and more concurrent cards. The protocol reads your stake; it never holds it. Locked supply is supply off the market, and the unlock is headroom, never a bypass: every card keeps its mandatory cap and TTL."
                facts={[
                  ["Custody", "non-custodial"],
                  ["Protocol access", "read-only"],
                  ["Unlocks", "higher ceilings, never fewer controls"],
                ]}
              />
            </div>
          </Section>

          <Section id="not" title="What $KNX does not do">
            <p>
              <strong>It does not hold your money.</strong> Card budgets and
              deposits are never denominated in, backed by, or routed through
              $KNX.
            </p>
            <p>
              <strong>It does not weaken the policy.</strong> No amount of
              stake removes a lifetime cap, an expiry or an allowlist. Staking
              raises how much you can put under control, not how much escapes
              it.
            </p>
            <p>
              <strong>It does not vote, yet.</strong> No governance at launch.
              Introducing governance before there are enough real, distributed
              users is theater, and we would rather sequence it honestly.
            </p>
            <p>
              <strong>It is not an investment promise.</strong> Nothing on this
              page is a guarantee of price, liquidity or listing. The
              mechanisms tie the token to usage; they do not manufacture
              demand that usage does not create.
            </p>
          </Section>

          <Section id="undecided" title="What is not decided yet">
            <p>
              Rather than publish numbers we would have to walk back, here is
              the honest list of open parameters:
            </p>
            <Table
              head={["PARAMETER", "STATUS"]}
              rows={[
                ["Total supply and initial distribution", "not defined"],
                ["Exact buyback share of fee revenue", "not defined"],
                ["Per-card fee amount and burn share", "not defined"],
                ["Staking tiers and the ceilings they unlock", "not defined"],
                ["Launch mechanism and date", "not defined"],
              ]}
            />
            <p>
              Each of these will be filled in on this page before deployment,
              with the reasoning, not just the number. If a mechanism above
              changes between now and deploy, the change gets flagged here
              rather than silently edited.
            </p>
          </Section>

          <Section id="verify" title="How to verify, when the time comes">
            <H3>The only valid sources</H3>
            <p>
              This page, and the official Konex accounts linked from this
              site. A contract address that does not appear here is not $KNX,
              no matter who shares it or how legitimate the announcement looks.
            </p>
            <H3>What launch will look like</H3>
            <p>
              The address published here first. Burns verifiable on-chain from
              the first card fee. The buyback wallet public and trackable. If
              any of those three is missing at launch, treat it as a red flag,
              including from us.
            </p>
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                Nothing on this page is financial advice. Digital assets carry
                risk, including total loss. $KNX does not exist yet; do not
                let anyone sell it to you.
              </span>
            </p>
          </Section>
        </ProseLayout>
      </main>
      <SiteFooter />
    </div>
  );
}
