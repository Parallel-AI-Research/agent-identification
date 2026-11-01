import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, test } from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { createCollector } from "../collector/index.js";
import { supabaseOwnerAuth } from "../collector/owner-auth.js";
import { SecretCipher } from "../collector/products.js";
import { MemoryStore } from "../collector/store.js";

const url = "https://project.supabase.test";
const issuer = `${url}/auth/v1`;
const owner = randomUUID();
let privateKey: CryptoKey;
let otherKey: CryptoKey;
let authenticate: ReturnType<typeof supabaseOwnerAuth>;

before(async () => {
  const pair = await generateKeyPair("ES256");
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair("ES256")).privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "key-1", alg: "ES256", use: "sig" };
  authenticate = supabaseOwnerAuth({ url, keys: createLocalJWKSet({ keys: [jwk] }) });
});

async function token(
  overrides: { claims?: object; issuer?: string; audience?: string; expires?: string } = {},
  key = privateKey,
) {
  return new SignJWT({ role: "authenticated", ...overrides.claims })
    .setProtectedHeader({ alg: "ES256", kid: "key-1" })
    .setSubject(owner)
    .setIssuer(overrides.issuer ?? issuer)
    .setAudience(overrides.audience ?? "authenticated")
    .setIssuedAt()
    .setExpirationTime(overrides.expires ?? "5m")
    .sign(key);
}
const withToken = (value: string) =>
  new Request("https://collector.test/v1/owner/products", {
    headers: { authorization: `Bearer ${value}` },
  });

test("a current Supabase access token identifies its owner", async () => {
  assert.equal(await authenticate(withToken(await token())), owner);
});

test("expired, misdirected, forged and unauthenticated tokens are rejected", async () => {
  const rejected = [
    await token({ expires: "-1m" }),
    await token({ issuer: "https://other.supabase.test/auth/v1" }),
    await token({ audience: "service_role" }),
    await token({ claims: { role: "anon" } }),
    await token({ claims: { role: "service_role" } }),
    await token({}, otherKey),
    `${(await token()).slice(0, -6)}AAAAAA`,
    "not-a-token",
  ];
  for (const value of rejected) assert.equal(await authenticate(withToken(value)), null, value);
});

test("a symmetric token signed with the public key is rejected", async () => {
  const forged = await new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "HS256", kid: "key-1" })
    .setSubject(owner)
    .setIssuer(issuer)
    .setAudience("authenticated")
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode("public-key-material-used-as-a-shared-secret"));
  assert.equal(await authenticate(withToken(forged)), null);
});

test("an authentication outage is a service error, not a failed sign-in", async () => {
  const store = new MemoryStore();
  const handle = createCollector({
    sites: [{ id: "site", origins: ["https://a.test"], secret: "s".repeat(32) }],
    store,
    owners: {
      authenticate: supabaseOwnerAuth({
        url,
        keys: async () => {
          throw new Error("key endpoint unavailable");
        },
      }),
      products: store,
      cipher: new SecretCipher("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"),
    },
  });
  const response = await handle(withToken(await token()));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Service unavailable" });
});
