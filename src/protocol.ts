/** Shared wire protocol. Classifications are always self-reported. */
export const VERSION = "0.3.0";
export const CHOICES = ["ai_assistant", "person", "prefer_not_to_say"] as const;
export type Choice = (typeof CHOICES)[number];
export type Mode = "optional" | "required";
export interface SessionStatus {
  sessionId: string;
  siteId: string;
  origin: string;
  expiresAt: string;
  choice: Choice | null;
  receipt: string | null;
  eventId: string | null;
  evidence: "self_reported";
}
export interface CreatedSession extends SessionStatus {
  sessionToken: string;
}
export interface RecordedDeclaration extends SessionStatus {
  choice: Choice;
  receipt: string;
  eventId: string;
}
export interface ApiError {
  error: string;
}
export function isChoice(value: unknown): value is Choice {
  return typeof value === "string" && (CHOICES as readonly string[]).includes(value);
}

/*
 * Activity events. Each session has one timeline that is appended to and never rewritten,
 * so signals from different sources sit side by side, even when they disagree.
 */
export const EVENT_TYPES = ["declaration", "page_view", "action", "signature"] as const;
export type EventType = (typeof EVENT_TYPES)[number];
/** A browser report can come from any client that copies the public site ID. */
export type EventSource = "browser" | "server";
/**
 * Who vouches for an event: the visitor, the page's script, the host's own server, the
 * collector's own check of a Web Bot Auth signature, or the host's CDN.
 */
export type Evidence =
  | "self_reported"
  | "browser_reported"
  | "host_reported"
  | "signature_verified"
  | "signature_claimed"
  | "cdn_reported";
export const OUTCOMES = ["attempted", "rejected", "confirmed"] as const;
/** `confirmed` means the host's application says the action succeeded. */
export type Outcome = (typeof OUTCOMES)[number];

/** What an agent says about itself. Every field is self-reported, and null means unknown. */
export interface AgentClaim {
  name: string | null;
  provider: string | null;
  purpose: string | null;
}
interface EventBase {
  /** Chosen by the reporter, so a retry with the same ID is recorded once. */
  id: string;
  siteId: string;
  /** The collector session, when the reporter knows it. */
  sessionId: string | null;
  /** The page's origin for browser events; null for server events. */
  origin: string | null;
  source: EventSource;
  evidence: Evidence;
  /** When the reporter says it happened. */
  occurredAt: string;
  /** When the collector received it. */
  receivedAt: string;
  /**
   * The host's opaque reference to the account used, set only by the host's server. It says
   * which account acted, never who delegated an agent to act.
   */
  accountRef: string | null;
}
export interface DeclarationEvent extends EventBase {
  type: "declaration";
  source: "browser";
  evidence: "self_reported";
  choice: Choice;
  agent: AgentClaim;
}
export interface PageViewEvent extends EventBase {
  type: "page_view";
  source: "browser";
  evidence: "browser_reported";
  /** Always passed through `routePath`. */
  path: string;
  /** The host's own route pattern, such as /tickets/:id, when it supplies one. */
  route: string | null;
}
export interface ActionEvent extends EventBase {
  type: "action";
  source: "server";
  evidence: "host_reported";
  /** Named by the host, such as ticket.update. */
  action: string;
  resourceRef: string | null;
  outcome: Outcome;
}
/** Why a Web Bot Auth signature was or wasn't verified. */
export const SIGNATURE_RESULTS = [
  "verified",
  "unknown_signer",
  "bad_signature",
  "expired",
  "replayed",
  "wrong_authority",
  "malformed",
  "key_unavailable",
] as const;
export type SignatureResult = (typeof SIGNATURE_RESULTS)[number];
/**
 * A request that named a Web Bot Auth signer. `signature_verified` means the collector checked
 * the signature against an allowlisted signer's published key; `signature_claimed` means it
 * couldn't, and `result` says why; `cdn_reported` means the host passed on its CDN's verdict.
 * A signature identifies the operator only, never the person or account it acts for.
 */
export interface SignatureEvent extends EventBase {
  type: "signature";
  source: "server";
  evidence: "signature_verified" | "signature_claimed" | "cdn_reported";
  /** The allowlisted signer's name, such as ChatGPT agent, when known. */
  signer: string | null;
  /** The key directory the request named in Signature-Agent. */
  signatureAgent: string | null;
  result: SignatureResult;
  /** The CDN that vouched for a cdn_reported event. */
  verifier: string | null;
  /** The signed request's path, masked like a page view's. */
  path: string | null;
}
export type ActivityEvent = DeclarationEvent | PageViewEvent | ActionEvent | SignatureEvent;

export const MAX_PATH = 512;
const MAX_CLAIM = 100;
const ID_SEGMENTS = [
  /^\d+$/,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^[0-9a-f]{12,}$/i,
  /@/,
  // Letters mixed with three or more digits, as in most generated IDs and tokens.
  /^(?=(?:[^\d]*\d){3})(?=.*[a-z])[a-z0-9_-]{8,}$/i,
];

/**
 * A page path safe to collect: the query and fragment are dropped, and segments that look
 * like IDs become `:id`. Masking only catches what looks like an ID, so hosts with other
 * personal segments should supply their own route pattern.
 */
export function routePath(path: string): string {
  const bare = path.replace(/[?#][\s\S]*$/, "");
  const masked = bare
    .split("/")
    .map((segment) => {
      let text = segment;
      try {
        text = decodeURIComponent(segment);
      } catch {
        // A malformed escape is checked as written.
      }
      return ID_SEGMENTS.some((pattern) => pattern.test(text)) ? ":id" : segment;
    })
    .join("/");
  return (masked.startsWith("/") ? masked : `/${masked}`).slice(0, MAX_PATH);
}
export function isRoutePattern(value: unknown): value is string {
  return typeof value === "string" && /^\/[A-Za-z0-9_.~:/{}*-]{0,255}$/.test(value);
}
/** Account and resource references are opaque IDs, never names or email addresses. */
export function isReference(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
}
export function isActionName(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_.:-]{0,63}$/.test(value);
}
export function isSignatureResult(value: unknown): value is SignatureResult {
  return typeof value === "string" && (SIGNATURE_RESULTS as readonly string[]).includes(value);
}
export function isOutcome(value: unknown): value is Outcome {
  return typeof value === "string" && (OUTCOMES as readonly string[]).includes(value);
}
/** Reads an agent's self-description. Missing or empty fields are unknown; null means invalid. */
export function agentClaim(value: unknown): AgentClaim | null {
  const claim: AgentClaim = { name: null, provider: null, purpose: null };
  if (value === undefined || value === null) return claim;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).some((key) => !(key in claim))) return null;
  for (const key of ["name", "provider", "purpose"] as const) {
    const field = fields[key];
    if (field === undefined || field === null) continue;
    if (typeof field !== "string") return null;
    const text = field.trim();
    // eslint-disable-next-line no-control-regex
    if (text.length > MAX_CLAIM || /[\u0000-\u001f\u007f]/.test(text)) return null;
    claim[key] = text || null;
  }
  return claim;
}
