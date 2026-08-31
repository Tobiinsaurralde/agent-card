import type { ReactNode } from "react";
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
 * La documentación es la referencia de lo que existe, no de lo que va a
 * existir: cada tool listada acá está registrada en src/mcp/server.ts y cada
 * default sale de src/defaults.ts. Si esto se desvía del código, gana el
 * código y esta página está mal.
 */

const TOC = [
  { id: "what", label: "What Konex is" },
  { id: "status", label: "Current status" },
  { id: "start", label: "Getting started" },
  { id: "flow", label: "The flow" },
  { id: "tools", label: "Tool reference" },
  { id: "defaults", label: "Safe defaults" },
  { id: "codes", label: "Decision codes" },
  { id: "security", label: "Security model" },
  { id: "pricing", label: "Pricing" },
  { id: "faq", label: "FAQ" },
];

function ToolDoc({
  name,
  summary,
  params,
  children,
}: {
  name: string;
  summary: string;
  params?: Array<[string, string]>;
  children?: ReactNode;
}) {
  return (
    <article className="shadow-soft rounded-xl border border-foreground/20 bg-card p-5">
      <h4 className="num text-sm font-semibold text-accent">{name}</h4>
      <p className="mt-2 text-sm leading-relaxed text-foreground/85">{summary}</p>
      {params !== undefined && params.length > 0 && (
        <dl className="mt-3 space-y-1.5 border-t border-border pt-3">
          {params.map(([param, desc]) => (
            <div key={param} className="grid gap-1 text-[13px] sm:grid-cols-[190px_1fr]">
              <dt className="num text-muted-foreground">{param}</dt>
              <dd className="leading-relaxed">{desc}</dd>
            </div>
          ))}
        </dl>
      )}
      {children}
    </article>
  );
}

export function Docs() {
  return (
    <div className="min-h-screen overflow-x-clip">
      <SiteHeader current="/docs/" />
      <main>
        <PageIntro
          tag="DOCS"
          title={
            <>
              One MCP server. Eleven tools. Every card{" "}
              <span className="display-accent">scoped.</span>
            </>
          }
          lead={
            <p>
              Konex is a control layer for the virtual cards AI agents use to
              shop. Your agent talks to it over MCP: it asks for a card scoped
              to one task, one merchant and one budget, and every charge gets
              decided server side, with the exact reason on the receipt.
            </p>
          }
        />

        <ProseLayout toc={TOC}>
          <Section id="what" title="What Konex is, and is not">
            <p>
              Konex sits between your agent and a card issuer. It is not an
              issuer: the BIN, the bank account and the KYC belong to a
              licensed provider. What Konex owns is the decision. Before any
              charge reaches the payment rail, the policy you defined gets
              evaluated outside the agent's prompt, and DENY always wins.
            </p>
            <p>
              The product is the opinion, not the primitive. Card providers
              give you per-transaction limits, MCC filters and velocity
              windows, and let you configure all of them off. Konex refuses to:
              a card without a lifetime cap or an expiry cannot be requested
              here, and there is no tool to raise a limit after issuance.
            </p>
          </Section>

          <Section id="status" title="Current status">
            <Callout tone="warning" title="WHERE WE ARE, NO SMOKE">
              <p>
                The policy engine, the MCP server and the ledger are real,
                tested code. The issuer behind them today is simulated: no real
                money moves through the public demo. Integrating a licensed
                KYC issuer is the current work, and this page will say so
                plainly when that changes.
              </p>
            </Callout>
          </Section>

          <Section id="start" title="Getting started">
            <p>
              The server runs locally and speaks MCP over stdio, so it plugs
              into any MCP client: Claude Desktop, Cursor, or your own agent
              loop.
            </p>
            <Code>{`git clone https://github.com/Tobiinsaurralde/agent-card
cd agent-card
npm install
npm run mcp`}</Code>
            <p>Or wire it straight into your MCP client config:</p>
            <Code>{`{
  "mcpServers": {
    "konex": {
      "command": "node",
      "args": ["--import", "tsx", "src/mcp/bin.ts"],
      "cwd": "/path/to/agent-card",
      "env": {
        "AGENT_CARD_AGENT_ID": "my-agent",
        "AGENT_CARD_BUDGET_USD": "20"
      }
    }
  }
}`}</Code>
            <Table
              head={["VARIABLE", "DEFAULT", "WHAT IT DOES"]}
              rows={[
                [
                  <InlineCode key="k">AGENT_CARD_AGENT_ID</InlineCode>,
                  "required",
                  "Identity of the agent. Comes from config, never from a tool call, so an agent cannot spend another agent's budget.",
                ],
                [
                  <InlineCode key="k">AGENT_CARD_BUDGET_USD</InlineCode>,
                  "20",
                  "Total budget deposited on first run. The agent cannot deposit more: there is no tool for it.",
                ],
                [
                  <InlineCode key="k">AGENT_CARD_MAX_CARD_USD</InlineCode>,
                  "20",
                  "Ceiling for any single card, regardless of what the agent asks for.",
                ],
                [
                  <InlineCode key="k">AGENT_CARD_STATE</InlineCode>,
                  "~/.agent-card/state.json",
                  "Where the ledger lives. Deposits, cards and receipts survive restarts; budgets are not re-deposited.",
                ],
              ]}
            />
          </Section>

          <Section id="flow" title="The flow">
            <p>A normal task runs through six calls:</p>
            <Code>{`get_budget            how much is available
request_card          returns a handle, never a number
get_card_credentials  short-lived token, PAN goes issuer -> agent
check_charge          free preflight: would this pass?
record_charge         the policy decides, a receipt is written
complete_task         closes every card the task opened`}</Code>
            <p>
              Two things are deliberate. The card number never appears in a
              tool result: <InlineCode>request_card</InlineCode> returns a
              handle, and the PAN travels from the issuer to the agent with a
              one-shot token. And <InlineCode>complete_task</InlineCode> is not
              optional bookkeeping: it is what kills the card, so no
              subscription outlives the task that created it.
            </p>
          </Section>

          <Section id="tools" title="Tool reference">
            <div className="space-y-4">
              <ToolDoc
                name="get_budget"
                summary="How much money there is to spend. `available` is what can be committed to new cards; `committed` is budget on live cards that has not been spent yet but could be. The agent cannot deposit: that is the human's job, from the panel."
              />
              <ToolDoc
                name="request_card"
                summary="Issues a virtual card for one concrete task. Returns a handle, never the number. The amount is the lifetime cap of the card: past it everything is declined, even small charges. `merchant` is an allowlist of one."
                params={[
                  ["amount_usd", "Lifetime cap in dollars. The total ceiling, not the per-charge ceiling. Required."],
                  ["merchant", "The only merchant this card can charge at. Required."],
                  ["task_id", "The task that originates the card. Goes on every receipt. Required."],
                  ["reason", "What it is for, one line. Kept on the receipt."],
                  ["per_charge_usd", "Cap per individual charge. Defaults to the full budget in one charge."],
                  ["ttl_hours", "Hours to live. Defaults to 24."],
                  ["single_use", "If true, the card dies after the first approved charge."],
                ]}
              />
              <ToolDoc
                name="get_card_credentials"
                summary="Returns an issuer endpoint and a short-lived token so the agent redeems the card number directly with the issuer. The PAN does not pass through the Konex server. The token expires in one minute and works once."
                params={[["handle", "The card handle from request_card."]]}
              />
              <ToolDoc
                name="check_charge"
                summary="Preflight: says whether a charge would pass the policy, without charging and without leaving a trace. Free to call. If it would decline, it tells you the exact code before you waste the attempt."
                params={[
                  ["handle", "The card handle."],
                  ["amount_usd", "Amount to test."],
                  ["merchant", "Defaults to the card's merchant."],
                  ["currency", "ISO 4217, defaults to USD. A USD cap does not limit another currency."],
                ]}
              />
              <ToolDoc
                name="record_charge"
                summary="Records a charge against the card: the policy decides, the issuer responds, and a receipt is written. A decline is not an error; it is an answer with a reason."
                params={[
                  ["handle", "The card handle."],
                  ["amount_usd", "Amount charged."],
                  ["merchant", "Defaults to the card's merchant."],
                  ["currency", "ISO 4217, defaults to USD."],
                ]}
              />
              <ToolDoc
                name="card_status"
                summary="State, spent, remaining and the reason for the last decline. If something did not go through, this is where the why lives."
                params={[["handle", "The card handle."]]}
              />
              <ToolDoc
                name="list_cards"
                summary="Cards issued by this agent, newest first. Filter by task or only active ones. Scoped to the calling agent."
                params={[
                  ["task_id", "Only cards for this task."],
                  ["only_active", "Only cards that can still charge."],
                ]}
              />
              <ToolDoc
                name="list_charges"
                summary="Receipts with the exact reason behind every decision, newest first. Declines included, because they are the useful part when something went wrong."
                params={[
                  ["handle", "Only charges on this card."],
                  ["task_id", "Only charges for this task."],
                  ["only_approved", "Hide declines."],
                ]}
              />
              <ToolDoc
                name="open_checkout"
                summary="Opens a browser session for the card's merchant, with captcha solving and a residential proxy already on. Connect over CDP to `connect_url` and close the session when done."
                params={[["handle", "The card handle."]]}
              />
              <ToolDoc
                name="complete_task"
                summary="Marks the task as done and closes its cards. Call it at the end, always: a card that survives its task is a subscription that keeps charging. It cannot be undone, on purpose."
                params={[["task_id", "The same task used in request_card."]]}
              />
              <ToolDoc
                name="close_card"
                summary="Closes a card now. After this, everything is declined. Use it if you suspect the number leaked or the purchase was cancelled."
                params={[["handle", "The card handle."]]}
              />
            </div>
            <H3>What is deliberately missing</H3>
            <p>
              There is no <InlineCode>deposit</InlineCode>, no{" "}
              <InlineCode>kill_all</InlineCode>, no{" "}
              <InlineCode>release_kill</InlineCode>, and nothing that loosens a
              limit on an issued card. An agent that can fund itself has no
              budget, and a kill switch an agent can turn off is decoration.
              Those controls exist, but they belong to the human, in the panel.
            </p>
          </Section>

          <Section id="defaults" title="Safe defaults">
            <p>
              Every card born through <InlineCode>request_card</InlineCode>{" "}
              carries these, and none of them can be turned off:
            </p>
            <Table
              head={["DEFAULT", "VALUE", "WHY IT EXISTS"]}
              rows={[
                [
                  "Lifetime cap",
                  "= the requested amount, mandatory",
                  "The only defense against structuring: many small charges under the per-charge cap.",
                ],
                [
                  "TTL with auto-close",
                  "24 h unless you say otherwise",
                  "The only defense against the zombie subscription. Past the TTL, everything declines.",
                ],
                [
                  "Merchant allowlist",
                  "exactly one merchant",
                  "A card meant for API credits cannot pay anywhere else. Allowlist, never blacklist.",
                ],
                [
                  "Currency lock",
                  "USD unless you say otherwise",
                  "A USD cap does not limit a charge in another currency, so other currencies decline.",
                ],
                [
                  "Gross spend accounting",
                  "refunds do not free up margin",
                  "Without it, buy - refund - buy again spends past the cap.",
                ],
                [
                  "Close on task complete",
                  "always",
                  "complete_task kills the card. Nothing outlives its purpose.",
                ],
              ]}
            />
          </Section>

          <Section id="codes" title="Decision codes">
            <p>
              Every decision carries a stable code, so an agent can branch
              without parsing prose. These are all of them:
            </p>
            <Table
              head={["CODE", "MEANING"]}
              rows={[
                [<InlineCode key="c">ALLOWED</InlineCode>, "Inside the policy. The charge passes."],
                [<InlineCode key="c">KILL_SWITCH</InlineCode>, "The global kill switch is on. Only the human can release it."],
                [<InlineCode key="c">TASK_COMPLETE</InlineCode>, "The task that scoped this card is done."],
                [<InlineCode key="c">CARD_CLOSED</InlineCode>, "The card was closed explicitly."],
                [<InlineCode key="c">EXPIRED</InlineCode>, "The card outlived its TTL."],
                [<InlineCode key="c">SINGLE_USE_CONSUMED</InlineCode>, "Single-use card, already spent. If the PAN leaked into a context window, it stops working here."],
                [<InlineCode key="c">MAX_CHARGES_REACHED</InlineCode>, "The approved-charge count hit its maximum."],
                [<InlineCode key="c">MERCHANT_NOT_ALLOWED</InlineCode>, "The merchant is not on the allowlist."],
                [<InlineCode key="c">MCC_NOT_ALLOWED</InlineCode>, "The category is not on the allowlist, or the MCC is missing. Missing declines: an absent MCC is the hole in category locks."],
                [<InlineCode key="c">CURRENCY_NOT_ALLOWED</InlineCode>, "The charge is in a currency the card does not allow."],
                [<InlineCode key="c">PER_TX_EXCEEDED</InlineCode>, "One charge over the per-transaction cap."],
                [<InlineCode key="c">LIFETIME_EXCEEDED</InlineCode>, "The accumulated total would pass the lifetime cap."],
              ]}
            />
            <p>
              Refunds are never declined: money coming back is not a risk.
              But with gross accounting, a refund does not free up margin to
              spend again.
            </p>
          </Section>

          <Section id="security" title="Security model">
            <H3>The PAN never touches the Konex backend</H3>
            <p>
              The card number goes from the issuer to the agent with a
              one-shot, short-lived token. If the Konex server goes down or
              leaks, your card is not in it, and Konex stays out of PCI scope.
            </p>
            <H3>DENY wins, outside the prompt</H3>
            <p>
              The policy is evaluated server side. A prompt injection can make
              an agent <em>want</em> to overspend; it cannot make the policy
              agree. There is no tool that raises a limit, so there is nothing
              to jailbreak toward.
            </p>
            <H3>Identity comes from config</H3>
            <p>
              The agent id is set when the server starts, never accepted as a
              parameter. An agent cannot claim to be another agent and spend
              that budget, and receipts and card lists are scoped to the caller.
            </p>
            <H3>Overcounting is the safe direction</H3>
            <p>
              When an auth and its capture cannot be matched, both count
              against the cap. In a spending control, counting twice is the
              cheap error; counting zero times is the expensive one.
            </p>
          </Section>

          <Section id="pricing" title="Pricing">
            <Callout tone="warning" title="NOT FOR SALE YET">
              <p>
                Nothing here is checkout. Konex starts charging the month a
                real issuer is live and <InlineCode>request_card</InlineCode>{" "}
                opens a real card. Until then the simulator and this MCP stay
                free.
              </p>
            </Callout>
            <p>
              We sell the control layer, not the card. The interchange and the
              issuance fee belong to the issuer. We do not take a cut of what
              the agent spends.
            </p>
            <Table
              head={["PLAN", "PRICE", "WHO IT IS FOR"]}
              rows={[
                [
                  "Simulator",
                  "Free, stays free",
                  "Anyone. The public panel and this MCP against a mock issuer.",
                ],
                [
                  "Solo",
                  "USD 29 / agent / month",
                  "A builder with one agent. This is v1, the only paid plan at launch.",
                ],
                [
                  "Team",
                  "USD 79 / workspace / month",
                  "Up to 5 agents on one ledger. Not v1. We ship it when someone asks twice.",
                ],
              ]}
            />
            <H3>What Solo includes</H3>
            <Table
              head={["INCLUDED", "NOT INCLUDED"]}
              rows={[
                [
                  "One agent identity, set in config, not by the agent",
                  "Card issuance fees. Those are the issuer's, today ~USD 5 a card if that is still their price",
                ],
                [
                  "The eleven MCP tools, the ledger, receipts and the kill switch",
                  "The money the agent spends. That sits with the issuer. We never hold it",
                ],
                [
                  "Mandatory lifetime cap, TTL, allowlist and all the other defaults that cannot be turned off",
                  "A Steel or browser quota. Bring your own checkout session, or run Chrome locally",
                ],
                [
                  "The panel: budget, cards, receipts, kill",
                  "Raising a limit after issuance. There is no SKU for that, on purpose",
                ],
                [
                  "Support from the person who wrote it, over email or Telegram",
                  "Reseller KYC. v1 is bring-your-own issuer account",
                ],
              ]}
            />
            <p>
              Cards are not metered by us. The ceiling is the budget you
              deposited with the issuer and the lifetime cap on each card. If
              the issuer charges per card, that bill is yours, not bundled
              into the 29.
            </p>
          </Section>

          <Section id="faq" title="FAQ">
            <H3>Do you issue cards?</H3>
            <p>
              No. A licensed issuer opens the card; Konex decides whether each
              charge goes through. We never hold the BIN, the bank relationship
              or your KYC.
            </p>
            <H3>Is real money moving today?</H3>
            <p>
              Not in the public demo. The engine is real and tested; the issuer
              behind the demo is simulated. Watch the status section above:
              when a real issuer is live, it will say so here first.
            </p>
            <H3>Can the agent raise its own limit?</H3>
            <p>
              No. There is no tool to do it, and the policy is evaluated
              outside the prompt. The ceiling you set is the ceiling.
            </p>
            <H3>What happens if the agent leaks the card number?</H3>
            <p>
              Request the card with <InlineCode>single_use</InlineCode> and it
              dies after the first approved charge. Or{" "}
              <InlineCode>close_card</InlineCode> the moment you suspect a
              leak. Either way, the allowlist means the number only ever worked
              at one merchant.
            </p>
            <H3>How much does it cost?</H3>
            <p>
              The simulator is free. When a real issuer is live, Solo is USD
              29 per agent per month. There is no checkout for that today.
              Details are in the pricing section above.
            </p>
            <H3>Is there a token?</H3>
            <p>
              There is a designed token model, $KNX on Solana, and no deployed
              contract. Anything trading as KNX today is fake. The model and
              its status live on the <a className="text-accent underline-offset-4 hover:underline" href="/tokenomics/">tokenomics page</a>.
            </p>
          </Section>
        </ProseLayout>
      </main>
      <SiteFooter />
    </div>
  );
}
