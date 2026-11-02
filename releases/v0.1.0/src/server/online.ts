import {
  isAllowedOrigin,
  verifyDeclaration,
  type BindingOptions,
  type DeclarationClaims,
} from "./tokens.js";

export interface OnlineVerificationOptions extends Omit<BindingOptions, "expiresInSeconds"> {
  apiUrl: string;
  fetch?: typeof globalThis.fetch;
}

/**
 * Verify the signature, actual host-session binding, and current collector state.
 * Call from your server immediately before the protected action, after checking
 * the user's ordinary permissions. Any error must deny/defer that action.
 */
export async function verifyDeclarationOnline(
  receipt: string,
  options: OnlineVerificationOptions,
): Promise<DeclarationClaims & { bindingHash: string }> {
  const claims = verifyDeclaration(receipt, options);
  const url = new URL(options.apiUrl);
  if (!isAllowedOrigin(url.origin) || url.username || url.password || url.search || url.hash)
    throw new Error("Invalid collector API URL");
  url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/verify`;
  const response = await (options.fetch ?? globalThis.fetch)(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.secret}`,
      "content-type": "application/json",
    },
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10000),
    body: JSON.stringify({
      siteId: options.siteId,
      origin: options.origin,
      sessionBinding: options.sessionBinding,
      receipt,
    }),
  });
  if (!response.ok) throw new Error("Declaration is not active or verification is unavailable");
  const result: unknown = await response.json();
  if (
    !result ||
    typeof result !== "object" ||
    !("valid" in result) ||
    result.valid !== true ||
    !("sessionId" in result) ||
    result.sessionId !== claims.sessionId ||
    !("eventId" in result) ||
    result.eventId !== claims.eventId ||
    !("choice" in result) ||
    result.choice !== claims.choice ||
    !("evidence" in result) ||
    result.evidence !== "self_reported"
  )
    throw new Error("Invalid declaration verification response");
  return claims;
}
