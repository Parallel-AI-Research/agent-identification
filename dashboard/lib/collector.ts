import "server-only";
import { redirect } from "next/navigation";
import { supabaseServer } from "./supabase/server";

export interface InstallIssue {
  signal: "origin_refused" | "secret_refused" | "binding_refused";
  origin: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}
/** Only traffic the collector received changes this. */
export interface InstallStatus {
  status: "waiting" | "receiving";
  loaded: { origin: string; firstSeenAt: string; lastSeenAt: string }[];
  /** The last report the collector accepted from the customer's server. */
  lastServerReportAt: string | null;
  lastDeclarationAt: string | null;
  /** The collector's time, which relative times are measured from. */
  checkedAt: string;
  issues: InstallIssue[];
}
export interface Environment {
  id: string;
  productId: string;
  type: "production" | "beta" | "staging" | "dev";
  name: string;
  siteId: string;
  origins: string[];
  previousSecretExpiresAt: string | null;
  install: InstallStatus;
  createdAt: string;
  updatedAt: string;
}
export interface Product {
  id: string;
  name: string;
  /** Production comes first. */
  environments: Environment[];
  createdAt: string;
  updatedAt: string;
}
/** Restorable until `restorableUntil`, then removed for good. */
export interface DeletedProduct {
  id: string;
  name: string;
  deletedAt: string;
  restorableUntil: string;
}
export interface Domain {
  domain: string;
  status: "unverified" | "verified" | "not_applicable";
  record: { type: string; name: string; value: string } | null;
}
/** A request that named a Web Bot Auth signer, as the collector recorded it. */
export interface SignedVisit {
  id: string;
  type: "signature";
  evidence: "signature_verified" | "signature_claimed" | "cdn_reported";
  signer: string | null;
  signatureAgent: string | null;
  result:
    | "verified"
    | "unknown_signer"
    | "bad_signature"
    | "expired"
    | "replayed"
    | "wrong_authority"
    | "malformed"
    | "key_unavailable";
  verifier: string | null;
  path: string | null;
  occurredAt: string;
  receivedAt: string;
}

export class CollectorError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Calls the owner API as the signed-in customer. The collector enforces ownership. */
export async function collector<T>(path: string, init: RequestInit = {}): Promise<T> {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getSession();
  if (!data.session) redirect("/sign-in");
  let response: Response;
  try {
    response = await fetch(`${process.env.COLLECTOR_URL}/v1/owner${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        authorization: `Bearer ${data.session.access_token}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
    });
  } catch {
    throw new CollectorError("The service is unavailable. Try again shortly.", 503);
  }
  if (response.status === 401) redirect("/sign-in");
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String(payload.error)
        : "The service is unavailable. Try again shortly.";
    throw new CollectorError(message, response.status);
  }
  return payload as T;
}

export type SessionLabel =
  "verified_signer" | "declared_ai" | "suspected_automation" | "declared_person" | "unknown";
type Outcomes = { attempted: number; rejected: number; confirmed: number };
export interface SessionSummary {
  sessionId: string;
  origin: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  label: SessionLabel;
  conflicts: string[];
  pageViews: number;
  actions: Outcomes;
  declaration: {
    choice: "ai_assistant" | "person" | "prefer_not_to_say";
    agent: { name: string | null; provider: string | null; purpose: string | null };
  } | null;
  verifiedSigners: string[];
  unverifiedSignatures: number;
  automationSignals: string[];
}
export interface Analytics {
  range: "24h" | "7d" | "30d";
  from: string;
  checkedAt: string;
  truncated: boolean;
  overview: {
    sessions: number;
    labels: Record<SessionLabel, number>;
    pageViews: number;
    signedRequests: { verified: number; unverified: number };
    actions: Outcomes;
    declarations: { ai_assistant: number; person: number; prefer_not_to_say: number };
    signals: number;
    withoutSession: { actions: number; signedRequests: number; signals: number };
  };
  sessions: SessionSummary[];
}
/** One event on a session's timeline. Fields beyond the shared ones depend on its type. */
export interface ActivityItem {
  id: string;
  type: "declaration" | "page_view" | "action" | "signature" | "signal";
  evidence: string;
  occurredAt: string;
  receivedAt: string;
  sessionId: string | null;
  origin: string | null;
  accountRef: string | null;
  choice?: "ai_assistant" | "person" | "prefer_not_to_say";
  agent?: { name: string | null; provider: string | null; purpose: string | null };
  path?: string | null;
  route?: string | null;
  action?: string;
  resourceRef?: string | null;
  outcome?: "attempted" | "rejected" | "confirmed";
  signer?: string | null;
  signatureAgent?: string | null;
  result?: string;
  verifier?: string | null;
  signal?: "webdriver" | "headless_browser" | "agent_user_agent";
  detail?: string | null;
}
