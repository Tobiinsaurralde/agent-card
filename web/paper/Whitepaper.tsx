import {
  Callout,
  Code,
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
 * El whitepaper es el documento que estamos dispuestos a que nos reclamen.
 * La regla editorial es una sola: separar lo vivo de lo prometido en cada
 * sección, nunca en una nota al pie.
 */

const TOC = [
  { id: "summary", label: "Executive summary" },
  { id: "problem", label: "The problem" },
  { id: "position", label: "What Konex is" },
  { id: "architecture", label: "Architecture" },
  { id: "threats", label: "Threat model" },
  { id: "live", label: "Live vs in development" },
  { id: "business", label: "Business model" },
  { id: "token", label: "The $KNX token" },
  { id: "risks", label: "Risks and open items" },
  { id: "roadmap", label: "Roadmap" },
  { id: "closing", label: "Closing note" },
];

export function Whitepaper() {
  return (
    <div className="min-h-screen overflow-x-clip">
      <SiteHeader current="whitepaper.html" />
      <main>
        <PageIntro
          tag="WHITEPAPER V0.1 · LIVING DOCUMENT"
          title={
            <>
              The spending control layer for{" "}
              <span className="display-accent">AI agents.</span>
            </>
          }
          lead={
            <>
              <p>
                An AI agent with a credit card is an employee with the cash
                drawer open. Konex is the layer that decides, before any charge
                reaches the payment rail, whether it goes through, against a
                policy the agent cannot negotiate.
              </p>
              <p>
                This document separates what is live and tested from what is in
                development, in every section. We think that distinction
                matters more than the pitch.
              </p>
            </>
          }
        />

        <ProseLayout toc={TOC}>
          <Section id="summary" title="1 · Executive summary">
            <p>
              Agents are starting to buy things: API credits, domains, SaaS
              seats, datasets. The cards they use come from issuers whose
              controls are primitives, not opinions: per-transaction limits,
              MCC filters, velocity windows, all of them optional. The risk
              lives in the configuration, and configuration is where people
              fail.
            </p>
            <p>
              Konex is a control layer over any card issuer. It exposes an MCP
              server to the agent with tools to request scoped cards and record
              charges, and it enforces defaults that cannot be turned off: a
              mandatory lifetime cap, a mandatory expiry, a merchant allowlist
              of one, and a receipt with the exact decision code for every
              charge, approved or declined.
            </p>
            <p>
              Today the engine is real, tested code running against a simulated
              issuer, plus a browser harness that has taken a real virtual card
              through a real merchant checkout to authorization. What remains
              is the issuer integration that turns the demo into a product, and
              we say plainly below what is blocking it.
            </p>
          </Section>

          <Section id="problem" title="2 · The problem">
            <p>
              Give an agent a normal virtual card with the typical
              configuration and three holes open immediately:
            </p>
            <Table
              head={["HOLE", "WHAT HAPPENS"]}
              rows={[
                [
                  "Structuring",
                  "A USD 10 per-charge cap with no cumulative cap: two USD 9 charges spend USD 18. The limit you configured limited nothing.",
                ],
                [
                  "Zombie subscription",
                  "The task ended a month ago, the card stayed alive, the SaaS renewed anyway, and it will renew again.",
                ],
                [
                  "Any merchant",
                  "The card was meant for API credits. Without an allowlist, nothing stops the same number from paying anywhere else.",
                ],
              ]}
            />
            <p>
              Issuers will not close these holes by default, and not out of
              incapacity: a provider optimizes for nothing breaking, so
              permissive configurations are legitimate options in their
              products. Some offer cards with no limits at all, spending
              directly against the account balance. We optimize for nothing
              escaping. That difference in incentive is the product.
            </p>
            <p>
              There is also a layer we explicitly do not compete with: network
              level agentic payments (Visa Intelligent Commerce, Mastercard
              Agent Pay) validate intent inside the network itself. That is
              unreachable for a small team, and unnecessary for the risk we
              cover: what leaks between the agent's intent and the issuer's
              permissive config.
            </p>
          </Section>

          <Section id="position" title="3 · What Konex is, and what it refuses to be">
            <p>
              Konex is a wrapper over an issuer, and this document says so
              without euphemism. The BIN, the bank, the KYC and the interchange
              belong to a licensed provider. What Konex owns:
            </p>
            <p>
              <strong>The decision.</strong> Every charge is evaluated server
              side against the card's policy before it reaches the rail. DENY
              wins, and the policy lives outside the agent's prompt.
            </p>
            <p>
              <strong>The defaults.</strong> A card cannot be requested without
              a lifetime cap and an expiry. There is no flag to turn them off
              and no tool to raise them later.
            </p>
            <p>
              <strong>The receipt.</strong> Agent, task, merchant, amount and a
              stable decision code, for every attempt, in plain language.
            </p>
            <p>What Konex refuses to be:</p>
            <p>
              <strong>An issuer.</strong> No BIN, no bank relationship, no PCI
              scope: the card number never touches our backend.
            </p>
            <p>
              <strong>A custodian.</strong> The design goal is funds that stay
              in the user's wallet under a revocable allowance. That part is
              not built, and today balances sit with the issuer, like every
              card program. We would rather write that here than have a user
              find out later.
            </p>
          </Section>

          <Section id="architecture" title="4 · Architecture">
            <H3>4.1 The MCP boundary</H3>
            <p>
              The agent talks to Konex through an MCP server over stdio. The
              interface is defined as much by what it lacks as by what it has:
              there is no deposit tool, no kill switch control, and nothing
              that loosens an issued card. Those verbs belong to the human, in
              the panel. The agent's identity comes from server configuration,
              never from a tool parameter, so one agent cannot spend another's
              budget.
            </p>
            <H3>4.2 The policy engine</H3>
            <p>
              A pure function evaluates every attempt against the card's
              policy and state: kill switch, task completion, closure, TTL,
              single-use, charge count, merchant, MCC, currency, per-charge
              cap, lifetime cap, in that order, most specific reason first.
              The first rule that declines wins and its code goes on the
              receipt.
            </p>
            <Code>{`evaluate(attempt, state, policy) -> { allow, code, reason }

// Deliberate choices inside:
// - refunds are never declined, but never free up margin (gross accounting)
// - a missing MCC declines a category-locked card, it does not pass
// - an unmatched auth/capture pair counts twice: overcounting is the safe error`}</Code>
            <H3>4.3 Credential delivery</H3>
            <p>
              <InlineCode>request_card</InlineCode> returns a handle. When the
              agent needs the number, it asks for a grant: an issuer endpoint
              plus a token that lives for one minute and works exactly once.
              The PAN travels issuer to agent. Konex sees neither the number
              nor the CVC, which keeps it out of PCI scope and out of the blast
              radius of its own breaches.
            </p>
            <H3>4.4 The ledger</H3>
            <p>
              Deposits, cards, receipts and the kill switch persist to an
              atomic, versioned file. A restart does not re-deposit budget and
              does not forget what was spent. A corrupt or version-mismatched
              ledger refuses to load rather than guess about money.
            </p>
            <H3>4.5 The checkout harness</H3>
            <p>
              Buying happens in a real browser driven over CDP: sessions with
              captcha solving, iframe-aware form filling, and outcome
              classification that reads the merchant's verdict instead of
              assuming success. This is the part that has already completed a
              real checkout flow against a production merchant with a real
              virtual card.
            </p>
          </Section>

          <Section id="threats" title="5 · Threat model">
            <Table
              head={["THREAT", "DEFENSE", "STATUS"]}
              rows={[
                [
                  "Prompt injection makes the agent overspend",
                  "The policy is evaluated server side and there is no tool that raises a limit. The injection can change what the agent wants, not what the policy allows.",
                  "Live, tested",
                ],
                [
                  "Structuring: many small charges",
                  "Mandatory lifetime cap on every card, on top of the per-charge cap.",
                  "Live, tested",
                ],
                [
                  "Zombie subscription",
                  "Mandatory TTL plus close-on-task-complete. Past either, everything declines.",
                  "Live, tested",
                ],
                [
                  "PAN leaks into a context window",
                  "Single-use cards die after the first approved charge; the allowlist means the number only ever worked at one merchant; close_card kills it now.",
                  "Live, tested",
                ],
                [
                  "Refund cycling: buy, refund, buy again",
                  "Gross spend accounting: refunds never free up margin.",
                  "Live, tested",
                ],
                [
                  "Currency hole: a USD cap, a EUR charge",
                  "Currency allowlist, USD by default. Other currencies decline.",
                  "Live, tested",
                ],
                [
                  "Agent impersonation",
                  "Identity comes from server config, never from tool parameters.",
                  "Live, tested",
                ],
                [
                  "A malicious or compromised issuer",
                  "Out of scope: Konex controls spending through the issuer, it does not audit the issuer. Choosing a licensed one is the mitigation.",
                  "Out of scope",
                ],
              ]}
            />
          </Section>

          <Section id="live" title="6 · What is live, what is in development">
            <H3>Live and tested</H3>
            <p>
              The policy engine, the MCP server with its eleven tools, the
              persistent ledger, the credential-grant mechanism, the browser
              checkout harness, and the public simulator that runs the real
              engine against a mock issuer in your browser. The test suite
              covers structuring, zombie subscriptions, refund cycling,
              persistence across restarts and PAN redaction, and runs on every
              deploy of this site.
            </p>
            <H3>In development</H3>
            <p>
              <strong>Licensed issuer integration.</strong> The blocker is
              access: our current issuer has no public API, so issuance
              automation and account provisioning are being worked out with
              them directly. One real approved online charge through the full
              stack is the milestone that closes this.
            </p>
            <p>
              <strong>Non-custodial funding.</strong> Funds that stay in the
              user's wallet under a revocable on-chain allowance, so the
              budget ceiling is enforced by the chain and not by trust in us.
              Designed, not built.
            </p>
            <p>
              <strong>$KNX.</strong> Token model designed, contract not
              deployed. Section 8.
            </p>
          </Section>

          <Section id="business" title="7 · Business model">
            <p>
              A flat fee per agent per month, aimed at a solo developer or a
              small team. The interchange belongs to the issuer and we do not
              touch it. We explicitly avoid taking a spread on funding: it is
              the closest path to becoming a money transmitter, which section 3
              refuses.
            </p>
            <p>
              The moat is not technical, and we prefer to admit it: an issuer
              could ship opinionated defaults tomorrow. Their incentives point
              the other way, and ours is a product for people the incumbents
              are not building for: agent developers who want the card to say
              no, in words they can read.
            </p>
          </Section>

          <Section id="token" title="8 · The $KNX token">
            <Callout tone="danger" title="NOT DEPLOYED · DO NOT BUY ANYTHING CLAIMING TO BE $KNX">
              <p>
                There is no $KNX contract on any chain today. No address, no
                presale, no allocation. Any token trading under this name is
                fake. When a contract exists, its address will be published on
                the tokenomics page of this site and nowhere else first.
              </p>
            </Callout>
            <p>
              $KNX is the planned utility token of the Konex layer, designed
              for Solana. Its role is to tie the token to real usage of the
              control layer: a share of protocol fees buys $KNX on market,
              part of the per-card fee burns it, and staking unlocks higher
              account ceilings. It is deliberately not required for basic use,
              it never custodies user funds, and it carries no governance at
              launch. The full model, including everything that is not yet
              decided, lives on the{" "}
              <a className="text-accent underline-offset-4 hover:underline" href="tokenomics.html">
                tokenomics page
              </a>
              .
            </p>
          </Section>

          <Section id="risks" title="9 · Risks and open items">
            <p>We would rather list these than have someone else find them:</p>
            <p>
              <strong>The issuer integration is not closed.</strong> Our
              current issuer has no public API and its card-not-present
              reliability is not fully proven: our own measurement reached
              authorization at a real checkout, but a fully approved charge is
              still the open milestone.
            </p>
            <p>
              <strong>Funds at the issuer are commingled.</strong> Deposits
              pool into an omnibus issuer account with one-way withdrawals.
              This directly conflicts with our non-custodial goal and is the
              main reason that goal exists.
            </p>
            <p>
              <strong>Card economics per task.</strong> A fixed issuance fee
              per card plus one-way withdrawals means ephemeral per-task cards
              carry a fixed cost and a stranded remainder. The pricing model
              has to absorb that honestly.
            </p>
            <p>
              <strong>No independent security audit yet.</strong> The engine
              has tests, not an audit. An audit precedes any version of this
              that touches meaningful money.
            </p>
            <p>
              <strong>No technical moat.</strong> If an incumbent ships good
              defaults in our niche, this product loses its reason. We watch
              for that instead of pretending it cannot happen.
            </p>
            <p>
              <strong>$KNX is undeployed.</strong> Every mechanism in section 8
              is design, not code. The scam-token risk exists from the moment
              this page is public, which is why the warning is printed above.
            </p>
          </Section>

          <Section id="roadmap" title="10 · Roadmap">
            <Table
              head={["#", "MILESTONE"]}
              rows={[
                ["01", "First real approved online charge through the full stack, on a licensed issuer."],
                ["02", "The structuring and zombie-subscription tests with real money, published with their receipts."],
                ["03", "Issuer integration generally available: request_card issues a real card."],
                ["04", "Non-custodial funding: on-chain allowance in the user's wallet."],
                ["05", "Independent security audit."],
                ["06", "$KNX contract deployment on Solana, address published here first."],
              ]}
            />
          </Section>

          <Section id="closing" title="11 · Closing note">
            <p>
              This whitepaper reflects where Konex actually is, not where we
              would like to be perceived to be. Some of what is described is
              live and testable today in the simulator; some is design. We
              intend to keep the distinction visible as facts change, because
              a spending control product that inflates its own claims has
              disqualified itself.
            </p>
            <p className="text-sm text-muted-foreground">
              This document is for informational purposes only and is not
              financial, legal or investment advice. Digital assets carry
              risk, including total loss. Nothing here is a guarantee of
              future performance, security or regulatory compliance.
            </p>
          </Section>
        </ProseLayout>
      </main>
      <SiteFooter />
    </div>
  );
}
