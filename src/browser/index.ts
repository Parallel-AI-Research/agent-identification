import {
  VERSION,
  isChoice,
  isRoutePattern,
  routePath,
  type Choice,
  type CreatedSession,
  type Mode,
  type RecordedDeclaration,
  type SessionStatus,
} from "../protocol.js";
import {
  HttpError,
  asError,
  automationSignals,
  confirmed,
  endpoint,
  futureDate,
  loadSession,
  opaque,
  pageOrigin,
  persistSession,
  record,
  send,
  sessionToken,
  siteId,
  storageKey,
  uuid,
  type StoredSession,
} from "./shared.js";

export type { Choice, Mode, RecordedDeclaration, SessionStatus };
export { track, type Tracker, type TrackerOptions } from "./track.js";

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
  /**
   * Records a page view once the session is ready, and again after reset. Only the path is
   * sent, without its query or fragment and with parts that look like IDs masked. Defaults to
   * true.
   */
  pageViews?: boolean;
  /** Your route pattern for this page, such as /tickets/:id, for parts masking can't catch. */
  route?: string;
  /**
   * Reports whether this browser is automated (navigator.webdriver) or headless, as heuristic
   * evidence that never labels a visitor an AI agent. Off by default.
   */
  automationSignals?: boolean;
}

export interface Widget {
  readonly ready: Promise<SessionStatus>;
  getState(): SessionStatus | null;
  reset(): Promise<SessionStatus>;
  /** Records a page view, for apps that change pages without reloading. */
  pageView(options?: { route?: string }): Promise<void>;
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
  pageViews: boolean;
  route?: string;
  automationSignals: boolean;
}

const instances = new WeakMap<HTMLElement, Controller>();
const gates = new WeakMap<HTMLElement, Controller>();
const labels: Record<Choice, string> = {
  ai_assistant: "AI assistant",
  person: "Person",
  prefer_not_to_say: "Prefer not to say",
};

function element(value: HTMLElement | string, name: string): HTMLElement {
  const found = typeof value === "string" ? document.querySelector(value) : value;
  if (!(found instanceof HTMLElement)) {
    throw new Error(`${name} must identify an existing HTML element.`);
  }
  return found;
}

function configure(options: WidgetOptions): Configuration {
  const container = element(options.container, "container");
  const gate = options.gate === undefined ? undefined : element(options.gate, "gate");
  const apiUrl = endpoint(options.apiUrl, "apiUrl");
  const mode = options.mode ?? "optional";
  const storage = options.storage ?? "session";
  if (mode !== "optional" && mode !== "required") throw new Error("Invalid identification mode.");
  if (storage !== "session" && storage !== "memory") throw new Error("Invalid storage option.");
  if (gate && (gate === container || gate.contains(container))) {
    throw new Error("The gate must not contain the identification widget.");
  }
  const origin = pageOrigin();
  if (options.route !== undefined && !isRoutePattern(options.route)) {
    throw new Error("route must be a path pattern such as /tickets/:id.");
  }
  return {
    container,
    gate,
    apiUrl,
    siteId: siteId(options.siteId),
    origin,
    mode,
    storage,
    styleUrl: endpoint(options.styleUrl ?? `${apiUrl}/sdk/v${VERSION}/agent-id.css`, "styleUrl"),
    bindingContext: options.bindingContext,
    onRecorded: options.onRecorded,
    onError: options.onError,
    pageViews: options.pageViews ?? true,
    route: options.route,
    automationSignals: options.automationSignals ?? false,
  };
}

function sameConfiguration(left: Configuration, right: Configuration): boolean {
  return (Object.keys(left) as (keyof Configuration)[]).every((key) => {
    if ((key === "onRecorded" || key === "onError") && right[key] === undefined) return true;
    return left[key] === right[key];
  });
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
  /** The session this page load has recorded its automatic page view in. */
  private viewed: string | null = null;
  /** The session this page load has reported its automation signals in. */
  private signalled: string | null = null;

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
    return this.key ? loadSession(this.key, this.config.storage) : null;
  }

  private persist(value: StoredSession | null): void {
    if (this.key) persistSession(this.key, this.config.storage, value);
  }

  private request(path: string, method: string, body?: unknown, token?: string): Promise<unknown> {
    return send(this.config, this.controller.signal, path, method, body, token);
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
          return this.view(this.accepted(status));
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
      return this.view(this.accepted(status));
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

  /** Records this page load's automatic view once per session; failures reach onError. */
  private view(status: SessionStatus): SessionStatus {
    if (this.config.pageViews && this.viewed !== status.sessionId) {
      this.viewed = status.sessionId;
      void this.pageView({ route: this.config.route }).catch(() => {});
    }
    if (this.config.automationSignals && this.signalled !== status.sessionId) {
      this.signalled = status.sessionId;
      void this.reportSignals().catch(() => {});
    }
    return status;
  }

  async pageView(options: { route?: string } = {}): Promise<void> {
    this.active(this.version);
    if (options.route !== undefined && !isRoutePattern(options.route)) {
      throw new Error("route must be a path pattern such as /tickets/:id.");
    }
    const view = {
      // The same ID on every attempt, so a retry is recorded once.
      id: crypto.randomUUID(),
      path: routePath(window.location.pathname),
      ...(options.route ? { route: options.route } : {}),
      occurredAt: new Date().toISOString(),
    };
    await this.deliver("/v1/page-views", { views: [view] }, view.id, "page view");
  }

  /**
   * Sends one event and waits for the collector to confirm that exact ID. It retries with the same
   * ID, so a retry is recorded once, and reports to onError before rejecting.
   */
  private async deliver(path: string, payload: object, id: string, what: string): Promise<void> {
    const operation = this.controller.signal;
    for (let attempt = 0; ; attempt++) {
      const session = this.session;
      try {
        if (!session) throw new Error("Identification session is not ready.");
        const body = await this.request(path, "POST", payload, session.token);
        if (!confirmed(body, id))
          throw new Error(`Identification service did not confirm the ${what}.`);
        return;
      } catch (error) {
        // A reset or destroy supersedes it; it belongs to the session that ended.
        if (operation.aborted || this.destroyed) throw error;
        const retryable =
          session !== null &&
          (!(error instanceof HttpError) || error.status === 429 || error.status >= 500);
        if (!retryable || attempt >= 2) {
          const failure = asError(error);
          this.notifyError(failure);
          throw failure;
        }
        await new Promise((resolve) => setTimeout(resolve, 300 * 3 ** attempt));
        if (operation.aborted || this.destroyed) throw error;
      }
    }
  }

  /** Opt-in: what this browser shows of automation, as evidence and never as identity. */
  private async reportSignals(): Promise<void> {
    for (const signal of automationSignals()) {
      const event = { id: crypto.randomUUID(), ...signal, occurredAt: new Date().toISOString() };
      await this.deliver("/v1/browser-signals", { signals: [event] }, event.id, "signal");
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
