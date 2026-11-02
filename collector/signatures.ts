import { randomUUID } from "node:crypto";
import { isReference, routePath, type SignatureEvent } from "../src/protocol.js";
import { isUuid } from "../src/server/tokens.js";
import { HttpError } from "./http.js";
import type { Site } from "./products.js";
import type { CollectorStore } from "./store.js";
import {
  signatureEventId,
  verifySignedRequest,
  type KeyDirectory,
  type SignedRequest,
  type Signer,
} from "./web-bot-auth.js";

export const CDN_VERIFIERS = ["cloudflare", "akamai", "vercel"] as const;
type CdnVerifier = (typeof CDN_VERIFIERS)[number];

/** The request a customer's server saw, as it reports it. */
export function signedRequest(value: unknown, needsHeaders: boolean): SignedRequest {
  const data = value as { method?: unknown; url?: unknown; headers?: unknown } | null;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new HttpError(400, "request must be an object");
  }
  if (Object.keys(data).some((key) => !["method", "url", "headers"].includes(key))) {
    throw new HttpError(400, "Unexpected request fields");
  }
  if (typeof data.method !== "string" || !/^[A-Za-z]{1,16}$/.test(data.method)) {
    throw new HttpError(400, "request.method is required");
  }
  let url: URL;
  try {
    url = new URL(String(data.url));
  } catch {
    throw new HttpError(400, "request.url must be an absolute URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new HttpError(400, "request.url must be an absolute URL");
  }
  const headers: Record<string, string> = {};
  if (data.headers !== undefined || needsHeaders) {
    const raw = data.headers as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new HttpError(400, "request.headers must be an object");
    }
    const entries = Object.entries(raw);
    if (entries.length > 32) throw new HttpError(400, "Too many request headers");
    for (const [name, header] of entries) {
      if (!/^[a-z0-9-]{1,64}$/.test(name) || typeof header !== "string" || header.length > 4096) {
        throw new HttpError(400, "Headers must be lowercase names with string values");
      }
      headers[name] = header;
    }
  }
  return { method: data.method, url, headers };
}

/** A CDN's own verdict, passed on by the customer's server. */
export function cdnVerdict(value: unknown): { verifier: CdnVerifier; signer: string } {
  const data = value as { verifier?: unknown; signer?: unknown } | null;
  if (
    !data ||
    typeof data !== "object" ||
    Object.keys(data).some((key) => !["verifier", "signer"].includes(key)) ||
    !CDN_VERIFIERS.includes(data.verifier as CdnVerifier) ||
    typeof data.signer !== "string" ||
    !/^[\x20-\x7e]{1,100}$/.test(data.signer.trim())
  ) {
    throw new HttpError(
      400,
      `cdn must be {verifier, signer}, with verifier one of ${CDN_VERIFIERS.join(", ")}`,
    );
  }
  return { verifier: data.verifier as CdnVerifier, signer: data.signer.trim() };
}

export function reference(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (field === "sessionId" ? !isUuid(value) : !isReference(value)) {
    throw new HttpError(400, `${field} is invalid`);
  }
  return field === "sessionId" ? (value as string).toLowerCase() : (value as string);
}

/**
 * Checks a reported request and records what it showed. The event ID comes from the signature,
 * so a retried report is a duplicate, and the same signature on a different request is
 * recorded as a replay rather than a second verified visit.
 */
export async function recordSignature(input: {
  store: CollectorStore;
  site: Site;
  request: SignedRequest;
  cdn: { verifier: CdnVerifier; signer: string } | null;
  sessionId: string | null;
  accountRef: string | null;
  signers: Signer[];
  keys: KeyDirectory;
  now: number;
}): Promise<SignatureEvent> {
  const { store, site, request, cdn, now } = input;
  const receivedAt = new Date(now).toISOString();
  const base = {
    siteId: site.id,
    sessionId: input.sessionId,
    origin: null,
    type: "signature" as const,
    source: "server" as const,
    receivedAt,
    accountRef: input.accountRef,
    path: routePath(request.url.pathname),
  };
  if (cdn) {
    const event: SignatureEvent = {
      ...base,
      id: randomUUID(),
      evidence: "cdn_reported",
      occurredAt: receivedAt,
      signer: cdn.signer,
      signatureAgent: null,
      result: "verified",
      verifier: cdn.verifier,
    };
    return recorded(await store.recordActivity(event));
  }
  const verification = await verifySignedRequest(request, {
    now,
    authorities: site.origins.map((origin) => new URL(origin).host.toLowerCase()),
    signers: input.signers,
    keys: input.keys,
  });
  const event: SignatureEvent = {
    ...base,
    id: verification.signature ? signatureEventId(site.id, verification.signature) : randomUUID(),
    evidence: verification.result === "verified" ? "signature_verified" : "signature_claimed",
    occurredAt: new Date(verification.createdAt ?? now).toISOString(),
    signer: verification.signer,
    signatureAgent: verification.signatureAgent,
    result: verification.result,
    verifier: null,
  };
  const result = await store.recordActivity(event);
  if (result.status !== "conflict") return recorded(result);
  const replay: SignatureEvent = {
    ...event,
    id: randomUUID(),
    evidence: "signature_claimed",
    result: "replayed",
  };
  return recorded(await store.recordActivity(replay));
}

function recorded(result: Awaited<ReturnType<CollectorStore["recordActivity"]>>): SignatureEvent {
  if (result.status === "conflict" || result.event.type !== "signature") {
    throw new Error("Signature event was not recorded");
  }
  return result.event;
}
