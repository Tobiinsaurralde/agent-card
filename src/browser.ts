import type { CaptchaEvent, CaptchaKind, CaptchaTaskStatus } from "./types.js";

const STEEL_API = "https://api.steel.dev";

/**
 * El browser que usa el agente para llegar al checkout. El captcha se resuelve
 * acá, no en el MCP ni en la policy.
 */
export interface CheckoutBrowser {
  readonly name: string;
  open(opts: OpenCheckoutOpts): Promise<CheckoutSession>;
}

export interface OpenCheckoutOpts {
  merchant: string;
  taskId?: string;
  /** Proxy residencial. Default: sí. */
  useProxy?: boolean;
}

export interface CheckoutSession {
  readonly id: string;
  readonly merchant: string;
  /** Para conectar Playwright/Puppeteer. */
  readonly connectUrl: string | null;
  /** Viewer en vivo de Steel. */
  readonly viewerUrl: string | null;
  /**
   * Espera a que Steel termine con el captcha de la página actual.
   * Si no hay captcha, vuelve vacío. Si falla, tira.
   */
  waitForCaptcha(opts?: { timeoutMs?: number; pollMs?: number }): Promise<CaptchaEvent[]>;
  events(): readonly CaptchaEvent[];
  close(): Promise<void>;
}

export interface SteelTransport {
  createSession(body: {
    solveCaptcha: boolean;
    useProxy: boolean;
  }): Promise<SteelSessionPayload>;
  captchaStatus(sessionId: string): Promise<SteelCaptchaPage[]>;
  release(sessionId: string): Promise<void>;
}

export interface SteelSessionPayload {
  id: string;
  sessionViewerUrl?: string;
  websocketUrl?: string;
}

export interface SteelCaptchaTask {
  id: string;
  type?: string;
  status: string;
  url?: string;
  totalDuration?: number;
}

export interface SteelCaptchaPage {
  pageId: string;
  url: string;
  isSolvingCaptcha: boolean;
  tasks: SteelCaptchaTask[];
}

export class SteelBrowser implements CheckoutBrowser {
  readonly name = "steel";

  constructor(
    private readonly transport: SteelTransport,
    private readonly apiKey: string,
  ) {}

  static fromApiKey(apiKey: string, fetchImpl: typeof fetch = fetch): SteelBrowser {
    return new SteelBrowser(new SteelHttpTransport(apiKey, fetchImpl), apiKey);
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): SteelBrowser {
    const apiKey = env.STEEL_API_KEY?.trim();
    if (apiKey === undefined || apiKey === "") {
      throw new Error(
        "Falta STEEL_API_KEY. Creala en https://app.steel.dev (Settings → API Keys).",
      );
    }
    return SteelBrowser.fromApiKey(apiKey);
  }

  async open(opts: OpenCheckoutOpts): Promise<CheckoutSession> {
    const created = await this.transport.createSession({
      solveCaptcha: true,
      useProxy: opts.useProxy ?? true,
    });
    return new SteelSession({
      id: created.id,
      merchant: opts.merchant,
      taskId: opts.taskId,
      connectUrl:
        created.websocketUrl ??
        `wss://connect.steel.dev?apiKey=${this.apiKey}&sessionId=${created.id}`,
      viewerUrl: created.sessionViewerUrl ?? null,
      transport: this.transport,
    });
  }
}

class SteelSession implements CheckoutSession {
  readonly id: string;
  readonly merchant: string;
  readonly connectUrl: string | null;
  readonly viewerUrl: string | null;
  private readonly taskId: string | undefined;
  private readonly transport: SteelTransport;
  private readonly recorded: CaptchaEvent[] = [];
  private closed = false;

  constructor(opts: {
    id: string;
    merchant: string;
    taskId?: string | undefined;
    connectUrl: string | null;
    viewerUrl: string | null;
    transport: SteelTransport;
  }) {
    this.id = opts.id;
    this.merchant = opts.merchant;
    this.taskId = opts.taskId;
    this.connectUrl = opts.connectUrl;
    this.viewerUrl = opts.viewerUrl;
    this.transport = opts.transport;
  }

  events(): readonly CaptchaEvent[] {
    return this.recorded;
  }

  async waitForCaptcha(opts: { timeoutMs?: number; pollMs?: number } = {}): Promise<CaptchaEvent[]> {
    if (this.closed) throw new Error("La sesión del browser ya está cerrada.");

    const timeoutMs = opts.timeoutMs ?? 30_000;
    const pollMs = opts.pollMs ?? 1_000;
    const started = Date.now();
    const seen = new Set(this.recorded.map((e) => e.taskId));
    const batch: CaptchaEvent[] = [];

    while (Date.now() - started < timeoutMs) {
      const pages = await this.transport.captchaStatus(this.id);
      const fresh = this.collect(pages, seen);
      for (const event of fresh) {
        this.recorded.push(event);
        batch.push(event);
      }

      const failed = batch.find((e) => e.status === "failed");
      if (failed !== undefined) {
        throw new CaptchaFailedError(failed);
      }

      const stillSolving = pages.some(
        (page) =>
          page.isSolvingCaptcha ||
          page.tasks.some((task) => task.status === "detected" || task.status === "solving"),
      );
      if (!stillSolving) return batch;

      await sleep(pollMs);
    }

    throw new Error(
      `Timeout esperando el captcha en ${this.merchant}: ${timeoutMs}ms.`,
    );
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.transport.release(this.id);
  }

  private collect(pages: SteelCaptchaPage[], seen: Set<string>): CaptchaEvent[] {
    const out: CaptchaEvent[] = [];
    for (const page of pages) {
      for (const task of page.tasks) {
        const status = normalizeStatus(task.status);
        if (status === "detected" || status === "solving") continue;
        if (seen.has(task.id)) continue;
        seen.add(task.id);
        const event: CaptchaEvent = {
          at: new Date(),
          merchant: this.merchant,
          url: task.url ?? page.url,
          kind: normalizeKind(task.type),
          status,
          taskId: this.taskId ?? task.id,
        };
        if (task.totalDuration !== undefined) event.durationMs = task.totalDuration;
        out.push(event);
      }
    }
    return out;
  }
}

export class CaptchaFailedError extends Error {
  constructor(readonly event: CaptchaEvent) {
    super(`Captcha falló en ${event.url} (${event.kind}).`);
    this.name = "CaptchaFailedError";
  }
}

/**
 * Sesión en memoria para tests y para correr sin API key. El captcha "se
 * resuelve" porque nosotros lo decidimos, no porque haya un rail de verdad.
 */
export class MockBrowser implements CheckoutBrowser {
  readonly name = "mock";
  private seq = 0;
  /** Lo que devolvemos en el próximo waitForCaptcha. */
  next: Array<Omit<CaptchaEvent, "at" | "merchant" | "taskId">> = [
    {
      url: "https://example.com/checkout",
      kind: "turnstile",
      status: "solved",
    },
  ];

  async open(opts: OpenCheckoutOpts): Promise<CheckoutSession> {
    const id = `mock_browser_${++this.seq}`;
    const recorded: CaptchaEvent[] = [];
    let closed = false;
    const script = this.next;

    return {
      id,
      merchant: opts.merchant,
      connectUrl: null,
      viewerUrl: null,
      events: () => recorded,
      waitForCaptcha: async () => {
        if (closed) throw new Error("La sesión del browser ya está cerrada.");
        const batch = script.map((event) => ({
          ...event,
          at: new Date(),
          merchant: opts.merchant,
          taskId: opts.taskId ?? id,
        }));
        recorded.push(...batch);
        const failed = batch.find((e) => e.status === "failed");
        if (failed !== undefined) throw new CaptchaFailedError(failed);
        return batch;
      },
      close: async () => {
        closed = true;
      },
    };
  }
}

export class SteelHttpTransport implements SteelTransport {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async createSession(body: {
    solveCaptcha: boolean;
    useProxy: boolean;
  }): Promise<SteelSessionPayload> {
    return this.request<SteelSessionPayload>("/v1/sessions", {
      method: "POST",
      body,
    });
  }

  async captchaStatus(sessionId: string): Promise<SteelCaptchaPage[]> {
    const payload = await this.request<SteelCaptchaPage[] | { pages?: SteelCaptchaPage[] }>(
      `/v1/sessions/${sessionId}/captchas/status`,
      { method: "GET" },
    );
    return Array.isArray(payload) ? payload : (payload.pages ?? []);
  }

  async release(sessionId: string): Promise<void> {
    await this.request(`/v1/sessions/${sessionId}/release`, { method: "POST" });
  }

  private async request<T>(
    path: string,
    opts: { method: string; body?: unknown },
  ): Promise<T> {
    const init: RequestInit = {
      method: opts.method,
      headers: {
        "steel-api-key": this.apiKey,
        accept: "application/json",
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
      },
    };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    const response = await this.fetchImpl(`${STEEL_API}${path}`, init);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Steel ${opts.method} ${path} → ${response.status}: ${text}`);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}

function normalizeStatus(status: string): CaptchaTaskStatus {
  if (status === "solved") return "solved";
  if (
    status === "failed_to_solve" ||
    status === "failed_to_detect" ||
    status === "validation_failed"
  ) {
    return "failed";
  }
  if (status === "solving" || status === "validating") return "solving";
  return "detected";
}

function normalizeKind(type: string | undefined): CaptchaKind {
  if (
    type === "recaptchaV2" ||
    type === "recaptchaV3" ||
    type === "turnstile" ||
    type === "image_to_text"
  ) {
    return type;
  }
  return "unknown";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
