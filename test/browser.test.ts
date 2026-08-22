import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CaptchaFailedError,
  MockBrowser,
  SteelBrowser,
  type SteelCaptchaPage,
  type SteelSessionPayload,
  type SteelTransport,
} from "../src/browser.js";

class FakeSteel implements SteelTransport {
  created: Array<{ solveCaptcha: boolean; useProxy: boolean }> = [];
  released: string[] = [];
  polls = 0;
  pages: SteelCaptchaPage[][] = [];

  async createSession(body: {
    solveCaptcha: boolean;
    useProxy: boolean;
  }): Promise<SteelSessionPayload> {
    this.created.push(body);
    return {
      id: "sess_1",
      sessionViewerUrl: "https://app.steel.dev/sessions/sess_1",
      websocketUrl: "wss://connect.steel.dev?sessionId=sess_1",
    };
  }

  async captchaStatus(): Promise<SteelCaptchaPage[]> {
    const next = this.pages[this.polls] ?? this.pages.at(-1) ?? [];
    this.polls += 1;
    return next;
  }

  async release(sessionId: string): Promise<void> {
    this.released.push(sessionId);
  }
}

function page(overrides: Partial<SteelCaptchaPage> = {}): SteelCaptchaPage {
  return {
    pageId: "page_1",
    url: "https://shop.example/checkout",
    isSolvingCaptcha: false,
    tasks: [],
    ...overrides,
  };
}

test("Steel abre la sesión con captcha y proxy prendidos", async () => {
  const steel = new FakeSteel();
  const browser = new SteelBrowser(steel, "test-key");
  const session = await browser.open({ merchant: "api-credits", taskId: "task-1" });

  assert.equal(browser.name, "steel");
  assert.deepEqual(steel.created, [{ solveCaptcha: true, useProxy: true }]);
  assert.equal(session.id, "sess_1");
  assert.equal(session.viewerUrl, "https://app.steel.dev/sessions/sess_1");
  assert.match(session.connectUrl ?? "", /sess_1/);

  await session.close();
  assert.deepEqual(steel.released, ["sess_1"]);
});

test("espera el captcha y lo anota en el recibo cuando Steel lo resuelve", async () => {
  const steel = new FakeSteel();
  steel.pages = [
    [
      page({
        isSolvingCaptcha: true,
        tasks: [
          {
            id: "task_cap_1",
            type: "turnstile",
            status: "solving",
            url: "https://shop.example/checkout",
          },
        ],
      }),
    ],
    [
      page({
        isSolvingCaptcha: false,
        tasks: [
          {
            id: "task_cap_1",
            type: "turnstile",
            status: "solved",
            url: "https://shop.example/checkout",
            totalDuration: 2400,
          },
        ],
      }),
    ],
  ];

  const session = await new SteelBrowser(steel, "test-key").open({
    merchant: "api-credits",
    taskId: "buy-credits",
  });
  const events = await session.waitForCaptcha({ pollMs: 1, timeoutMs: 200 });

  assert.equal(events.length, 1);
  assert.equal(events[0]?.status, "solved");
  assert.equal(events[0]?.kind, "turnstile");
  assert.equal(events[0]?.merchant, "api-credits");
  assert.equal(events[0]?.taskId, "buy-credits");
  assert.equal(events[0]?.durationMs, 2400);
  assert.equal(session.events().length, 1);
});

test("si no hay captcha, sigue de largo", async () => {
  const steel = new FakeSteel();
  steel.pages = [[page()]];
  const session = await new SteelBrowser(steel, "test-key").open({
    merchant: "api-credits",
  });
  const events = await session.waitForCaptcha({ pollMs: 1, timeoutMs: 50 });
  assert.deepEqual(events, []);
});

test("un captcha fallido corta y no se reintenta", async () => {
  const steel = new FakeSteel();
  steel.pages = [
    [
      page({
        tasks: [
          {
            id: "task_cap_fail",
            type: "recaptchaV2",
            status: "failed_to_solve",
          },
        ],
      }),
    ],
  ];
  const session = await new SteelBrowser(steel, "test-key").open({
    merchant: "api-credits",
  });
  await assert.rejects(
    () => session.waitForCaptcha({ pollMs: 1, timeoutMs: 50 }),
    CaptchaFailedError,
  );
  assert.equal(session.events()[0]?.status, "failed");
});

test("MockBrowser resuelve sin API key", async () => {
  const browser = new MockBrowser();
  const session = await browser.open({ merchant: "api-credits", taskId: "t1" });
  const events = await session.waitForCaptcha();
  assert.equal(events[0]?.status, "solved");
  assert.equal(events[0]?.merchant, "api-credits");
  await session.close();
});

test("fromEnv exige STEEL_API_KEY", () => {
  assert.throws(() => SteelBrowser.fromEnv({}), /STEEL_API_KEY/);
});
