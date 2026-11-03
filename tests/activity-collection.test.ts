import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createCollector } from "../collector/index.js";
import { MemoryStore } from "../collector/store.js";
import { createBindingContext, reportAction } from "../src/server/index.js";
import type { ActivityEvent, CreatedSession } from "../src/protocol.js";

const origin = "https://shop.test";
const secret = "test-only-shop-site-secret-0123456789abcdef";
const site = { id: "shop", origins: [origin], secret };
const now = Date.parse("2026-11-02T12:00:00Z");
const at = (offset = 0) => new Date(now + offset).toISOString();

function fixture() {
  const store = new MemoryStore();
  const handle = createCollector({ sites: [site], store, now: () => new Date(now) });
  const request = (path: string, init: RequestInit = {}) =>
    handle(new Request(`https://collector.test${path}`, init));
  const session = async (binding?: string): Promise<CreatedSession> => {
    const bindingContext = binding
      ? createBindingContext({
          siteId: site.id,
          origin,
          secret,
          sessionBinding: binding,
          now: new Date(now),
        })
      : undefined;
    const response = await request("/v1/sessions", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ siteId: site.id, ...(bindingContext ? { bindingContext } : {}) }),
    });
    assert.equal(response.status, 201);
    return response.json() as Promise<CreatedSession>;
  };
  const views = (token: string, data: object, headers: Record<string, string> = {}) =>
    request("/v1/page-views", {
      method: "POST",
      headers: {
        origin,
        "x-agent-site": site.id,
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(data),
    });
  const actions = (data: object, headers: Record<string, string> = {}) =>
    request("/v1/actions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify({ siteId: site.id, ...data }),
    });
  const exported = async (query = "") =>
    (
      (await (
        await request(`/v1/activity?siteId=${site.id}${query}`, {
          headers: { authorization: `Bearer ${secret}` },
        })
      ).json()) as { events: ActivityEvent[] }
    ).events;
  return { handle, request, session, views, actions, exported, store };
}

test("a visit is recorded whether or not the visitor answers, with its path masked by the collector", async () => {
  const { session, views, exported } = fixture();
  const visitor = await session();
  const view = { id: randomUUID(), path: "/tickets/123?tab=history#notes", occurredAt: at() };
  const response = await views(visitor.sessionToken, { views: [view] });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { results: [{ id: view.id, status: "recorded" }] });

  const [recorded] = await exported();
  assert.equal(recorded?.type, "page_view");
  assert.equal(recorded?.type === "page_view" && recorded.path, "/tickets/:id");
  assert.equal(recorded?.sessionId, visitor.sessionId);
  assert.equal(recorded?.origin, origin);
  assert.equal(recorded?.evidence, "browser_reported");
  assert.equal(recorded?.accountRef, null);

  // A retry is recorded once; the same ID for a different page is refused.
  const retry = await views(visitor.sessionToken, { views: [view] });
  assert.deepEqual(await retry.json(), { results: [{ id: view.id, status: "duplicate" }] });
  const changed = await views(visitor.sessionToken, { views: [{ ...view, path: "/pricing" }] });
  assert.deepEqual(await changed.json(), { results: [{ id: view.id, status: "conflict" }] });
  assert.equal((await exported()).length, 1);
});

test("a browser can't set who it is, report another session, or skip the collector's checks", async () => {
  const { request, session, views, exported } = fixture();
  const visitor = await session();
  const view = () => ({ id: randomUUID(), path: "/pricing", occurredAt: at() });
  for (const body of [
    { views: [{ ...view(), accountRef: "acct_42" }] },
    { views: [{ ...view(), sessionId: randomUUID() }] },
    { views: [{ ...view(), occurredAt: at(-2 * 86400000) }] },
    { views: [{ ...view(), route: "/search?q=alice" }] },
    { views: [] },
    { views: Array.from({ length: 11 }, view) },
    { views: [view()], accountRef: "acct_42" },
  ]) {
    assert.equal((await views(visitor.sessionToken, body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await views("x".repeat(43), { views: [view()] })).status, 401);
  assert.equal(
    (await views(visitor.sessionToken, { views: [view()] }, { origin: "https://other.test" }))
      .status,
    403,
  );
  const ended = await request("/v1/sessions/current", {
    method: "DELETE",
    headers: { origin, "x-agent-site": site.id, authorization: `Bearer ${visitor.sessionToken}` },
  });
  assert.equal(ended.status, 204);
  assert.equal((await views(visitor.sessionToken, { views: [view()] })).status, 401);
  assert.deepEqual(await exported(), []);

  const preflight = await request("/v1/page-views", {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": "POST",
      "access-control-request-headers": "authorization, content-type, x-agent-site",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
});

test("server actions link to a session only through the host's own binding", async () => {
  const { session, actions, exported } = fixture();
  const alice = await session("login-alice-1");
  const report = async (action: object) => {
    const response = await actions({
      actions: [{ id: randomUUID(), action: "ticket.update", occurredAt: at(), ...action }],
    });
    assert.equal(response.status, 200);
    return ((await response.json()) as { results: { status: string; sessionId: string }[] })
      .results[0]!;
  };
  const attempted = await report({
    outcome: "attempted",
    sessionBinding: "login-alice-1",
    accountRef: "acct_alice",
    resourceRef: "ticket_7",
  });
  assert.equal(attempted.status, "recorded");
  assert.equal(attempted.sessionId, alice.sessionId);
  assert.equal((await report({ outcome: "confirmed", sessionBinding: "nobody" })).sessionId, null);
  assert.equal((await report({ outcome: "rejected" })).sessionId, null);

  // After signing out and in as someone else, actions follow the new login's session.
  const bob = await session("login-bob-1");
  assert.equal(
    (await report({ outcome: "confirmed", sessionBinding: "login-bob-1" })).sessionId,
    bob.sessionId,
  );
  assert.equal(
    (await report({ outcome: "confirmed", sessionBinding: "login-alice-1" })).sessionId,
    alice.sessionId,
  );

  const timeline = await exported(`&sessionId=${alice.sessionId}&type=action`);
  assert.deepEqual(
    timeline.map((event) => event.type === "action" && `${event.outcome} ${event.evidence}`).sort(),
    ["attempted host_reported", "confirmed host_reported"],
  );
});

test("actions need the site's secret, refuse bad input and record a retry once", async () => {
  const { actions, request } = fixture();
  const action = {
    id: randomUUID(),
    action: "ticket.update",
    outcome: "confirmed",
    occurredAt: at(),
  };
  assert.equal(
    (await actions({ actions: [action] }, { authorization: "Bearer wrong" })).status,
    401,
  );
  assert.equal((await actions({ actions: [action] }, { origin })).status, 403);
  for (const broken of [
    { ...action, action: "Update ticket" },
    { ...action, outcome: "succeeded" },
    { ...action, accountRef: "alice@example.com" },
    { ...action, sessionId: randomUUID() },
    { ...action, occurredAt: "yesterday" },
    { ...action, id: "not-a-uuid" },
  ]) {
    assert.equal((await actions({ actions: [broken] })).status, 400, JSON.stringify(broken));
  }
  // A plain HTTP request is all a non-Node backend needs.
  const plain = await request("/v1/actions", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: `{"siteId":"shop","actions":[{"id":"${action.id}","action":"ticket.update","outcome":"confirmed","occurredAt":"${action.occurredAt}"}]}`,
  });
  assert.equal(
    ((await plain.json()) as { results: { status: string }[] }).results[0]?.status,
    "recorded",
  );
  const retry = await actions({ actions: [action] });
  assert.equal(
    ((await retry.json()) as { results: { status: string }[] }).results[0]?.status,
    "duplicate",
  );
  const exportedFromBrowser = await request(`/v1/activity?siteId=shop`, {
    headers: { authorization: `Bearer ${secret}`, origin },
  });
  assert.equal(exportedFromBrowser.status, 403);
});

test("the Node helper retries with the same ID, never throws and only says recorded when confirmed", async () => {
  const { handle, session } = fixture();
  const alice = await session("login-alice-2");
  const ids: string[] = [];
  let failures = 1;
  const flaky = (async (url: string | URL, init?: RequestInit) => {
    ids.push((JSON.parse(String(init?.body)) as { actions: { id: string }[] }).actions[0]!.id);
    if (failures-- > 0) return new Response("busy", { status: 503 });
    return handle(new Request(url, init));
  }) as typeof fetch;
  const options = { apiUrl: "https://collector.test", siteId: site.id, secret, fetch: flaky };
  const recorded = await reportAction(
    {
      action: "ticket.update",
      outcome: "confirmed",
      sessionBinding: "login-alice-2",
      accountRef: "acct_alice",
      occurredAt: new Date(now),
    },
    options,
  );
  assert.equal(recorded.status, "recorded");
  assert.equal(recorded.status === "recorded" && recorded.sessionId, alice.sessionId);
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);

  const errors: Error[] = [];
  const onError = (error: Error) => errors.push(error);
  const invalid = await reportAction(
    { action: "ticket.update", outcome: "confirmed", accountRef: "alice@example.com" },
    { ...options, onError },
  );
  assert.equal(invalid.status, "failed");
  assert.equal(ids.length, 2);
  const conflict = await reportAction(
    { id: recorded.id, action: "ticket.delete", outcome: "confirmed", occurredAt: new Date(now) },
    { ...options, onError },
  );
  assert.equal(conflict.status, "failed");
  const down = (async () => new Response("down", { status: 503 })) as typeof fetch;
  const unavailable = await reportAction(
    { action: "ticket.update", outcome: "attempted", occurredAt: new Date(now) },
    { ...options, fetch: down, onError },
  );
  assert.equal(unavailable.status, "failed");
  assert.equal(errors.length, 3);
});
