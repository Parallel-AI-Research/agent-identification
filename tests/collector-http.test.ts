import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createCollector, type CollectorOptions } from "../collector/index.js";
import { MemoryStore } from "../collector/store.js";
import {
  createBindingContext,
  verifyDeclaration,
  verifyDeclarationOnline,
} from "../src/server/index.js";
import type { CreatedSession, RecordedDeclaration } from "../src/protocol.js";

const origin = "https://first.test";
const otherOrigin = "https://second.test";
const secret = "test-only-site-secret-01234567890123456789";
const otherSecret = "test-only-other-secret-012345678901234567";
const pruneSecret = "test-only-prune-secret-012345678901234567";
const sites = [
  { id: "first", origins: [origin, otherOrigin], secret },
  { id: "second", origins: [otherOrigin], secret: otherSecret },
];
const initialTime = Date.parse("2026-10-20T10:00:00Z");

function fixture(overrides: Partial<CollectorOptions> = {}) {
  let time = initialTime;
  const store = new MemoryStore();
  const handle = createCollector({
    sites,
    store,
    pruneSecret,
    now: () => new Date(time),
    ...overrides,
  });
  const request = (path: string, init: RequestInit = {}) =>
    handle(new Request(`https://collector.test${path}`, init));
  const create = async (
    data: object = { siteId: "first" },
    usedOrigin = origin,
  ): Promise<CreatedSession> => {
    const response = await request("/v1/sessions", {
      method: "POST",
      headers: { origin: usedOrigin, "content-type": "application/json" },
      body: JSON.stringify(data),
    });
    assert.equal(response.status, 201);
    return response.json() as Promise<CreatedSession>;
  };
  const headers = (
    session: CreatedSession,
    usedOrigin = session.origin,
    siteId = session.siteId,
  ) => ({
    origin: usedOrigin,
    "x-agent-site": siteId,
    authorization: `Bearer ${session.sessionToken}`,
    "content-type": "application/json",
  });
  const declare = (session: CreatedSession, choice = "ai_assistant", requestId = randomUUID()) =>
    request("/v1/declarations", {
      method: "POST",
      headers: headers(session),
      body: JSON.stringify({ choice, requestId }),
    });
  return {
    store,
    request,
    create,
    headers,
    declare,
    advance: (ms: number) => {
      time += ms;
    },
    now: () => new Date(time),
  };
}

test("all choices record durable self-reported events with exact explicit CORS", async () => {
  const f = fixture();
  for (const choice of ["ai_assistant", "person", "prefer_not_to_say"]) {
    const session = await f.create();
    assert.match(session.sessionToken, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(session.choice, null);
    const response = await f.declare(session, choice);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
    assert.equal(response.headers.get("access-control-allow-credentials"), null);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const recorded = (await response.json()) as RecordedDeclaration;
    assert.equal(recorded.choice, choice);
    assert.equal(recorded.evidence, "self_reported");
    assert.equal("sessionToken" in recorded, false);
    const status = await f.request("/v1/sessions/current", { headers: f.headers(session) });
    assert.deepEqual(await status.json(), recorded);
  }
  const response = await f.request("/v1/events?siteId=first", {
    headers: { authorization: `Bearer ${secret}` },
  });
  const data = (await response.json()) as { events: Record<string, unknown>[] };
  assert.equal(data.events.length, 3);
  assert.deepEqual(Object.keys(data.events[0]!).sort(), [
    "choice",
    "createdAt",
    "evidence",
    "id",
    "origin",
    "sessionId",
    "siteId",
  ]);
});

test("sessions cannot cross sites or origins, including another allowed origin of the same site", async () => {
  const f = fixture();
  const session = await f.create();
  for (const headers of [
    f.headers(session, otherOrigin),
    f.headers(session, otherOrigin, "second"),
  ]) {
    const response = await f.request("/v1/sessions/current", { headers });
    assert.equal(response.status, 401);
  }
  for (const attempted of [
    null,
    "null",
    "https://first.test.attacker.test",
    "https://unknown.test",
  ]) {
    const response = await f.request("/v1/sessions", {
      method: "POST",
      headers: { ...(attempted ? { origin: attempted } : {}), "content-type": "application/json" },
      body: JSON.stringify({ siteId: "first" }),
    });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  }
  const unknown = await f.request("/v1/sessions/current", {
    headers: { ...f.headers(session), authorization: `Bearer ${"A".repeat(43)}` },
  });
  assert.equal(unknown.status, 401);
});

test("CORS preflight is explicit and rejects unsupported methods and headers", async () => {
  const f = fixture();
  const response = await f.request("/v1/declarations", {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": "POST",
      "access-control-request-headers": "authorization,content-type,x-agent-site",
    },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
  const preflights: Record<string, string>[] = [
    { "access-control-request-method": "PATCH" },
    { "access-control-request-method": "POST", "access-control-request-headers": "x-arbitrary" },
  ];
  for (const extra of preflights) {
    assert.equal(
      (
        await f.request("/v1/declarations", {
          method: "OPTIONS",
          headers: { origin, ...extra },
        })
      ).status,
      403,
    );
  }
});

test("concurrent identical submissions are idempotent; conflicting choices never replace the first", async () => {
  const f = fixture();
  const session = await f.create();
  const key = randomUUID();
  const responses = await Promise.all(
    Array.from({ length: 10 }, () => f.declare(session, "person", key)),
  );
  const recorded = await Promise.all(
    responses.map(async (r) => {
      assert.equal(r.status, 200);
      return r.json();
    }),
  );
  assert.equal(new Set(recorded.map((r) => r.eventId)).size, 1);
  assert.equal((await f.declare(session, "ai_assistant", key)).status, 409);
  assert.equal((await f.declare(session, "ai_assistant")).status, 409);
  assert.equal((await f.store.listEvents("first", 100)).length, 1);
  const fresh = await f.create();
  const mixed = await Promise.all([f.declare(fresh, "person"), f.declare(fresh, "ai_assistant")]);
  assert.deepEqual(mixed.map((r) => r.status).sort(), [200, 409]);
});

test("revocation is idempotent, invalidates subsequent reads/writes, and a new session starts empty", async () => {
  const f = fixture();
  const session = await f.create();
  assert.equal((await f.declare(session)).status, 200);
  for (let n = 0; n < 2; n++) {
    assert.equal(
      (await f.request("/v1/sessions/current", { method: "DELETE", headers: f.headers(session) }))
        .status,
      204,
    );
  }
  assert.equal(
    (await f.request("/v1/sessions/current", { headers: f.headers(session) })).status,
    401,
  );
  assert.equal((await f.declare(session)).status, 401);
  const fresh = await f.create();
  assert.notEqual(fresh.sessionId, session.sessionId);
  assert.equal(fresh.choice, null);
  assert.equal((await f.store.listEvents("first", 100)).length, 1);
});

test("expiry rejects status, writes, and signed context reuse", async () => {
  const f = fixture();
  const context = createBindingContext({
    siteId: "first",
    secret,
    origin,
    sessionBinding: "login",
    now: f.now(),
    expiresInSeconds: 60,
  });
  const session = await f.create({ siteId: "first", bindingContext: context });
  assert.equal(Date.parse(session.expiresAt), initialTime + 60000);
  f.advance(60000);
  assert.equal(
    (await f.request("/v1/sessions/current", { headers: f.headers(session) })).status,
    401,
  );
  assert.equal((await f.declare(session)).status, 401);
  const response = await f.request("/v1/sessions", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ siteId: "first", bindingContext: context }),
  });
  assert.equal(response.status, 400);
});

test("online verification requires secret+actual binding and observes reset revocation immediately", async () => {
  const f = fixture();
  const expected = { siteId: "first", origin, secret, sessionBinding: "real-login", now: f.now() };
  const session = await f.create({
    siteId: "first",
    bindingContext: createBindingContext(expected),
  });
  const declaration = (await (await f.declare(session)).json()) as RecordedDeclaration;
  const options = {
    ...expected,
    apiUrl: "https://collector.test",
    fetch: ((url: RequestInfo | URL, init?: RequestInit) =>
      f.request(new URL(String(url)).pathname, init)) as typeof fetch,
  };
  assert.equal(
    (await verifyDeclarationOnline(declaration.receipt, options)).sessionId,
    session.sessionId,
  );
  assert.throws(() =>
    verifyDeclaration(declaration.receipt, { ...expected, sessionBinding: "other-login" }),
  );
  const browserVerify = await f.request("/v1/verify", {
    method: "POST",
    headers: { origin, authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify({ ...expected, receipt: declaration.receipt }),
  });
  assert.equal(browserVerify.status, 403);
  assert.equal(browserVerify.headers.get("access-control-allow-origin"), null);
  await f.request("/v1/sessions/current", { method: "DELETE", headers: f.headers(session) });
  assert.doesNotThrow(() => verifyDeclaration(declaration.receipt, expected));
  await assert.rejects(verifyDeclarationOnline(declaration.receipt, options), /not active/);
  const anonymous = await f.create();
  const anonDeclaration = (await (await f.declare(anonymous)).json()) as RecordedDeclaration;
  await assert.rejects(verifyDeclarationOnline(anonDeclaration.receipt, options));
});

test("malformed, oversized and unexpected bodies fail before recording", async () => {
  const f = fixture();
  const session = await f.create();
  for (const [body, expectedStatus, contentType] of [
    ["{", 400, "application/json"],
    ["[]", 400, "application/json"],
    [JSON.stringify({ choice: "robot", requestId: randomUUID() }), 400, "application/json"],
    [JSON.stringify({ choice: "person", requestId: "not-uuid" }), 400, "application/json"],
    [
      JSON.stringify({ choice: "person", requestId: randomUUID(), siteId: "second" }),
      400,
      "application/json",
    ],
    ["x".repeat(8193), 413, "application/json"],
    ["{}", 415, "text/plain"],
  ] as const) {
    const response = await f.request("/v1/declarations", {
      method: "POST",
      headers: { ...f.headers(session), "content-type": contentType },
      body,
    });
    assert.equal(response.status, expectedStatus);
  }
  assert.equal((await f.store.listEvents("first", 100)).length, 0);
});

test("rate limits use trusted per-client buckets and reset after their window", async () => {
  const f = fixture({
    rateLimit: { windowSeconds: 10, maxSessions: 1, maxDeclarations: 1 },
    trustedClientKey: () => "trusted-client",
  });
  const first = await f.create();
  const blocked = await f.request("/v1/sessions", {
    method: "POST",
    headers: { origin, "content-type": "application/json", "x-forwarded-for": "forged-new-ip" },
    body: JSON.stringify({ siteId: "first" }),
  });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("retry-after"), "10");
  assert.equal((await f.declare(first)).status, 200);
  assert.equal((await f.declare(first)).status, 429);
  f.advance(10000);
  await f.create();
});

test("events and pruning need server secrets, isolate sites and omit private values", async () => {
  const f = fixture();
  const first = await f.create();
  await f.declare(first);
  const second = await f.create({ siteId: "second" }, otherOrigin);
  await f.declare(second, "person");
  const invalidHeaders: Record<string, string>[] = [
    {},
    { authorization: `Bearer ${otherSecret}` },
    { origin, authorization: `Bearer ${secret}` },
  ];
  for (const headers of invalidHeaders) {
    const response = await f.request("/v1/events?siteId=first", { headers });
    assert([401, 403].includes(response.status));
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  }
  const result = await f.request("/v1/events?siteId=first&limit=1", {
    headers: { authorization: `Bearer ${secret}` },
  });
  const text = await result.text();
  assert(!text.includes(first.sessionToken));
  assert(!text.includes("bindingHash"));
  assert(!text.includes("receipt"));
  assert.equal(JSON.parse(text).events.length, 1);
  assert.equal(JSON.parse(text).events[0].siteId, "first");
  assert.equal(
    (
      await f.request("/v1/events?siteId=first&limit=1001", {
        headers: { authorization: `Bearer ${secret}` },
      })
    ).status,
    400,
  );
  assert.equal((await f.request("/internal/prune", { method: "POST" })).status, 401);
  f.advance(8 * 86400000);
  const prune = await f.request("/internal/prune", {
    method: "POST",
    headers: { authorization: `Bearer ${pruneSecret}` },
  });
  assert.equal(prune.status, 200);
  assert.equal((await prune.json()).removedSessions, 2);
  assert.equal((await f.store.listEvents("first", 100)).length, 0);
  assert.equal((await f.store.listEvents("second", 100)).length, 0);
});

test("production refuses memory and storage failures do not disclose exception secrets", async () => {
  assert.throws(
    () => createCollector({ sites, store: new MemoryStore(), production: true }),
    /Postgres/,
  );
  const store = new MemoryStore();
  store.createSession = async () => {
    throw new Error("postgres password=private-secret");
  };
  const f = fixture({ store });
  const response = await f.request("/v1/sessions", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ siteId: "first" }),
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Service unavailable" });
});

test("pruning drains expired rate-only backlogs larger than a batch", async () => {
  const f = fixture();
  for (let index = 0; index < 1500; index++) {
    await f.store.consumeRate(`expired-${index}`, 10, 1000, initialTime - 2000);
  }
  const response = await f.request("/internal/prune", {
    method: "POST",
    headers: { authorization: `Bearer ${pruneSecret}` },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    removedSessions: 0,
    removedRateBuckets: 1500,
    more: false,
  });
  assert.deepEqual(await f.store.prune(initialTime - 7 * 86400000, initialTime, 1000), {
    removedSessions: 0,
    removedRateBuckets: 0,
    more: false,
  });
});

test("health checks storage on every request and returns 503 without database details on failure", async () => {
  const store = new MemoryStore();
  let checks = 0;
  store.checkHealth = async () => {
    checks++;
    if (checks > 1) throw new Error("connection refused postgres password=private-secret");
  };
  const f = fixture({ store });
  const healthy = await f.request("/health");
  assert.equal(healthy.status, 200);
  assert.deepEqual(await healthy.json(), { ok: true, version: "0.1.0", storage: "memory" });
  const unhealthy = await f.request("/health");
  assert.equal(checks, 2);
  assert.equal(unhealthy.status, 503);
  assert.deepEqual(await unhealthy.json(), { error: "Service unavailable" });
  assert.equal(unhealthy.headers.get("cache-control"), "no-store");
});
