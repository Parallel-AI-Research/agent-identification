import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isChoice, type Choice } from "../protocol.js";

export interface SiteConfig {
  id: string;
  origins: string[];
  secret: string;
}

export interface BindingOptions {
  siteId: string;
  origin: string;
  secret: string;
  /** An opaque value derived by your server from its current authenticated session. */
  sessionBinding: string;
  now?: Date;
  expiresInSeconds?: number;
}

interface CommonClaims {
  v: 1;
  siteId: string;
  origin: string;
  iat: number;
  exp: number;
}
export interface ContextClaims extends CommonClaims {
  purpose: "binding_context";
  bindingHash: string;
}
export interface DeclarationClaims extends CommonClaims {
  purpose: "declaration";
  sessionId: string;
  eventId: string;
  choice: Choice;
  bindingHash: string | null;
  evidence: "self_reported";
}

const HEADER = Buffer.from(JSON.stringify({ alg: "HS256", typ: "AID", v: 1 })).toString(
  "base64url",
);
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
export function isSiteId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}
export function isAllowedOrigin(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.origin === value &&
      !url.username &&
      !url.password &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    );
  } catch {
    return false;
  }
}

export function validateSite(site: SiteConfig): void {
  if (
    !isSiteId(site.id) ||
    !Array.isArray(site.origins) ||
    !site.origins.length ||
    site.origins.some((origin) => !isAllowedOrigin(origin)) ||
    typeof site.secret !== "string" ||
    site.secret.length < 32 ||
    site.secret.length > 1024
  ) {
    throw new Error("Invalid site configuration");
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
export function hashBinding(siteId: string, binding: string): string {
  if (typeof binding !== "string" || !binding || binding.length > 2048) {
    throw new Error("sessionBinding must be an opaque, nonempty value");
  }
  return hashToken(JSON.stringify(["agent-identification-binding-v1", siteId, binding]));
}
export function secretEquals(actual: string, expected: string): boolean {
  return timingSafeEqual(
    Buffer.from(hashToken(actual), "hex"),
    Buffer.from(hashToken(expected), "hex"),
  );
}

function seconds(now: Date): number {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid current time");
  return Math.floor(now.getTime() / 1000);
}
function assertSecret(secret: string): void {
  if (typeof secret !== "string" || secret.length < 32 || secret.length > 1024) {
    throw new Error("A server-only site secret of at least 32 characters is required");
  }
}
function sign(claims: ContextClaims | DeclarationClaims, secret: string): string {
  assertSecret(secret);
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signed = `${HEADER}.${payload}`;
  const signature = createHmac("sha256", secret).update(signed).digest("base64url");
  return `${signed}.${signature}`;
}
function verify(
  token: string,
  expected: { siteId: string; origin: string; secret: string; now?: Date },
): Record<string, unknown> {
  assertSecret(expected.secret);
  if (!isSiteId(expected.siteId) || !isAllowedOrigin(expected.origin)) {
    throw new Error("Invalid expected site or origin");
  }
  if (typeof token !== "string" || token.length > 4096) {
    throw new Error("Invalid signed token");
  }
  const parts = token.split(".");
  if (
    parts.length !== 3 ||
    parts[0] !== HEADER ||
    !/^[A-Za-z0-9_-]+$/.test(parts[1]!) ||
    !/^[A-Za-z0-9_-]{43}$/.test(parts[2]!)
  ) {
    throw new Error("Invalid signed token");
  }
  const signature = createHmac("sha256", expected.secret)
    .update(`${parts[0]}.${parts[1]}`)
    .digest("base64url");
  if (!secretEquals(signature, parts[2]!)) throw new Error("Invalid signed token");
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid signed token");
  }
  const now = seconds(expected.now ?? new Date());
  if (
    !claims ||
    Array.isArray(claims) ||
    claims.v !== 1 ||
    claims.siteId !== expected.siteId ||
    claims.origin !== expected.origin ||
    !Number.isSafeInteger(claims.iat) ||
    !Number.isSafeInteger(claims.exp) ||
    (claims.iat as number) > now ||
    (claims.exp as number) <= now ||
    (claims.exp as number) <= (claims.iat as number)
  ) {
    throw new Error("Signed token is invalid or expired");
  }
  return claims;
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join(",") === keys.sort().join(",");
}

/** Mint on your server only, using its current session rather than browser input. */
export function createBindingContext(options: BindingOptions): string {
  const ttl = options.expiresInSeconds ?? 300;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > 900) {
    throw new Error("Binding context lifetime must be 1–900 seconds");
  }
  if (!isSiteId(options.siteId) || !isAllowedOrigin(options.origin)) {
    throw new Error("Invalid site or origin");
  }
  const iat = seconds(options.now ?? new Date());
  return sign(
    {
      v: 1,
      purpose: "binding_context",
      siteId: options.siteId,
      origin: options.origin,
      bindingHash: hashBinding(options.siteId, options.sessionBinding),
      iat,
      exp: iat + ttl,
    },
    options.secret,
  );
}

export function verifyBindingContext(
  token: string,
  expected: { siteId: string; origin: string; secret: string; now?: Date },
): ContextClaims {
  const c = verify(token, expected);
  if (
    c.purpose !== "binding_context" ||
    typeof c.bindingHash !== "string" ||
    !HASH.test(c.bindingHash) ||
    (c.exp as number) - (c.iat as number) > 900 ||
    !exactKeys(c, ["v", "purpose", "siteId", "origin", "bindingHash", "iat", "exp"])
  ) {
    throw new Error("Invalid binding context");
  }
  return c as unknown as ContextClaims;
}

export function mintDeclaration(
  claims: Omit<DeclarationClaims, "v" | "purpose" | "evidence">,
  secret: string,
): string {
  return sign({ ...claims, v: 1, purpose: "declaration", evidence: "self_reported" }, secret);
}

/**
 * Verify a bound receipt against your server's actual current session.
 * A valid declaration is self-reported and does not establish authorization.
 * Receipts remain valid until expiry; use online status for immediate revocation.
 */
export function verifyDeclaration(
  receipt: string,
  expected: Omit<BindingOptions, "expiresInSeconds">,
): DeclarationClaims & { bindingHash: string } {
  const c = verify(receipt, expected);
  const expectedHash = hashBinding(expected.siteId, expected.sessionBinding);
  if (
    c.purpose !== "declaration" ||
    c.evidence !== "self_reported" ||
    !isUuid(c.sessionId) ||
    !isUuid(c.eventId) ||
    !isChoice(c.choice) ||
    typeof c.bindingHash !== "string" ||
    !HASH.test(c.bindingHash) ||
    !secretEquals(c.bindingHash, expectedHash) ||
    (c.exp as number) - (c.iat as number) > 1800 ||
    !exactKeys(c, [
      "v",
      "purpose",
      "siteId",
      "origin",
      "bindingHash",
      "iat",
      "exp",
      "sessionId",
      "eventId",
      "choice",
      "evidence",
    ])
  ) {
    throw new Error("Declaration does not match the active session");
  }
  return c as unknown as DeclarationClaims & { bindingHash: string };
}
