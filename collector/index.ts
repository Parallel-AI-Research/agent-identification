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
import { bearer, body, eventLimit, HttpError } from "./http.js";
import { handleOwnerRequest, type OwnerApiOptions } from "./owner-api.js";
import {
  activeSecrets,
  secretFingerprint,
  staticDirectory,
  type Site,
  type SiteDirectory,
} from "./products.js";
import type { CollectorStore, StoredSession } from "./store.js";

export type { SiteConfig } from "../src/server/tokens.js";
export interface CollectorOptions {
  /** Fixed sites for tests and local fixtures. Deployments use `directory`. */
  sites?: SiteConfig[];
  directory?: SiteDirectory;
  /** Enables the customer API. Without it, owner routes do not exist. */
  owners?: OwnerApiOptions;
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
const SESSION_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const PUBLIC_PATHS = new Map<string, string[]>([
  ["/v1/sessions", ["POST"]],
  ["/v1/sessions/current", ["GET", "DELETE"]],
  ["/v1/declarations", ["POST"]],
]);

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
  const fixed = options.sites ?? [];
  const seen = new Set<string>();
  for (const site of fixed) {
    validateSite(site);
    if (seen.has(site.id)) throw new Error("Duplicate site id");
    seen.add(site.id);
  }
  if (!seen.size && !options.directory) throw new Error("At least one site is required");
  const directory = options.directory ?? staticDirectory(fixed);
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
  let nextPruneAt = 0;

  async function limited(
    request: Request,
    site: Site,
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
  async function lookup(id: unknown): Promise<Site | null> {
    return isSiteId(id) ? directory.find(id) : null;
  }
  async function siteFor(id: unknown, origin: string | null): Promise<Site> {
    const site = await lookup(id);
    if (!site || !origin || !site.origins.includes(origin)) {
      throw new HttpError(403, "Site or origin is not allowed");
    }
    return site;
  }
  function holdsSecret(request: Request, site: Site | null, now: number): site is Site {
    if (!site) return false;
    const token = bearer(request);
    return activeSecrets(site, now).some((secret) => secretEquals(token, secret));
  }
  async function authenticated(
    request: Request,
    now: number,
    allowRevoked = false,
  ): Promise<{ site: Site; session: StoredSession }> {
    const site = await siteFor(request.headers.get("x-agent-site"), request.headers.get("origin"));
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
      const knownOrigin = publicRoute && origin ? await directory.hasOrigin(origin) : false;
      if (knownOrigin) headers.set("access-control-allow-origin", origin!);
      if (url.pathname === "/health" && request.method === "GET") {
        await store.checkHealth();
        return respond({ ok: true, version: VERSION, storage: store.kind });
      }
      if (url.pathname === "/v1/events") {
        if (request.method !== "GET") throw new HttpError(405, "Method not allowed");
        if (origin !== null) throw new HttpError(403, "Events require a server-to-server request");
        const site = await lookup(url.searchParams.get("siteId"));
        if (!holdsSecret(request, site, now)) {
          throw new HttpError(401, "Invalid site credentials");
        }
        return respond({ events: await store.listEvents(site.id, eventLimit(url)) });
      }
      if (url.pathname === "/v1/verify") {
        if (request.method !== "POST") throw new HttpError(405, "Method not allowed");
        if (origin !== null)
          throw new HttpError(403, "Verification requires a server-to-server request");
        const data = await body(request, ["siteId", "origin", "sessionBinding", "receipt"]);
        const site = await lookup(data.siteId);
        if (!holdsSecret(request, site, now)) {
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
        for (const secret of activeSecrets(site, now)) {
          try {
            claims = verifyDeclaration(data.receipt, {
              siteId: site.id,
              origin: data.origin,
              sessionBinding: data.sessionBinding,
              secret,
              now: new Date(now),
            });
            break;
          } catch {
            // During a rotation the receipt may belong to the other active secret.
          }
        }
        if (!claims) throw new HttpError(401, "Declaration is invalid or expired");
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
      if (options.owners && url.pathname.startsWith("/v1/owner/")) {
        return await handleOwnerRequest(request, url, {
          owners: options.owners,
          store,
          directory,
          now,
          respond,
        });
      }
      if (!publicRoute) throw new HttpError(404, "Not found");
      if (!origin || !knownOrigin) throw new HttpError(403, "Origin is not allowed");
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
        const site = await siteFor(data.siteId, origin);
        await limited(request, site, "sessions", now);
        let bindingHash: string | null = null;
        let signingSecretHash: string | null = null;
        let expiresAt = Math.floor(now / 1000) * 1000 + ttl * 1000;
        if (data.bindingContext !== undefined) {
          if (typeof data.bindingContext !== "string")
            throw new HttpError(400, "Invalid binding context");
          let claims;
          for (const secret of activeSecrets(site, now)) {
            try {
              claims = verifyBindingContext(data.bindingContext, {
                siteId: site.id,
                origin,
                secret,
                now: new Date(now),
              });
              signingSecretHash = secretFingerprint(secret);
              break;
            } catch {
              // During a rotation the context may use the other active secret.
            }
          }
          if (!claims) throw new HttpError(400, "Invalid or expired binding context");
          bindingHash = claims.bindingHash;
          expiresAt = Math.min(expiresAt, claims.exp * 1000);
        }
        const sessionToken = randomBytes(32).toString("base64url");
        const session: StoredSession = {
          id: randomUUID(),
          siteId: site.id,
          origin,
          tokenHash: hashToken(sessionToken),
          bindingHash,
          signingSecretHash,
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
      // A customer's server checks receipts with its own secret, so a session bound by
      // a not-yet-replaced secret must be answered with that same secret.
      const signingSecret =
        activeSecrets(site, now).find(
          (secret) => secretFingerprint(secret) === session.signingSecretHash,
        ) ?? site.secret;
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
        signingSecret,
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
