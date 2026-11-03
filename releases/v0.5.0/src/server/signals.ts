import { userAgentSignals, type Signal } from "../protocol.js";
import { isAllowedOrigin } from "./tokens.js";
import { headerMap, isAssetRequest, requestUrl, type ReportableRequest } from "./web-bot-auth.js";

export interface SignalReportOptions {
  apiUrl: string;
  siteId: string;
  /** The site's server secret. Never use it in browser code. */
  secret: string;
  /** Your server's own session binding, the one you put in binding contexts. */
  sessionBinding?: string;
  /** Called when a report fails. Defaults to a console warning without any secret. */
  onError?: (error: Error) => void;
  fetch?: typeof globalThis.fetch;
}
export type SignalReport =
  | { status: "skipped" }
  | { status: "recorded"; signals: { signal: Signal; detail: string | null }[] }
  | { status: "failed"; error: Error };

/**
 * Reports what a request's user agent says about automation: a token an AI agent publishes for
 * itself, such as ChatGPT-User, or a headless browser. Anyone can send those, so they're
 * signals, never verification. Requests with neither, and asset requests, are skipped without a
 * network call. It retries with the same IDs and never throws.
 */
export async function reportRequestSignals(
  request: ReportableRequest,
  options: SignalReportOptions,
): Promise<SignalReport> {
  const fail = (error: Error): SignalReport => {
    (options.onError ?? ((e) => console.warn(`Signal report failed: ${e.message}`)))(error);
    return { status: "failed", error };
  };
  try {
    const headers = headerMap(request);
    const found = userAgentSignals(headers["user-agent"] ?? "");
    if (!found.length || isAssetRequest(requestUrl(request, headers), headers)) {
      return { status: "skipped" };
    }
    const api = new URL(options.apiUrl);
    if (!isAllowedOrigin(api.origin) || api.username || api.password || api.search || api.hash) {
      return fail(new Error("Invalid collector API URL"));
    }
    api.pathname = `${api.pathname.replace(/\/$/, "")}/v1/signals`;
    const occurredAt = new Date().toISOString();
    const signals = found.map((item) => ({
      id: crypto.randomUUID(),
      ...item,
      occurredAt,
      ...(options.sessionBinding ? { sessionBinding: options.sessionBinding } : {}),
    }));
    for (let attempt = 0; ; attempt++) {
      let retryable = true;
      try {
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
          body: JSON.stringify({ siteId: options.siteId, signals }),
        });
        if (!response.ok) {
          retryable = response.status === 429 || response.status >= 500;
          throw new Error(`The collector answered ${response.status}`);
        }
        const result = (await response.json()) as {
          results?: { id?: unknown; status?: unknown }[];
        };
        const confirmed = signals.every((signal) =>
          result?.results?.some(
            (item) =>
              item.id === signal.id && (item.status === "recorded" || item.status === "duplicate"),
          ),
        );
        if (!confirmed) {
          retryable = false;
          throw new Error("Invalid response from the collector");
        }
        return { status: "recorded", signals: found };
      } catch (error) {
        const failure = error instanceof Error ? error : new Error("Signal report failed");
        if (!retryable || attempt >= 2) return fail(failure);
        await new Promise((resolve) => setTimeout(resolve, 300 * 3 ** attempt));
      }
    }
  } catch (error) {
    return fail(error instanceof Error ? error : new Error("Signal report failed"));
  }
}
