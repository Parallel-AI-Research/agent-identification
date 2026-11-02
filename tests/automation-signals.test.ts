import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createCollector } from "../collector/index.js";
import { MemoryStore } from "../collector/store.js";
import { userAgentSignals } from "../src/protocol.js";
import { createBindingContext, reportRequestSignals } from "../src/server/index.js";
import type { ActivityEvent, CreatedSession } from "../src/protocol.js";

const origin = "https://shop.test";
const secret = "test-only-shop-site-secret-0123456789abcdef";
const site = { id: "shop", origins: [origin], secret };
const now = Date.parse("2026-11-02T12:00:00Z");
const at = new Date(now).toISOString();
const CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

test("a user agent's own claims are read as signals, and ordinary browsers carry none", () => {
  assert.deepEqual(userAgentSignals(CHROME), []);
  assert.deepEqual(
    userAgentSignals(
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
    ),
    [{ signal: "agent_user_agent", detail: "ChatGPT-User" }],
  );
  assert.deepEqual(userAgentSignals("GPTBot/1.2"), [
    { signal: "agent_user_agent", detail: "GPTBot" },
  ]);
  assert.deepEqual(userAgentSignals(CHROME.replace("Chrome/", "HeadlessChrome/")), [
    { signal: "headless_browser", detail: "HeadlessChrome" },
  ]);
  // A token inside another word isn't a claim.
  assert.deepEqual(userAgentSignals("NotGPTBot/1.0"), []);
});

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
    return response.json() as Promise<CreatedSession>;
  };
  const exported = async () =>
    (
      (await (
        await request(`/v1/activity?siteId=${site.id}&type=signal`, {
          headers: { authorization: `Bearer ${secret}` },
        })
      ).json()) as { events: ActivityEvent[] }
    ).events;
  return { handle, request, session, exported };
}

test("a page reports only what it can see, from its own session", async () => {
  const { request, session, exported } = fixture();
  const visitor = await session();
  const send = (signals: object[]) =>
    request("/v1/browser-signals", {
      method: "POST",
      headers: {
        origin,
        "x-agent-site": site.id,
        authorization: `Bearer ${visitor.sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ signals }),
    });
  const webdriver = {
    id: randomUUID(),
    signal: "webdriver",
    detail: "navigator.webdriver",
    occurredAt: at,
  };
  const response = await send([webdriver]);
  assert.deepEqual(await response.json(), { results: [{ id: webdriver.id, status: "recorded" }] });
  for (const broken of [
    { id: randomUUID(), signal: "agent_user_agent", detail: "ChatGPT-User", occurredAt: at },
    { id: randomUUID(), signal: "webdriver", detail: "x".repeat(101), occurredAt: at },
    { id: randomUUID(), signal: "webdriver", sessionBinding: "login-1", occurredAt: at },
  ]) {
    assert.equal((await send([broken])).status, 400, JSON.stringify(broken));
  }
  const [event] = await exported();
  assert.equal(event?.type === "signal" && event.signal, "webdriver");
  assert.equal(event?.evidence, "browser_reported");
  assert.equal(event?.sessionId, visitor.sessionId);
  assert.equal(event?.origin, origin);
});

test("a server reports a user agent's claim, linked through its own binding", async () => {
  const { handle, request, session, exported } = fixture();
  const visitor = await session("login-1");
  const through = (async (url: string | URL, init?: RequestInit) =>
    handle(new Request(url, init))) as typeof fetch;
  const options = {
    apiUrl: "https://collector.test",
    siteId: site.id,
    secret,
    sessionBinding: "login-1",
    fetch: through,
  };
  const claimed = new Request("https://shop.test/pricing", {
    headers: { "user-agent": "Mozilla/5.0; compatible; ChatGPT-User/1.0" },
  });
  // The helper uses the real clock, so the collector here can't be a fixed one.
  const live = createCollector({ sites: [site], store: new MemoryStore() });
  const result = await reportRequestSignals(claimed, {
    ...options,
    fetch: (async (url: string | URL, init?: RequestInit) =>
      live(new Request(url, init))) as typeof fetch,
  });
  assert.deepEqual(result, {
    status: "recorded",
    signals: [{ signal: "agent_user_agent", detail: "ChatGPT-User" }],
  });

  let calls = 0;
  const counting = (async () => {
    calls++;
    return new Response(null, { status: 500 });
  }) as typeof fetch;
  const ordinary = new Request("https://shop.test/pricing", { headers: { "user-agent": CHROME } });
  assert.deepEqual(await reportRequestSignals(ordinary, { ...options, fetch: counting }), {
    status: "skipped",
  });
  const asset = new Request("https://shop.test/logo.png", {
    headers: { "user-agent": "GPTBot/1.2" },
  });
  assert.deepEqual(await reportRequestSignals(asset, { ...options, fetch: counting }), {
    status: "skipped",
  });
  assert.equal(calls, 0);
  const errors: Error[] = [];
  const failed = await reportRequestSignals(claimed, {
    ...options,
    fetch: counting,
    onError: (error) => errors.push(error),
  });
  assert.equal(failed.status, "failed");
  assert.equal(errors.length, 1);

  // The endpoint itself, with the fixed clock.
  const response = await request("/v1/signals", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify({
      siteId: site.id,
      signals: [
        {
          id: randomUUID(),
          signal: "agent_user_agent",
          detail: "Claude-User",
          sessionBinding: "login-1",
          occurredAt: at,
        },
      ],
    }),
  });
  const { results } = (await response.json()) as { results: { sessionId: string }[] };
  assert.equal(results[0]?.sessionId, visitor.sessionId);
  const [event] = await exported();
  assert.equal(event?.evidence, "host_reported");
  assert.equal(event?.source, "server");
  const browserCall = await request("/v1/signals", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json", origin },
    body: JSON.stringify({ siteId: site.id, signals: [] }),
  });
  assert.equal(browserCall.status, 403);
});
