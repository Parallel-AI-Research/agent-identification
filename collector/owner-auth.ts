import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from "jose";
import { isUuid } from "../src/server/tokens.js";
import { bearer } from "./http.js";

const INVALID_TOKEN = [
  errors.JWTExpired,
  errors.JWTClaimValidationFailed,
  errors.JWTInvalid,
  errors.JWSInvalid,
  errors.JWSSignatureVerificationFailed,
  errors.JOSEAlgNotAllowed,
  errors.JWKSNoMatchingKey,
];

/**
 * Verifies a Supabase access token locally against the project's published keys.
 * Only asymmetric algorithms are accepted, so the collector never holds a signing secret.
 */
export function supabaseOwnerAuth(options: {
  url: string;
  keys?: JWTVerifyGetKey;
}): (request: Request) => Promise<string | null> {
  const issuer = `${options.url.replace(/\/$/, "")}/auth/v1`;
  const keys = options.keys ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return async (request) => {
    const token = bearer(request);
    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer,
        audience: "authenticated",
        algorithms: ["ES256", "RS256"],
      });
      return payload.role === "authenticated" && isUuid(payload.sub) ? payload.sub : null;
    } catch (error) {
      if (INVALID_TOKEN.some((type) => error instanceof type)) return null;
      // A key-fetch failure is an outage, not a bad login, and must not look like one.
      throw error;
    }
  };
}
