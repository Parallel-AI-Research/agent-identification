import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  createBindingContext,
  verifyDeclaration,
  verifyDeclarationOnline,
} from "../src/server/index.js";
import { hashBinding, mintDeclaration, verifyBindingContext } from "../src/server/tokens.js";

const secret = "test-server-secret-not-for-production-0123456789";
const origin = "https://example.test";
const now = new Date("2026-10-20T10:00:00Z");
const expected = { siteId: "example", secret, origin, sessionBinding: "opaque-login-123", now };
function receipt(
  bindingHash: string | null = hashBinding(expected.siteId, expected.sessionBinding),
) {
  return mintDeclaration(
    {
      siteId: expected.siteId,
      origin,
      sessionId: randomUUID(),
      eventId: randomUUID(),
      bindingHash,
      choice: "ai_assistant",
      iat: now.getTime() / 1000,
      exp: now.getTime() / 1000 + 300,
    },
    secret,
  );
}

test("binding context contains only a session hash and is purpose separated", () => {
  const context = createBindingContext(expected);
  const claims = verifyBindingContext(context, expected);
  assert.equal(claims.bindingHash, hashBinding(expected.siteId, expected.sessionBinding));
  assert.equal(claims.exp - claims.iat, 300);
  assert(
    !Buffer.from(context.split(".")[1]!, "base64url").toString().includes(expected.sessionBinding),
  );
  assert.throws(() => verifyDeclaration(context, expected));
  assert.throws(() => verifyBindingContext(receipt(), expected));
});

test("verified receipt remains self-reported and requires the actual session binding", () => {
  const token = receipt();
  const result = verifyDeclaration(token, expected);
  assert.equal(result.choice, "ai_assistant");
  assert.equal(result.evidence, "self_reported");
  assert.throws(() => verifyDeclaration(token, { ...expected, sessionBinding: "another-login" }));
  assert.throws(() => verifyDeclaration(receipt(null), expected), /active session/);
  assert.throws(() => verifyDeclaration(token, { ...expected, sessionBinding: "" }));
});

test("forgery, wrong secret/site/origin, expiry and future claims fail", () => {
  const token = receipt();
  const parts = token.split(".");
  const altered = {
    ...JSON.parse(Buffer.from(parts[1]!, "base64url").toString()),
    choice: "person",
  };
  const forged = `${parts[0]}.${Buffer.from(JSON.stringify(altered)).toString("base64url")}.${parts[2]}`;
  assert.throws(() => verifyDeclaration(forged, expected));
  assert.throws(() => verifyDeclaration(token, { ...expected, secret: "a".repeat(40) }));
  assert.throws(() => verifyDeclaration(token, { ...expected, siteId: "other" }));
  assert.throws(() => verifyDeclaration(token, { ...expected, origin: "https://other.test" }));
  assert.throws(() =>
    verifyDeclaration(token, { ...expected, now: new Date(now.getTime() + 300000) }),
  );
  assert.throws(() =>
    verifyDeclaration(token, { ...expected, now: new Date(now.getTime() - 1000) }),
  );
});

test("invalid or excessive context lifetimes and unsafe origins are rejected", () => {
  for (const expiresInSeconds of [0, -1, 901, 1.5, NaN]) {
    assert.throws(() => createBindingContext({ ...expected, expiresInSeconds }));
  }
  for (const unsafe of [
    "http://example.test",
    "https://example.test/",
    "null",
    "https://user:pass@example.test",
  ]) {
    assert.throws(() => createBindingContext({ ...expected, origin: unsafe }));
  }
  assert.doesNotThrow(() => createBindingContext({ ...expected, origin: "http://127.0.0.1:4311" }));
  assert.throws(() => createBindingContext({ ...expected, secret: "short" }));
});

test("online verification fails closed on HTTP errors and mismatched successful responses", async () => {
  const token = receipt();
  await assert.rejects(
    verifyDeclarationOnline(token, {
      ...expected,
      apiUrl: "https://collector.test",
      fetch: async () => new Response("{}", { status: 503 }),
    }),
  );
  await assert.rejects(
    verifyDeclarationOnline(token, {
      ...expected,
      apiUrl: "https://collector.test",
      fetch: async () => Response.json({ valid: true, sessionId: "unrelated" }),
    }),
  );
  await assert.rejects(
    verifyDeclarationOnline(token, {
      ...expected,
      apiUrl: "http://collector.test",
      fetch: async () => {
        throw new Error("must not dispatch");
      },
    }),
    /Invalid collector/,
  );
});

test("online verification sends a server-only authorization and verifies exact returned declaration", async () => {
  const token = receipt();
  const claims = verifyDeclaration(token, expected);
  let requests = 0;
  const result = await verifyDeclarationOnline(token, {
    ...expected,
    apiUrl: "https://collector.test",
    fetch: async (url, init) => {
      requests++;
      assert.equal(String(url), "https://collector.test/v1/verify");
      assert.equal(init?.redirect, "error");
      assert.equal(init?.credentials, "omit");
      assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${secret}`);
      assert.equal(new Headers(init?.headers).get("origin"), null);
      assert.equal(JSON.parse(String(init?.body)).sessionBinding, expected.sessionBinding);
      return Response.json({
        valid: true,
        sessionId: claims.sessionId,
        eventId: claims.eventId,
        choice: claims.choice,
        evidence: "self_reported",
      });
    },
  });
  assert.equal(requests, 1);
  assert.deepEqual(result, claims);
});
