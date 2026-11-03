import {
  agentClaim,
  isActionName,
  isChoice,
  isOutcome,
  isReference,
  isRoutePattern,
  isSignal,
  isSignatureResult,
  BROWSER_SIGNALS,
  MAX_PATH,
  routePath,
  type ActivityEvent,
  type AgentClaim,
  type Choice,
  type DeclarationEvent,
} from "../src/protocol.js";
import { isUuid } from "../src/server/tokens.js";

export type ActivityResult =
  { status: "recorded" | "duplicate"; event: ActivityEvent } | { status: "conflict" };

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
function isTime(value: string): boolean {
  return ISO_TIME.test(value) && Number.isFinite(Date.parse(value));
}

/** The same rules the database enforces, so memory storage fails where Postgres would. */
export function assertActivity(event: ActivityEvent): void {
  // Postgres returns UUIDs in lowercase, so only lowercase IDs compare equal on a retry.
  const id = (value: string) => isUuid(value) && value === value.toLowerCase();
  const valid =
    id(event.id) &&
    /^[a-zA-Z0-9_-]{1,100}$/.test(event.siteId) &&
    (event.sessionId === null || id(event.sessionId)) &&
    (event.origin === null || event.origin.length <= 200) &&
    isTime(event.occurredAt) &&
    isTime(event.receivedAt) &&
    (event.accountRef === null || isReference(event.accountRef)) &&
    (() => {
      switch (event.type) {
        case "declaration":
          return (
            event.source === "browser" &&
            event.evidence === "self_reported" &&
            event.origin !== null &&
            isChoice(event.choice) &&
            JSON.stringify(agentClaim(event.agent)) === JSON.stringify(event.agent)
          );
        case "page_view":
          return (
            event.source === "browser" &&
            event.evidence === "browser_reported" &&
            event.origin !== null &&
            event.path.length <= MAX_PATH &&
            routePath(event.path) === event.path &&
            (event.route === null || isRoutePattern(event.route))
          );
        case "action":
          return (
            event.source === "server" &&
            event.evidence === "host_reported" &&
            event.origin === null &&
            isActionName(event.action) &&
            (event.resourceRef === null || isReference(event.resourceRef)) &&
            isOutcome(event.outcome)
          );
        case "signature":
          return (
            event.source === "server" &&
            event.origin === null &&
            isSignatureResult(event.result) &&
            (event.path === null || routePath(event.path) === event.path) &&
            (event.signer === null || (event.signer.length >= 1 && event.signer.length <= 100)) &&
            (event.signatureAgent === null ||
              (/^https?:\/\//.test(event.signatureAgent) && event.signatureAgent.length <= 512)) &&
            (event.evidence === "signature_claimed") === (event.result !== "verified") &&
            (event.evidence !== "signature_verified" || event.signer !== null) &&
            (event.evidence === "cdn_reported") ===
              (event.verifier !== null &&
                ["cloudflare", "akamai", "vercel"].includes(event.verifier))
          );
        case "signal":
          return (
            isSignal(event.signal) &&
            (event.detail === null || /^[\x20-\x7e]{1,100}$/.test(event.detail)) &&
            ((event.source === "browser" &&
              event.evidence === "browser_reported" &&
              event.origin !== null &&
              BROWSER_SIGNALS.includes(event.signal)) ||
              (event.source === "server" &&
                event.evidence === "host_reported" &&
                event.origin === null))
          );
        default:
          return false;
      }
    })();
  if (!valid) throw new Error("Invalid activity event");
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, field: unknown) =>
    field && typeof field === "object" && !Array.isArray(field)
      ? Object.fromEntries(Object.entries(field).sort(([a], [b]) => a.localeCompare(b)))
      : field,
  );
}
/** A retry repeats everything except when the collector received it. */
export function sameActivity(a: ActivityEvent, b: ActivityEvent): boolean {
  return canonical({ ...a, receivedAt: null }) === canonical({ ...b, receivedAt: null });
}

export function declarationEvent(
  session: { id: string; siteId: string; origin: string },
  input: { eventId: string; choice: Choice; agent: AgentClaim; now: number },
): DeclarationEvent {
  const at = new Date(input.now).toISOString();
  return {
    id: input.eventId,
    siteId: session.siteId,
    sessionId: session.id,
    origin: session.origin,
    type: "declaration",
    source: "browser",
    evidence: "self_reported",
    occurredAt: at,
    receivedAt: at,
    accountRef: null,
    choice: input.choice,
    agent: { ...input.agent },
  };
}
