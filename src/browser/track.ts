import { isRoutePattern, routePath } from "../protocol.js";
import {
  HttpError,
  asError,
  automationSignals,
  confirmed,
  endpoint,
  futureDate,
  loadSession,
  pageOrigin,
  persistSession,
  record,
  send,
  sessionToken,
  siteId,
  storageKey,
  uuid,
  type StoredSession,
  type Target,
} from "./shared.js";

export interface TrackerOptions {
  siteId: string;
  apiUrl: string;
  /** Where the tab's session is kept: sessionStorage (the default) or memory only. */
  storage?: "session" | "memory";
  /** Your route pattern for this page, such as /tickets/:id, for parts masking can't catch. */
  route?: string;
  /**
   * Records a page view whenever the path changes without a reload, through the History API or
   * the back and forward buttons. Defaults to true; turn it off if you call pageView() yourself.
   */
  navigation?: boolean;
  /**
   * Reports whether this browser is automated (navigator.webdriver) or headless, once per
   * session, as heuristic evidence that never labels a visitor an AI agent. Defaults to true.
   */
  automationSignals?: boolean;
  onError?: (error: Error) => void;
}

export interface Tracker {
  /** Resolves once this page load's page view is confirmed, and rejects if it couldn't be. */
  readonly ready: Promise<void>;
  /** Records a page view, for apps that change pages without the History API. */
  pageView(options?: { route?: string }): Promise<void>;
  /** Stops recording. It never ends the session or removes anything already recorded. */
  destroy(): void;
}

interface Configuration extends Target {
  storage: "session" | "memory";
  navigation: boolean;
  automationSignals: boolean;
  onError?: (error: Error) => void;
}

const trackers = new Map<string, Controller>();
const signalledSessions = new Set<string>();
const navigationListeners = new WeakMap<History, Set<() => void>>();

/**
 * Calls the listener after every History API change and back or forward navigation. Wrapping
 * pushState and replaceState is the only way to see a single-page app's navigation; the wrappers
 * always call through, and are never removed in case other code has wrapped them since.
 */
function watchNavigation(listener: () => void): () => void {
  const { history } = window;
  let listeners = navigationListeners.get(history);
  if (!listeners) {
    const notify = () => {
      for (const callback of [...listeners!]) callback();
    };
    listeners = new Set();
    navigationListeners.set(history, listeners);
    for (const method of ["pushState", "replaceState"] as const) {
      const original = history[method];
      history[method] = function (this: History, ...args: Parameters<History["pushState"]>) {
        const result = original.apply(this, args);
        notify();
        return result;
      };
    }
    window.addEventListener("popstate", notify);
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function configure(options: TrackerOptions): Configuration {
  const storage = options.storage ?? "session";
  if (storage !== "session" && storage !== "memory") throw new Error("Invalid storage option.");
  if (options.route !== undefined && !isRoutePattern(options.route)) {
    throw new Error("route must be a path pattern such as /tickets/:id.");
  }
  return {
    apiUrl: endpoint(options.apiUrl, "apiUrl"),
    siteId: siteId(options.siteId),
    origin: pageOrigin(),
    storage,
    navigation: options.navigation ?? true,
    automationSignals: options.automationSignals ?? true,
    onError: options.onError,
  };
}

function sameConfiguration(left: Configuration, right: Configuration): boolean {
  return (Object.keys(left) as (keyof Configuration)[]).every(
    (key) => (key === "onError" && right[key] === undefined) || left[key] === right[key],
  );
}

class Controller implements Tracker {
  readonly ready: Promise<void>;
  private readonly controller = new AbortController();
  private readonly key: Promise<string>;
  private readonly stopWatching: () => void;
  private session: StoredSession | null = null;
  private starting: Promise<StoredSession> | null = null;
  private destroyed = false;
  /** The path this page load last recorded, so a navigation to the same path isn't counted. */
  private path = window.location.pathname;

  constructor(
    readonly config: Configuration,
    route: string | undefined,
  ) {
    this.key = storageKey(config, undefined);
    this.stopWatching = config.navigation ? watchNavigation(() => this.navigated()) : () => {};
    this.ready = this.pageView({ route });
    void this.ready.catch(() => {});
  }

  private navigated(): void {
    if (this.destroyed || window.location.pathname === this.path) return;
    void this.pageView().catch(() => {});
  }

  async pageView(options: { route?: string } = {}): Promise<void> {
    if (this.destroyed) throw new Error("This tracker was destroyed.");
    if (options.route !== undefined && !isRoutePattern(options.route)) {
      throw new Error("route must be a path pattern such as /tickets/:id.");
    }
    this.path = window.location.pathname;
    const view = {
      // The same ID on every attempt, so a retry is recorded once.
      id: crypto.randomUUID(),
      path: routePath(this.path),
      ...(options.route ? { route: options.route } : {}),
      occurredAt: new Date().toISOString(),
    };
    const session = await this.deliver("/v1/page-views", { views: [view] }, view.id, "page view");
    if (this.config.automationSignals && (await this.firstSignals(session.sessionId))) {
      void this.reportSignals().catch(() => {});
    }
  }

  /**
   * Whether this session has yet to report the browser's automation signals, marking it as
   * reported. The mark is kept with the session, so a reload doesn't report them again.
   */
  private async firstSignals(sessionId: string): Promise<boolean> {
    const key = `${await this.key}:signals`;
    if (signalledSessions.has(sessionId)) return false;
    signalledSessions.add(sessionId);
    if (this.config.storage === "memory") return true;
    try {
      if (sessionStorage.getItem(key) === sessionId) return false;
      sessionStorage.setItem(key, sessionId);
    } catch {
      // Without storage, a reload may report them again in the same session.
    }
    return true;
  }

  private async reportSignals(): Promise<void> {
    for (const signal of automationSignals()) {
      const event = { id: crypto.randomUUID(), ...signal, occurredAt: new Date().toISOString() };
      await this.deliver("/v1/browser-signals", { signals: [event] }, event.id, "signal");
    }
  }

  /** The tab's session: the stored one while it lasts, else a new one. */
  private async current(): Promise<StoredSession> {
    const key = await this.key;
    this.session ??= loadSession(key, this.config.storage);
    if (this.session && futureDate(this.session.expiresAt)) return this.session;
    this.starting ??= this.start(key).finally(() => (this.starting = null));
    return this.starting;
  }

  private async start(key: string): Promise<StoredSession> {
    const body = await send(this.config, this.controller.signal, "/v1/sessions", "POST", {
      siteId: this.config.siteId,
    });
    if (
      !record(body) ||
      !uuid(body.sessionId) ||
      body.siteId !== this.config.siteId ||
      body.origin !== this.config.origin ||
      !futureDate(body.expiresAt) ||
      !sessionToken(body.sessionToken)
    ) {
      throw new Error("Identification service returned an invalid new session.");
    }
    this.session = {
      token: body.sessionToken,
      sessionId: body.sessionId,
      expiresAt: body.expiresAt,
    };
    persistSession(key, this.config.storage, this.session);
    return this.session;
  }

  /**
   * Sends one event and waits for the collector to confirm that exact ID, resolving to the
   * session it was recorded in. A session the collector no longer accepts is replaced, and other
   * failures retry with the same ID, so a retry is recorded once. It reports to onError before
   * rejecting.
   */
  private async deliver(
    path: string,
    payload: object,
    id: string,
    what: string,
  ): Promise<StoredSession> {
    for (let attempt = 0; ; attempt++) {
      let session: StoredSession | null = null;
      try {
        session = await this.current();
        const body = await send(
          this.config,
          this.controller.signal,
          path,
          "POST",
          payload,
          session.token,
        );
        if (!confirmed(body, id))
          throw new Error(`Identification service did not confirm the ${what}.`);
        return session;
      } catch (error) {
        if (this.destroyed) throw error;
        const ended =
          session !== null && error instanceof HttpError && [401, 404, 410].includes(error.status);
        if (ended && session && this.session === session) {
          // The widget may already have stored its own new session for this tab; keep that one.
          this.session = null;
          const key = await this.key;
          if (loadSession(key, this.config.storage)?.token === session.token)
            persistSession(key, this.config.storage, null);
        }
        const retryable =
          ended || !(error instanceof HttpError) || error.status === 429 || error.status >= 500;
        if (!retryable || attempt >= 2) {
          const failure = asError(error);
          try {
            this.config.onError?.(failure);
          } catch {
            // A host callback can't change what the collector recorded.
          }
          throw failure;
        }
        if (!ended) await new Promise((resolve) => setTimeout(resolve, 300 * 3 ** attempt));
        if (this.destroyed) throw error;
      }
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopWatching();
    this.controller.abort();
    if (trackers.get(this.config.apiUrl + " " + this.config.siteId) === this) {
      trackers.delete(this.config.apiUrl + " " + this.config.siteId);
    }
  }
}

/**
 * Records this page's views and automation signals for one site, without drawing anything.
 * Calling it again for the same site returns the same tracker.
 */
export function track(options: TrackerOptions): Tracker {
  const config = configure(options);
  const key = config.apiUrl + " " + config.siteId;
  const existing = trackers.get(key);
  if (existing) {
    if (!sameConfiguration(existing.config, config))
      throw new Error("This site is already tracked on this page with different options.");
    return existing;
  }
  const controller = new Controller(config, options.route);
  trackers.set(key, controller);
  return controller;
}
