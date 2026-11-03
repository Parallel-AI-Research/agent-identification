import { isActionName, isOutcome, isReference, type Outcome } from "../protocol.js";
import { isAllowedOrigin } from "./tokens.js";

export interface ActionReportOptions {
  apiUrl: string;
  siteId: string;
  /** The site's server secret. Never use it in browser code. */
  secret: string;
  /** Called when a report fails. Defaults to a console warning without any secret. */
  onError?: (error: Error) => void;
  fetch?: typeof globalThis.fetch;
}
export interface ReportedAction {
  /** Your name for it, lowercase, such as ticket.update. */
  action: string;
  /** attempted, rejected, or confirmed once your application says it succeeded. */
  outcome: Outcome;
  /** Your opaque ID for what it acted on, never a name or email address. */
  resourceRef?: string;
  /** Your opaque ID for the account used. It never says who delegated an agent. */
  accountRef?: string;
  /** Your server's own session binding, the one you put in binding contexts. */
  sessionBinding?: string;
  /** Reuse the same ID to retry; a new one is chosen when missing. */
  id?: string;
  occurredAt?: Date;
}
export type ActionReport =
  | { status: "recorded"; id: string; sessionId: string | null; duplicate: boolean }
  | { status: "failed"; id: string; error: Error };

/**
 * Reports what your server did, so it joins the session's activity. It retries with the same
 * ID, never throws, and only says recorded when the collector confirms it.
 */
export async function reportAction(
  input: ReportedAction,
  options: ActionReportOptions,
): Promise<ActionReport> {
  const id = input.id ?? crypto.randomUUID();
  const fail = (error: Error): ActionReport => {
    (options.onError ?? ((e) => console.warn(`Action report failed: ${e.message}`)))(error);
    return { status: "failed", id, error };
  };
  if (!isActionName(input.action)) return fail(new Error("Invalid action name"));
  if (!isOutcome(input.outcome)) return fail(new Error("Invalid outcome"));
  for (const field of ["resourceRef", "accountRef"] as const) {
    if (input[field] !== undefined && !isReference(input[field])) {
      return fail(new Error(`${field} must be an opaque ID`));
    }
  }
  let api: URL;
  try {
    api = new URL(options.apiUrl);
  } catch {
    return fail(new Error("Invalid collector API URL"));
  }
  if (!isAllowedOrigin(api.origin) || api.username || api.password || api.search || api.hash) {
    return fail(new Error("Invalid collector API URL"));
  }
  api.pathname = `${api.pathname.replace(/\/$/, "")}/v1/actions`;
  const body = JSON.stringify({
    siteId: options.siteId,
    actions: [
      {
        id,
        action: input.action,
        outcome: input.outcome,
        occurredAt: (input.occurredAt ?? new Date()).toISOString(),
        ...(input.resourceRef ? { resourceRef: input.resourceRef } : {}),
        ...(input.accountRef ? { accountRef: input.accountRef } : {}),
        ...(input.sessionBinding ? { sessionBinding: input.sessionBinding } : {}),
      },
    ],
  });
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
        body,
      });
      if (!response.ok) {
        retryable = response.status === 429 || response.status >= 500;
        throw new Error(`The collector answered ${response.status}`);
      }
      const result = (await response.json()) as {
        results?: { id?: unknown; status?: unknown; sessionId?: unknown }[];
      } | null;
      const match = result?.results?.find((item) => item.id === id);
      if (!match || (match.status !== "recorded" && match.status !== "duplicate")) {
        retryable = false;
        throw new Error(
          match?.status === "conflict"
            ? "This ID was already used for a different action"
            : "Invalid response from the collector",
        );
      }
      return {
        status: "recorded",
        id,
        sessionId: typeof match.sessionId === "string" ? match.sessionId : null,
        duplicate: match.status === "duplicate",
      };
    } catch (error) {
      const failure = error instanceof Error ? error : new Error("Action report failed");
      if (!retryable || attempt >= 2) return fail(failure);
      await new Promise((resolve) => setTimeout(resolve, 300 * 3 ** attempt));
    }
  }
}
