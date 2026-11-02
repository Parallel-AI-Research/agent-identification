import {
  VERSION,
  isChoice,
  type Choice,
  type CreatedSession,
  type Mode,
  type RecordedDeclaration,
  type SessionStatus,
} from "../protocol.js";

export type { Choice, Mode, RecordedDeclaration, SessionStatus };

export interface WidgetOptions {
  container: HTMLElement | string;
  siteId: string;
  apiUrl: string;
  mode?: Mode;
  gate?: HTMLElement | string;
  styleUrl?: string;
  bindingContext?: string | (() => Promise<string>);
  storage?: "session" | "memory";
  onRecorded?: (declaration: RecordedDeclaration) => void;
  onError?: (error: Error) => void;
}

export interface Widget {
  readonly ready: Promise<SessionStatus>;
  getState(): SessionStatus | null;
  reset(): Promise<SessionStatus>;
  destroy(): void;
}

interface Configuration {
  container: HTMLElement;
  siteId: string;
  apiUrl: string;
  origin: string;
  mode: Mode;
  gate?: HTMLElement;
  styleUrl: string;
  bindingContext?: WidgetOptions["bindingContext"];
  storage: "session" | "memory";
  onRecorded?: WidgetOptions["onRecorded"];
  onError?: WidgetOptions["onError"];
}

interface StoredSession {
  token: string;
  sessionId: string;
  expiresAt: string;
}

const instances = new WeakMap<HTMLElement, Controller>();
const gates = new WeakMap<HTMLElement, Controller>();
const memorySessions = new Map<string, StoredSession>();
const labels: Record<Choice, string> = {
  ai_assistant: "AI assistant",
  person: "Person",
  prefer_not_to_say: "Prefer not to say",
};
const requestTimeoutMs = 15_000;

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`Identification service returned HTTP ${status}.`);
    this.name = "HttpError";
  }
}

function element(value: HTMLElement | string, name: string): HTMLElement {
  const found = typeof value === "string" ? document.querySelector(value) : value;
  if (!(found instanceof HTMLElement)) {
    throw new Error(`${name} must identify an existing HTML element.`);
  }
  return found;
}

function endpoint(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value, window.location.href);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `${name} must use HTTPS (or localhost HTTP), without credentials, query or fragment.`,
    );
  }
  return url.href.replace(/\/$/, "");
}

function configure(options: WidgetOptions): Configuration {
  const container = element(options.container, "container");
  const gate = options.gate === undefined ? undefined : element(options.gate, "gate");
  const apiUrl = endpoint(options.apiUrl, "apiUrl");
  const mode = options.mode ?? "optional";
  const storage = options.storage ?? "session";
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(options.siteId)) {
    throw new Error("siteId must contain 1–100 letters, numbers, underscores or hyphens.");
  }
  if (mode !== "optional" && mode !== "required") throw new Error("Invalid identification mode.");
  if (storage !== "session" && storage !== "memory") throw new Error("Invalid storage option.");
  if (gate && (gate === container || gate.contains(container))) {
    throw new Error("The gate must not contain the identification widget.");
  }
  if (window.location.origin === "null") {
    throw new Error("Serve this website over HTTPS (or localhost HTTP) to use identification.");
  }
  return {
    container,
    gate,
    apiUrl,
    siteId: options.siteId,
    origin: window.location.origin,
    mode,
    storage,
    styleUrl: endpoint(options.styleUrl ?? `${apiUrl}/sdk/v${VERSION}/agent-id.css`, "styleUrl"),
    bindingContext: options.bindingContext,
    onRecorded: options.onRecorded,
    onError: options.onError,
  };
}

function sameConfiguration(left: Configuration, right: Configuration): boolean {
  return (Object.keys(left) as (keyof Configuration)[]).every((key) => {
    if ((key === "onRecorded" || key === "onError") && right[key] === undefined) return true;
    return left[key] === right[key];
  });
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function opaque(value: unknown, min = 1, max = 512): value is string {
  return (
    typeof value === "string" &&
    value.length >= min &&
    value.length <= max &&
    /^[A-Za-z0-9._~-]+$/.test(value)
  );
}

function uuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function sessionToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32,512}$/.test(value);
}

function futureDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    Date.parse(value) > Date.now()
  );
}

function validateStatus(
  value: unknown,
  config: Configuration,
  expectedId?: string,
  expectedChoice?: Choice,
): SessionStatus {
  if (
    !record(value) ||
    !uuid(value.sessionId) ||
    (expectedId !== undefined && value.sessionId !== expectedId) ||
    value.siteId !== config.siteId ||
    value.origin !== config.origin ||
    !futureDate(value.expiresAt) ||
    value.evidence !== "self_reported"
  ) {
    throw new Error("Identification service returned an invalid or mismatched session.");
  }
  const unanswered = value.choice === null && value.receipt === null && value.eventId === null;
  const answered = isChoice(value.choice) && opaque(value.receipt, 1, 8192) && uuid(value.eventId);
  if (
    (!unanswered && !answered) ||
    (expectedChoice !== undefined && value.choice !== expectedChoice)
  ) {
    throw new Error("Identification service returned an invalid or mismatched response.");
  }
  return {
    sessionId: value.sessionId,
    siteId: config.siteId,
    origin: config.origin,
    expiresAt: value.expiresAt,
    choice: value.choice as Choice | null,
    receipt: value.receipt as string | null,
    eventId: value.eventId as string | null,
    evidence: "self_reported",
  };
}

function readStored(value: unknown): StoredSession | null {
  if (
    !record(value) ||
    !sessionToken(value.token) ||
    !uuid(value.sessionId) ||
    !futureDate(value.expiresAt)
  ) {
    return null;
  }
  return { token: value.token, sessionId: value.sessionId, expiresAt: value.expiresAt };
}

async function storageKey(config: Configuration, context: string | undefined): Promise<string> {
  const scope = JSON.stringify([config.apiUrl, config.siteId, config.origin, context ?? null]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(scope));
  return `parallel-agent-id:v1:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error("Identification request failed.");
}

class Controller implements Widget {
  readonly ready: Promise<SessionStatus>;
  private readonly host = document.createElement("div");
  private readonly root = this.host.attachShadow({ mode: "open" });
  private readonly status = document.createElement("p");
  private readonly retry = document.createElement("button");
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly originalInert: boolean;
  private version = 0;
  private controller = new AbortController();
  private destroyed = false;
  private state: SessionStatus | null = null;
  private session: StoredSession | null = null;
  private key: string | null = null;
  private pending: { choice: Choice; requestId: string } | null = null;
  private retryAction: (() => Promise<unknown>) | null = null;
  private expiry: ReturnType<typeof setTimeout> | undefined;

  constructor(readonly config: Configuration) {
    this.originalInert = config.gate?.inert ?? false;
    this.build();
    this.lock();
    this.ready = this.start(this.version);
    void this.ready.catch(() => {});
  }

  private build(): void {
    this.host.dataset.agentIdentification = VERSION;
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = this.config.styleUrl;
    const panel = document.createElement("section");
    panel.className = "agent-identification";
    panel.setAttribute("aria-label", "Visitor identification");
    const title = document.createElement("h2");
    title.textContent =
      this.config.mode === "required" ? "Before continuing" : "How are you visiting?";
    const description = document.createElement("p");
    description.textContent = "Choose one option. Your answer is self-reported.";
    const actions = document.createElement("div");
    actions.className = "choices";
    for (const choice of Object.keys(labels) as Choice[]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = labels[choice];
      button.disabled = true;
      button.addEventListener("click", () => {
        this.pending = { choice, requestId: crypto.randomUUID() };
        void this.submit(this.version).catch(() => {});
      });
      this.buttons.push(button);
      actions.append(button);
    }
    this.status.className = "status";
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");
    this.status.setAttribute("aria-atomic", "true");
    this.retry.type = "button";
    this.retry.textContent = "Retry";
    this.retry.hidden = true;
    this.retry.addEventListener("click", () => {
      const action = this.retryAction;
      if (action) void action().catch(() => {});
    });
    panel.append(title, description, actions, this.status, this.retry);
    this.root.append(stylesheet, panel);
    this.config.container.append(this.host);
  }

  private active(version: number): void {
    if (this.destroyed || version !== this.version)
      throw new DOMException("Widget operation was superseded.", "AbortError");
  }

  private lock(): void {
    if (this.config.mode === "required" && this.config.gate) this.config.gate.inert = true;
  }

  private busy(message: string): void {
    this.status.textContent = message;
    this.retry.hidden = true;
    this.retryAction = null;
    for (const button of this.buttons) button.disabled = true;
  }

  private fail(
    error: unknown,
    version: number,
    action: () => Promise<unknown>,
    prefix: string,
  ): void {
    if (this.destroyed || version !== this.version) return;
    const failure = asError(error);
    this.status.textContent = `${prefix} ${failure.message}`;
    this.retry.hidden = false;
    this.retryAction = action;
    this.notifyError(failure);
  }

  private notifyError(error: Error): void {
    try {
      this.config.onError?.(error);
    } catch {
      // A host callback cannot change whether the service accepted a declaration.
    }
  }

  private accepted(status: SessionStatus): SessionStatus {
    this.state = status;
    clearTimeout(this.expiry);
    this.expiry = setTimeout(
      () => {
        if (this.destroyed || this.state?.sessionId !== status.sessionId) return;
        this.state = null;
        this.lock();
        this.busy("Your identification session expired.");
        this.retry.hidden = false;
        this.retryAction = () => this.restart();
      },
      Math.min(Date.parse(status.expiresAt) - Date.now(), 2_147_483_647),
    );
    this.retry.hidden = true;
    this.retryAction = null;
    if (status.choice !== null) {
      this.status.textContent = `Response recorded: ${labels[status.choice]}.`;
      if (this.config.mode === "required" && this.config.gate)
        this.config.gate.inert = this.originalInert;
      try {
        this.config.onRecorded?.({ ...status } as RecordedDeclaration);
      } catch {
        this.notifyError(
          new Error("Your onRecorded callback failed after the response was recorded."),
        );
      }
    } else {
      this.status.textContent =
        this.config.mode === "required"
          ? "Select any option to continue."
          : "You can choose an option or continue without answering.";
    }
    for (const button of this.buttons) button.disabled = status.choice !== null;
    return { ...status };
  }

  private load(): StoredSession | null {
    if (!this.key) return null;
    let found = memorySessions.get(this.key) ?? null;
    if (this.config.storage === "session") {
      try {
        const serialized = sessionStorage.getItem(this.key);
        found = serialized ? readStored(JSON.parse(serialized)) : found;
        if (serialized && !found) sessionStorage.removeItem(this.key);
      } catch {
        // Storage can be disabled or corrupted. The server still validates all restored tokens.
      }
    }
    return readStored(found);
  }

  private persist(value: StoredSession | null): void {
    if (!this.key) return;
    for (const [key, stored] of memorySessions) {
      if (!futureDate(stored.expiresAt)) memorySessions.delete(key);
    }
    if (value) memorySessions.set(this.key, { ...value });
    else memorySessions.delete(this.key);
    if (this.config.storage === "session") {
      try {
        if (value) sessionStorage.setItem(this.key, JSON.stringify(value));
        else sessionStorage.removeItem(this.key);
      } catch {
        // An in-memory session remains usable when browser storage is blocked.
      }
    }
  }

  private async request(
    path: string,
    method: string,
    body?: unknown,
    token?: string,
  ): Promise<unknown> {
    const operation = this.controller.signal;
    const request = new AbortController();
    const abort = () => request.abort();
    operation.addEventListener("abort", abort, { once: true });
    if (operation.aborted) request.abort();
    const timeout = setTimeout(() => request.abort(), requestTimeoutMs);
    try {
      const response = await fetch(`${this.config.apiUrl}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(token
            ? { Authorization: `Bearer ${token}`, "X-Agent-Site": this.config.siteId }
            : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        credentials: "omit",
        cache: "no-store",
        mode: "cors",
        referrerPolicy: "no-referrer",
        signal: request.signal,
      });
      if (!response.ok) throw new HttpError(response.status);
      if (method === "DELETE") {
        if (response.status !== 204) throw new Error("Session revocation was not confirmed.");
        return null;
      }
      if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
        throw new Error("Identification service did not return JSON.");
      }
      return await response.json();
    } catch (error) {
      if (request.signal.aborted && !operation.aborted)
        throw new Error("Identification service timed out. Please retry.", { cause: error });
      throw error;
    } finally {
      clearTimeout(timeout);
      operation.removeEventListener("abort", abort);
    }
  }

  private async start(version: number): Promise<SessionStatus> {
    this.busy("Loading identification…");
    this.lock();
    try {
      const context =
        typeof this.config.bindingContext === "function"
          ? await this.config.bindingContext()
          : this.config.bindingContext;
      this.active(version);
      if (
        context !== undefined &&
        (typeof context !== "string" || context.length === 0 || context.length > 8192)
      ) {
        throw new Error("bindingContext must be a nonempty signed context.");
      }
      const key = await storageKey(this.config, context);
      this.active(version);
      this.key = key;
      this.session = this.load();
      if (this.session) {
        try {
          const body = await this.request(
            "/v1/sessions/current",
            "GET",
            undefined,
            this.session.token,
          );
          this.active(version);
          const status = validateStatus(body, this.config, this.session.sessionId);
          this.session.expiresAt = status.expiresAt;
          this.persist(this.session);
          return this.accepted(status);
        } catch (error) {
          this.active(version);
          if (!(error instanceof HttpError) || ![401, 404, 410].includes(error.status)) throw error;
          this.persist(null);
          this.session = null;
        }
      }
      const body = await this.request("/v1/sessions", "POST", {
        siteId: this.config.siteId,
        ...(context === undefined ? {} : { bindingContext: context }),
      });
      this.active(version);
      const status = validateStatus(body, this.config);
      if (!record(body) || !sessionToken(body.sessionToken) || status.choice !== null) {
        throw new Error("Identification service returned an invalid new session.");
      }
      this.session = {
        token: (body as unknown as CreatedSession).sessionToken,
        sessionId: status.sessionId,
        expiresAt: status.expiresAt,
      };
      this.persist(this.session);
      return this.accepted(status);
    } catch (error) {
      this.fail(error, version, () => this.restart(), "Could not load identification.");
      throw error;
    }
  }

  private async submit(version: number): Promise<SessionStatus> {
    if (!this.pending || !this.session) throw new Error("Identification session is not ready.");
    const pending = this.pending;
    const session = this.session;
    this.busy("Recording your response…");
    try {
      const body = await this.request("/v1/declarations", "POST", pending, session.token);
      this.active(version);
      const status = validateStatus(body, this.config, session.sessionId, pending.choice);
      session.expiresAt = status.expiresAt;
      this.persist(session);
      this.pending = null;
      return this.accepted(status);
    } catch (error) {
      this.fail(error, version, () => this.submit(this.version), "Could not record your response.");
      throw error;
    }
  }

  private restart(): Promise<SessionStatus> {
    this.active(this.version);
    this.controller.abort();
    clearTimeout(this.expiry);
    this.controller = new AbortController();
    this.version += 1;
    return this.start(this.version);
  }

  getState(): SessionStatus | null {
    return this.state ? { ...this.state } : null;
  }

  async reset(): Promise<SessionStatus> {
    this.active(this.version);
    this.controller.abort();
    clearTimeout(this.expiry);
    this.controller = new AbortController();
    const version = ++this.version;
    this.busy("Resetting identification…");
    this.state = null;
    this.pending = null;
    this.lock();
    try {
      if (this.session) {
        await this.request("/v1/sessions/current", "DELETE", undefined, this.session.token);
        this.active(version);
      }
      this.persist(null);
      this.session = null;
    } catch (error) {
      this.fail(error, version, () => this.reset(), "Could not reset identification.");
      throw error;
    }
    return this.start(version);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.version += 1;
    this.controller.abort();
    clearTimeout(this.expiry);
    this.host.remove();
    if (this.config.mode === "required" && this.config.gate) {
      this.config.gate.inert = this.originalInert;
      gates.delete(this.config.gate);
    }
    instances.delete(this.config.container);
    this.retryAction = null;
  }
}

/** Mount a self-reported visitor choice. Required mode controls only the supplied UI gate. */
export function init(options: WidgetOptions): Widget {
  const config = configure(options);
  const existing = instances.get(config.container);
  if (existing) {
    if (!sameConfiguration(existing.config, config))
      throw new Error(
        "This container already has an identification widget with different options.",
      );
    return existing;
  }
  if (config.mode === "required" && config.gate && gates.has(config.gate)) {
    throw new Error("This gate is already controlled by another identification widget.");
  }
  const controller = new Controller(config);
  instances.set(config.container, controller);
  if (config.mode === "required" && config.gate) gates.set(config.gate, controller);
  return controller;
}
