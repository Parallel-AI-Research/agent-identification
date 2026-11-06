/** Session and request code shared by the declaration widget and the page tracker. */
import type { Signal } from "../protocol.js";

export interface StoredSession {
  token: string;
  sessionId: string;
  expiresAt: string;
}

export interface Target {
  apiUrl: string;
  siteId: string;
  origin: string;
}

const memorySessions = new Map<string, StoredSession>();
const requestTimeoutMs = 15_000;

export class HttpError extends Error {
  constructor(readonly status: number) {
    super(`Identification service returned HTTP ${status}.`);
    this.name = "HttpError";
  }
}

export function endpoint(value: string, name: string): string {
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

export function siteId(value: string): string {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(value)) {
    throw new Error("siteId must contain 1–100 letters, numbers, underscores or hyphens.");
  }
  return value;
}

export function pageOrigin(): string {
  if (window.location.origin === "null") {
    throw new Error("Serve this website over HTTPS (or localhost HTTP) to use identification.");
  }
  return window.location.origin;
}

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function opaque(value: unknown, min = 1, max = 512): value is string {
  return (
    typeof value === "string" &&
    value.length >= min &&
    value.length <= max &&
    /^[A-Za-z0-9._~-]+$/.test(value)
  );
}

export function uuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

export function sessionToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32,512}$/.test(value);
}

export function futureDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    Date.parse(value) > Date.now()
  );
}

export function readStored(value: unknown): StoredSession | null {
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

export async function storageKey(target: Target, context: string | undefined): Promise<string> {
  const scope = JSON.stringify([target.apiUrl, target.siteId, target.origin, context ?? null]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(scope));
  return `parallel-agent-id:v1:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function loadSession(key: string, storage: "session" | "memory"): StoredSession | null {
  let found = memorySessions.get(key) ?? null;
  if (storage === "session") {
    try {
      const serialized = sessionStorage.getItem(key);
      found = serialized ? readStored(JSON.parse(serialized)) : found;
      if (serialized && !found) sessionStorage.removeItem(key);
    } catch {
      // Storage can be disabled or corrupted. The server still validates all restored tokens.
    }
  }
  return readStored(found);
}

export function persistSession(
  key: string,
  storage: "session" | "memory",
  value: StoredSession | null,
): void {
  for (const [stored, session] of memorySessions) {
    if (!futureDate(session.expiresAt)) memorySessions.delete(stored);
  }
  if (value) memorySessions.set(key, { ...value });
  else memorySessions.delete(key);
  if (storage === "session") {
    try {
      if (value) sessionStorage.setItem(key, JSON.stringify(value));
      else sessionStorage.removeItem(key);
    } catch {
      // An in-memory session remains usable when browser storage is blocked.
    }
  }
}

export function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error("Identification request failed.");
}

/** One collector request. Anything but a successful, well-formed response throws. */
export async function send(
  target: Target,
  operation: AbortSignal,
  path: string,
  method: string,
  body?: unknown,
  token?: string,
): Promise<unknown> {
  const request = new AbortController();
  const abort = () => request.abort();
  operation.addEventListener("abort", abort, { once: true });
  if (operation.aborted) request.abort();
  const timeout = setTimeout(() => request.abort(), requestTimeoutMs);
  try {
    const response = await fetch(`${target.apiUrl}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}`, "X-Agent-Site": target.siteId } : {}),
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

/** Whether the collector confirmed that exact event ID as recorded, now or before. */
export function confirmed(body: unknown, id: string): boolean {
  return (
    record(body) &&
    Array.isArray(body.results) &&
    body.results.some(
      (result: unknown) =>
        record(result) &&
        result.id === id &&
        (result.status === "recorded" || result.status === "duplicate"),
    )
  );
}

/** What this browser shows of automation: evidence, never identity. */
export function automationSignals(): { signal: Signal; detail: string }[] {
  const found: { signal: Signal; detail: string }[] = [];
  if (navigator.webdriver === true)
    found.push({ signal: "webdriver", detail: "navigator.webdriver" });
  if (/HeadlessChrome\//.test(navigator.userAgent)) {
    found.push({ signal: "headless_browser", detail: "HeadlessChrome" });
  }
  return found;
}
