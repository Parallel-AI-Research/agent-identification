import type { SignatureEvent } from "../protocol.js";
import { isAllowedOrigin } from "./tokens.js";

/** A request as a server framework sees it: a Fetch Request, or Node's IncomingMessage. */
export type ReportableRequest =
  | Request
  | {
      method?: string;
      url?: string;
      originalUrl?: string;
      protocol?: string;
      headers: Record<string, string | string[] | undefined>;
    };

export interface SignatureReportOptions {
  apiUrl: string;
  siteId: string;
  /** The site's server secret. Never use it in browser code. */
  secret: string;
  /** The collector session, when your server knows it. */
  sessionId?: string;
  /** Your opaque ID for the account used, never a name or email address. */
  accountRef?: string;
  /** The URL the visitor requested, when a proxy rewrote the request's own. */
  url?: string;
  /** Called when a report fails. Defaults to a console warning without any secret. */
  onError?: (error: Error) => void;
  fetch?: typeof globalThis.fetch;
}
export type SignatureReport =
  | { status: "skipped" }
  | { status: "recorded"; event: SignatureEvent }
  | { status: "failed"; error: Error };

function headerMap(request: ReportableRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  if (typeof Headers !== "undefined" && request.headers instanceof Headers) {
    request.headers.forEach((value, name) => {
      headers[name.toLowerCase()] = value;
    });
    return headers;
  }
  for (const [name, value] of Object.entries(
    request.headers as Record<string, string | string[] | undefined>,
  )) {
    if (value !== undefined) {
      headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
    }
  }
  return headers;
}

function requestUrl(request: ReportableRequest, headers: Record<string, string>): string {
  if (typeof Request !== "undefined" && request instanceof Request) return request.url;
  const node = request as Exclude<ReportableRequest, Request>;
  const path = node.originalUrl ?? node.url ?? "/";
  return `${node.protocol ?? "https"}://${headers.host ?? ""}${path}`;
}

/**
 * Reports a request that carries a Web Bot Auth signature so the collector can check it.
 * A request without one is skipped without a network call. It never throws, so run it without
 * awaiting, or in waitUntil, and the visitor's response never waits for it.
 */
export async function reportSignedRequest(
  request: ReportableRequest,
  options: SignatureReportOptions,
): Promise<SignatureReport> {
  const fail = (error: Error): SignatureReport => {
    (options.onError ?? ((e) => console.warn(`Web Bot Auth report failed: ${e.message}`)))(error);
    return { status: "failed", error };
  };
  try {
    const headers = headerMap(request);
    const input = headers["signature-input"];
    if (!input || !headers.signature) return { status: "skipped" };
    // Send only what the signature covers, so nothing else about the visitor leaves the server.
    const covered = new Set(["signature", "signature-input", "signature-agent"]);
    for (const match of input.matchAll(/"([a-z0-9-]+)"/g)) covered.add(match[1]!);
    const forwarded = Object.fromEntries(
      [...covered]
        .filter((name) => headers[name] !== undefined)
        .map((name) => [name, headers[name]]),
    );
    const api = new URL(options.apiUrl);
    if (!isAllowedOrigin(api.origin) || api.username || api.password || api.search || api.hash) {
      return fail(new Error("Invalid collector API URL"));
    }
    api.pathname = `${api.pathname.replace(/\/$/, "")}/v1/signatures`;
    const response = await (options.fetch ?? globalThis.fetch)(api, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.secret}`,
        "content-type": "application/json",
      },
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        siteId: options.siteId,
        request: {
          method: (request.method ?? "GET").toUpperCase(),
          url: options.url ?? requestUrl(request, headers),
          headers: forwarded,
        },
        ...(options.sessionId ? { sessionId: options.sessionId } : {}),
        ...(options.accountRef ? { accountRef: options.accountRef } : {}),
      }),
    });
    if (!response.ok) return fail(new Error(`The collector answered ${response.status}`));
    const result = (await response.json()) as { event?: Partial<SignatureEvent> } | null;
    const event = result?.event;
    if (!event || event.type !== "signature" || typeof event.id !== "string") {
      return fail(new Error("Invalid response from the collector"));
    }
    return { status: "recorded", event: event as SignatureEvent };
  } catch (error) {
    return fail(error instanceof Error ? error : new Error("Web Bot Auth report failed"));
  }
}
