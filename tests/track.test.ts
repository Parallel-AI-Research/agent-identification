import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";
import { JSDOM } from "jsdom";
import { track, type Tracker, type TrackerOptions } from "../src/browser/index.js";
import { storageKey } from "../src/browser/shared.js";

const originalFetch = globalThis.fetch;
const disposables: (() => void)[] = [];
let sequence = 0;
const page = "<main><h1>Pricing</h1></main>";

interface Sent {
  path: string;
  token: string | null;
  body: Record<string, unknown>;
}

function environment(url = "http://localhost:4200/") {
  const dom = new JSDOM(page, { url });
  const names = ["window", "document", "HTMLElement", "sessionStorage"] as const;
  for (const name of names) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
    disposables.push(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  disposables.push(() => dom.window.close());
  const options: TrackerOptions = { siteId: `site-${++sequence}`, apiUrl: "http://localhost:4310" };
  return { options, dom };
}

function automated(webdriver: boolean) {
  const previous = Object.getOwnPropertyDescriptor(globalThis.navigator, "webdriver");
  Object.defineProperty(globalThis.navigator, "webdriver", {
    configurable: true,
    get: () => webdriver,
  });
  disposables.push(() => {
    if (previous) Object.defineProperty(globalThis.navigator, "webdriver", previous);
    else Reflect.deleteProperty(globalThis.navigator, "webdriver");
  });
}

function start(options: TrackerOptions): Tracker {
  const tracker = track(options);
  disposables.push(() => tracker.destroy());
  return tracker;
}

function json(value: unknown, code = 200): Response {
  return new Response(JSON.stringify(value), {
    status: code,
    headers: { "Content-Type": "application/json" },
  });
}

/** A collector that records what it receives. `refuse` decides a status for any request. */
function collector(options: TrackerOptions, refuse: (sent: Sent) => number | null = () => null) {
  const sent: Sent[] = [];
  let sessions = 0;
  globalThis.fetch = async (url, request) => {
    const headers = new Headers(request?.headers);
    const entry: Sent = {
      path: new URL(String(url)).pathname,
      token: headers.get("authorization")?.replace("Bearer ", "") ?? null,
      body: JSON.parse(String(request?.body ?? "{}")) as Record<string, unknown>,
    };
    sent.push(entry);
    const status = refuse(entry);
    if (status !== null) return json({ error: "refused" }, status);
    if (entry.path === "/v1/sessions") {
      sessions += 1;
      return json(
        {
          sessionId: randomUUID(),
          siteId: options.siteId,
          origin: window.location.origin,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          choice: null,
          receipt: null,
          eventId: null,
          evidence: "self_reported",
          sessionToken: `token-${sessions}-`.padEnd(43, "x"),
        },
        201,
      );
    }
    const events = (entry.body.views ?? entry.body.signals) as { id: string }[];
    return json({ results: events.map(({ id }) => ({ id, status: "recorded" })) });
  };
  const of = (path: string) => sent.filter((entry) => entry.path === path);
  const views = () =>
    of("/v1/page-views").map((entry) => (entry.body.views as Record<string, string>[])[0]!);
  return { sent, of, views };
}

async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("Expected tracker state was not reached.");
}

afterEach(() => {
  while (disposables.length) disposables.pop()!();
  globalThis.fetch = originalFetch;
});

test("the tracker draws nothing, records one masked page view and reports automation by default", async () => {
  automated(true);
  const { options } = environment("http://localhost:4200/tickets/123?tab=history#notes");
  const received = collector(options);
  const tracker = start({ ...options, route: "/tickets/:id" });
  await tracker.ready;
  assert.equal(document.body.innerHTML, page);
  assert.equal(document.head.innerHTML, "");
  assert.deepEqual(
    received.sent.slice(0, 2).map((entry) => entry.path),
    ["/v1/sessions", "/v1/page-views"],
  );
  assert.deepEqual(received.of("/v1/sessions")[0]!.body, { siteId: options.siteId });
  const [view] = received.views();
  assert.equal(view!.path, "/tickets/:id");
  assert.equal(view!.route, "/tickets/:id");
  await until(() => received.of("/v1/browser-signals").length === 1);
  const signals = received.of("/v1/browser-signals")[0]!.body.signals as Record<string, string>[];
  assert.equal(signals[0]!.signal, "webdriver");
  assert.equal(signals[0]!.detail, "navigator.webdriver");
  // Signals are reported once per session, not with every page view.
  await tracker.pageView();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(received.of("/v1/browser-signals").length, 1);
  assert.equal(received.of("/v1/sessions").length, 1);
});

test("turning automation signals off reports none", async () => {
  automated(true);
  const { options } = environment();
  const received = collector(options);
  await start({ ...options, automationSignals: false }).ready;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(received.of("/v1/browser-signals").length, 0);
  assert.equal(received.views().length, 1);
});

test("a stored session is reused without a check, and one the collector ended is replaced", async () => {
  automated(false);
  const { options } = environment();
  let ended: string | null = null;
  const received = collector(options, (sent) => (sent.token && sent.token === ended ? 401 : null));
  const first = start(options);
  await first.ready;
  first.destroy();
  const token = received.of("/v1/page-views")[0]!.token!;

  // Another page load in the same tab: the same session, and no extra request to check it.
  await start(options).ready;
  assert.equal(received.of("/v1/sessions").length, 1);
  assert.deepEqual(
    received.of("/v1/page-views").map((entry) => entry.token),
    [token, token],
  );

  // Once the collector ends it, the next view starts a new session and keeps its own ID.
  ended = token;
  const tracker = track(options);
  await tracker.pageView();
  const attempts = received.of("/v1/page-views").slice(2);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0]!.token, token);
  assert.notEqual(attempts[1]!.token, token);
  assert.equal(
    (attempts[0]!.body.views as { id: string }[])[0]!.id,
    (attempts[1]!.body.views as { id: string }[])[0]!.id,
  );
  assert.equal(received.of("/v1/sessions").length, 2);
});

test("navigation records a view when the path changes, once per path, until destroyed", async () => {
  automated(false);
  const { options } = environment("http://localhost:4200/pricing");
  const received = collector(options);
  const tracker = start(options);
  await tracker.ready;
  window.history.pushState({}, "", "/docs");
  window.history.replaceState({ scroll: 1 }, "", "/docs?section=install");
  window.history.pushState({}, "", "/docs#limits");
  window.history.pushState({}, "", "/tickets/42");
  await until(() => received.views().length === 3);
  assert.deepEqual(
    received.views().map((view) => view.path),
    ["/pricing", "/docs", "/tickets/:id"],
  );
  window.history.back();
  await until(() => received.views().length === 4);
  assert.equal(received.views()[3]!.path, "/docs");
  tracker.destroy();
  window.history.pushState({}, "", "/after");
  assert.equal(window.location.pathname, "/after");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(received.views().length, 4);
  await assert.rejects(tracker.pageView(), /destroyed/);
});

test("turning navigation off leaves history changes to pageView()", async () => {
  automated(false);
  const { options } = environment("http://localhost:4200/pricing");
  const received = collector(options);
  const tracker = start({ ...options, navigation: false });
  await tracker.ready;
  window.history.pushState({}, "", "/docs");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(received.views().length, 1);
  await tracker.pageView({ route: "/docs" });
  assert.equal(received.views()[1]!.path, "/docs");
  assert.equal(received.views()[1]!.route, "/docs");
});

test("track is one tracker per site, and rejects conflicting or invalid options", () => {
  automated(false);
  const { options } = environment();
  collector(options);
  const tracker = start(options);
  assert.equal(track({ ...options, route: "/other" }), tracker);
  assert.throws(() => track({ ...options, navigation: false }), /different options/);
  const other = environment().options;
  assert.throws(() => track({ ...other, route: "/search?q=alice" }), /route must be/);
  assert.throws(
    () => track({ ...other, storage: "local" as TrackerOptions["storage"] }),
    /storage/,
  );
  assert.throws(() => track({ ...other, apiUrl: "http://collector.example" }), /HTTPS/);
  assert.throws(() => track({ ...other, siteId: "a site" }), /siteId/);
});

test("failures retry with the same ID, then reach onError and reject ready", async () => {
  automated(false);
  const { options } = environment();
  const errors: Error[] = [];
  const received = collector(options, (sent) => (sent.path === "/v1/page-views" ? 503 : null));
  const tracker = start({ ...options, onError: (error) => errors.push(error) });
  await assert.rejects(tracker.ready, /HTTP 503/);
  const ids = received.views().map((view) => view.id);
  assert.equal(ids.length, 3);
  assert.equal(new Set(ids).size, 1);
  assert.equal(errors.length, 1);

  // A refused origin isn't retried.
  const refused = environment().options;
  const again = collector(refused, (sent) => (sent.path === "/v1/sessions" ? 403 : null));
  await assert.rejects(start({ ...refused, onError: (error) => errors.push(error) }).ready, /403/);
  assert.equal(again.sent.length, 1);
  assert.equal(errors.length, 2);
});

test("a reload in the same tab doesn't report automation signals again", async () => {
  automated(true);
  const { options } = environment();
  const received = collector(options);
  const first = start(options);
  await first.ready;
  await until(() => received.of("/v1/browser-signals").length === 1);
  first.destroy();
  await start(options).ready;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(received.of("/v1/sessions").length, 1);
  assert.equal(received.views().length, 2);
  assert.equal(received.of("/v1/browser-signals").length, 1);
});

test("when the widget resets the tab's session, the tracker moves to the widget's new one", async () => {
  automated(false);
  const { options } = environment();
  let ended: string | null = null;
  const received = collector(options, (sent) => (sent.token && sent.token === ended ? 401 : null));
  const tracker = start(options);
  await tracker.ready;
  ended = received.of("/v1/page-views")[0]!.token!;
  // What the widget stores after revoking the old session and starting another.
  const replacement = {
    token: "w".repeat(43),
    sessionId: randomUUID(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const key = await storageKey({ ...options, origin: window.location.origin }, undefined);
  sessionStorage.setItem(key, JSON.stringify(replacement));
  await tracker.pageView();
  assert.equal(received.of("/v1/sessions").length, 1);
  assert.equal(received.of("/v1/page-views").at(-1)!.token, replacement.token);
  assert.equal(JSON.parse(sessionStorage.getItem(key)!).token, replacement.token);
});
