import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { isChoice, VERSION, type SessionStatus } from "../src/protocol.js";
import {
  hashToken,
  isSiteId,
  isUuid,
  mintDeclaration,
  secretEquals,
  validateSite,
  verifyBindingContext,
  verifyDeclaration,
  type SiteConfig,
} from "../src/server/tokens.js";
import type { CollectorStore, StoredSession } from "./store.js";

export type { SiteConfig } from "../src/server/tokens.js";
export interface CollectorOptions {
  sites: SiteConfig[];
  store: CollectorStore;
  now?: () => Date;
  pruneSecret?: string;
  production?: boolean;
  /** Only provide a client identifier obtained from a trusted deployment adapter. */
  trustedClientKey?: (request: Request) => string;
  sessionTtlSeconds?: number;
  retentionDays?: number;
  rateLimit?: {
    windowSeconds: number;
    maxSessions: number;
    maxDeclarations: number;
  };
}
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const MAX_BODY = 8192;
const SESSION_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const PUBLIC_PATHS = new Map<string, string[]>([
  ["/v1/sessions", ["POST"]],
  ["/v1/sessions/current", ["GET", "DELETE"]],
  ["/v1/declarations", ["POST"]],
]);

function bearer(request: Request): string {
  const value = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([^\s]{1,2048})$/i.exec(value);
  if (!match) throw new HttpError(401, "Authentication required");
  return match[1]!;
}
async function body(request: Request, allowedKeys: string[]): Promise<Record<string, unknown>> {
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json"
  ) {
    throw new HttpError(415, "Content-Type must be application/json");
  }
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) {
    throw new HttpError(413, "Request body too large");
  }
  if (!request.body) throw new HttpError(400, "A JSON object is required");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > MAX_BODY) {
        await reader.cancel();
        throw new HttpError(413, "Request body too large");
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "A valid JSON object is required");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.keys(parsed).some((key) => !allowedKeys.includes(key))
  ) {
    throw new HttpError(400, "Unexpected request fields");
  }
  return parsed as Record<string, unknown>;
}
function status(session: StoredSession): SessionStatus {
  return {
    sessionId: session.id,
    siteId: session.siteId,
    origin: session.origin,
    expiresAt: new Date(session.expiresAt).toISOString(),
    choice: session.choice,
    receipt: session.receipt,
    eventId: session.eventId,
    evidence: "self_reported",
  };
}
function boundedInteger(value: number, min: number, max: number, label: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Invalid ${label}`);
  }
}

export function createCollector(
  options: CollectorOptions,
): (request: Request) => Promise<Response> {
  const sites = new Map<string, SiteConfig>();
  for (const site of options.sites) {
    validateSite(site);
    if (sites.has(site.id)) throw new Error("Duplicate site id");
    sites.set(site.id, { ...site, origins: [...site.origins] });
  }
  if (!sites.size) throw new Error("At least one site is required");
  if (options.production && options.store.kind !== "postgres") {
    throw new Error("Production requires persistent Postgres storage");
  }
  if (options.pruneSecret !== undefined && options.pruneSecret.length < 32) {
    throw new Error("Prune secret must have at least 32 characters");
  }
  const store = options.store;
  const clock = options.now ?? (() => new Date());
  const ttl = options.sessionTtlSeconds ?? 1800;
  const retentionDays = options.retentionDays ?? 7;
  const rate = options.rateLimit ?? {
    windowSeconds: 60,
    maxSessions: 30,
    maxDeclarations: 60,
  };
  boundedInteger(ttl, 1, 1800, "session lifetime");
  boundedInteger(retentionDays, 1, 30, "retention");
  boundedInteger(rate.windowSeconds, 1, 3600, "rate window");
  boundedInteger(rate.maxSessions, 1, 10000, "session rate limit");
  boundedInteger(rate.maxDeclarations, 1, 10000, "declaration rate limit");
  const allOrigins = new Set([...sites.values()].flatMap((site) => site.origins));
  let nextPruneAt = 0;

  async function limited(
    request: Request,
    site: SiteConfig,
    category: "sessions" | "declarations",
    now: number,
  ): Promise<void> {
    const clientKey = options.trustedClientKey?.(request) ?? "shared-site";
    if (typeof clientKey !== "string" || !clientKey || clientKey.length > 2048) {
      throw new Error("Invalid trusted client key");
    }
    // HMAC prevents easy enumeration of stored IP-derived bucket identifiers.
    const key = createHmac("sha256", site.secret)
      .update(JSON.stringify([site.id, category, clientKey]))
      .digest("hex");
    const allowed = await store.consumeRate(
      key,
      category === "sessions" ? rate.maxSessions : rate.maxDeclarations,
      rate.windowSeconds * 1000,
      now,
    );
    if (!allowed) throw new HttpError(429, "Too many requests; try again later");
  }
  function siteFor(id: unknown, origin: string | null): SiteConfig {
    const site = isSiteId(id) ? sites.get(id) : undefined;
    if (!site || !origin || !site.origins.includes(origin)) {
      throw new HttpError(403, "Site or origin is not allowed");
    }
    return site;
  }
  async function authenticated(
    request: Request,
    now: number,
    allowRevoked = false,
  ): Promise<{ site: SiteConfig; session: StoredSession }> {
    const site = siteFor(request.headers.get("x-agent-site"), request.headers.get("origin"));
    const token = bearer(request);
    if (!SESSION_TOKEN.test(token)) throw new HttpError(401, "Invalid or expired session");
    const session = await store.getSession(hashToken(token));
    if (
      !session ||
      session.siteId !== site.id ||
      session.origin !== request.headers.get("origin") ||
      (!allowRevoked && (session.revokedAt !== null || session.expiresAt <= now))
    ) {
      throw new HttpError(401, "Invalid or expired session");
    }
    return { site, session };
  }

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    const headers = new Headers({
      "cache-control": "no-store",
      vary: "Origin",
      "x-content-type-options": "nosniff",
    });
    const publicRoute = PUBLIC_PATHS.get(url.pathname);
    if (publicRoute && origin && allOrigins.has(origin)) {
      headers.set("access-control-allow-origin", origin);
    }
    const respond = (payload: unknown, code = 200): Response => {
      const responseHeaders = new Headers(headers);
      if (code !== 204) responseHeaders.set("content-type", "application/json; charset=utf-8");
      return new Response(code === 204 ? null : JSON.stringify(payload), {
        status: code,
        headers: responseHeaders,
      });
    };
    try {
      const now = clock().getTime();
      if (!Number.isFinite(now)) throw new Error("Invalid collector clock");
      if (url.pathname === "/health" && request.method === "GET") {
        await store.checkHealth();
        return respond({ ok: true, version: VERSION, storage: store.kind });
      }
      if (url.pathname === "/v1/events") {
        if (request.method !== "GET") throw new HttpError(405, "Method not allowed");
        if (origin !== null) throw new HttpError(403, "Events require a server-to-server request");
        const site = sites.get(url.searchParams.get("siteId") ?? "");
        if (!site || !secretEquals(bearer(request), site.secret)) {
          throw new HttpError(401, "Invalid site credentials");
        }
        const limitValue = url.searchParams.get("limit") ?? "100";
        if (!/^\d+$/.test(limitValue) || Number(limitValue) < 1 || Number(limitValue) > 1000) {
          throw new HttpError(400, "Limit must be 1–1000");
        }
        return respond({ events: await store.listEvents(site.id, Number(limitValue)) });
      }
      if (url.pathname === "/v1/verify") {
        if (request.method !== "POST") throw new HttpError(405, "Method not allowed");
        if (origin !== null)
          throw new HttpError(403, "Verification requires a server-to-server request");
        const data = await body(request, ["siteId", "origin", "sessionBinding", "receipt"]);
        const site = sites.get(typeof data.siteId === "string" ? data.siteId : "");
        if (!site || !secretEquals(bearer(request), site.secret)) {
          throw new HttpError(401, "Invalid site credentials");
        }
        if (
          typeof data.origin !== "string" ||
          !site.origins.includes(data.origin) ||
          typeof data.sessionBinding !== "string" ||
          typeof data.receipt !== "string"
        )
          throw new HttpError(400, "Invalid verification request");
        let claims;
        try {
          claims = verifyDeclaration(data.receipt, {
            siteId: site.id,
            origin: data.origin,
            sessionBinding: data.sessionBinding,
            secret: site.secret,
            now: new Date(now),
          });
        } catch {
          throw new HttpError(401, "Declaration is invalid or expired");
        }
        const session = await store.getSessionById(claims.sessionId);
        if (
          !session ||
          session.siteId !== site.id ||
          session.origin !== data.origin ||
          session.bindingHash !== claims.bindingHash ||
          session.eventId !== claims.eventId ||
          session.choice !== claims.choice ||
          session.receipt !== data.receipt ||
          session.revokedAt !== null ||
          session.expiresAt <= now
        )
          throw new HttpError(401, "Declaration is no longer active");
        return respond({
          valid: true,
          sessionId: session.id,
          eventId: session.eventId,
          choice: session.choice,
          evidence: "self_reported",
        });
      }
      if (url.pathname === "/internal/prune") {
        if (!["GET", "POST"].includes(request.method))
          throw new HttpError(405, "Method not allowed");
        if (origin !== null)
          throw new HttpError(403, "Pruning requires a server-to-server request");
        if (!options.pruneSecret || !secretEquals(bearer(request), options.pruneSecret)) {
          throw new HttpError(401, "Invalid pruning credentials");
        }
        let total = 0;
        let totalRateBuckets = 0;
        let more = false;
        for (let batch = 0; batch < 100; batch++) {
          const result = await store.prune(now - retentionDays * 86400000, now, 1000);
          total += result.removedSessions;
          totalRateBuckets += result.removedRateBuckets;
          more = result.more;
          if (!more) break;
        }
        return respond({ removedSessions: total, removedRateBuckets: totalRateBuckets, more });
      }
      if (!publicRoute) throw new HttpError(404, "Not found");
      if (!origin || !allOrigins.has(origin)) throw new HttpError(403, "Origin is not allowed");
      if (request.method === "OPTIONS") {
        const intended = request.headers.get("access-control-request-method");
        const requestedHeaders = (request.headers.get("access-control-request-headers") ?? "")
          .split(",")
          .map((v) => v.trim().toLowerCase())
          .filter(Boolean);
        if (
          !intended ||
          !publicRoute.includes(intended) ||
          requestedHeaders.some(
            (name) => !["authorization", "content-type", "x-agent-site"].includes(name),
          )
        )
          throw new HttpError(403, "Preflight request is not allowed");
        headers.set("access-control-allow-methods", [...publicRoute, "OPTIONS"].join(", "));
        headers.set("access-control-allow-headers", "Authorization, Content-Type, X-Agent-Site");
        headers.set(
          "vary",
          "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
        );
        return respond(null, 204);
      }
      if (!publicRoute.includes(request.method)) throw new HttpError(405, "Method not allowed");
      if (now >= nextPruneAt) {
        await store.prune(now - retentionDays * 86400000, now, 100);
        nextPruneAt = now + 60000;
      }
      if (url.pathname === "/v1/sessions") {
        const data = await body(request, ["siteId", "bindingContext"]);
        const site = siteFor(data.siteId, origin);
        await limited(request, site, "sessions", now);
        let bindingHash: string | null = null;
        let expiresAt = Math.floor(now / 1000) * 1000 + ttl * 1000;
        if (data.bindingContext !== undefined) {
          if (typeof data.bindingContext !== "string")
            throw new HttpError(400, "Invalid binding context");
          try {
            const claims = verifyBindingContext(data.bindingContext, {
              siteId: site.id,
              origin,
              secret: site.secret,
              now: new Date(now),
            });
            bindingHash = claims.bindingHash;
            expiresAt = Math.min(expiresAt, claims.exp * 1000);
          } catch {
            throw new HttpError(400, "Invalid or expired binding context");
          }
        }
        const sessionToken = randomBytes(32).toString("base64url");
        const session: StoredSession = {
          id: randomUUID(),
          siteId: site.id,
          origin,
          tokenHash: hashToken(sessionToken),
          bindingHash,
          createdAt: now,
          expiresAt,
          revokedAt: null,
          choice: null,
          receipt: null,
          eventId: null,
          requestId: null,
        };
        await store.createSession(session);
        return respond({ ...status(session), sessionToken }, 201);
      }
      const { site, session } = await authenticated(request, now, request.method === "DELETE");
      if (request.method === "DELETE") {
        await store.revokeSession(session.tokenHash, now);
        return respond(null, 204);
      }
      if (request.method === "GET") return respond(status(session));
      const data = await body(request, ["choice", "requestId"]);
      if (!isChoice(data.choice) || !isUuid(data.requestId)) {
        throw new HttpError(400, "Valid choice and UUID requestId are required");
      }
      await limited(request, site, "declarations", now);
      const eventId = randomUUID();
      const receipt = mintDeclaration(
        {
          siteId: site.id,
          origin: session.origin,
          sessionId: session.id,
          eventId,
          bindingHash: session.bindingHash,
          choice: data.choice,
          iat: Math.floor(now / 1000),
          exp: Math.floor(session.expiresAt / 1000),
        },
        site.secret,
      );
      const outcome = await store.recordDeclaration({
        tokenHash: session.tokenHash,
        choice: data.choice,
        requestId: data.requestId,
        eventId,
        receipt,
        now,
      });
      if (outcome.status !== "recorded") {
        if (outcome.status === "invalid") throw new HttpError(401, "Invalid or expired session");
        throw new HttpError(409, "This session already has a different choice");
      }
      return respond(status(outcome.session));
    } catch (error) {
      if (error instanceof HttpError) {
        if (error.status === 429) headers.set("retry-after", String(rate.windowSeconds));
        return respond({ error: error.message }, error.status);
      }
      // Never serialize raw storage exceptions, tokens, bindings, or credentials.
      return respond({ error: "Service unavailable" }, 503);
    }
  };
}
