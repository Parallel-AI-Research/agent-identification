import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";
import { JSDOM } from "jsdom";
import {
  init,
  type Widget,
  type WidgetOptions,
  type Choice,
  type SessionStatus,
} from "../src/browser/index.js";

const originalFetch = globalThis.fetch;
const disposables: (() => void)[] = [];
let sequence = 0;
const token = "a".repeat(43);

function environment() {
  const dom = new JSDOM(
    '<main><div id="identify"></div><section id="gate"><button>Edit</button></section></main>',
    { url: "http://localhost:4200/" },
  );
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
  const gate = document.querySelector<HTMLElement>("#gate")!;
  gate.inert = false;
  const options: WidgetOptions = {
    container: "#identify",
    gate,
    siteId: `site-${++sequence}`,
    apiUrl: "http://localhost:4310",
    mode: "required",
  };
  return { options, gate, dom };
}

function mount(options: WidgetOptions): Widget {
  const widget = init(options);
  disposables.push(() => widget.destroy());
  return widget;
}

function status(options: WidgetOptions, choice: Choice | null = null): SessionStatus {
  return {
    sessionId: randomUUID(),
    siteId: options.siteId,
    origin: window.location.origin,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    choice,
    receipt: choice ? "header.payload.signature" : null,
    eventId: choice ? randomUUID() : null,
    evidence: "self_reported",
  };
}

function json(value: unknown, code = 200): Response {
  return new Response(JSON.stringify(value), {
    status: code,
    headers: { "Content-Type": "application/json" },
  });
}

function shadow(): ShadowRoot {
  return document.querySelector("[data-agent-identification]")!.shadowRoot!;
}

function button(label: string): HTMLButtonElement {
  return [...shadow().querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  )!;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("Expected widget state was not reached.");
}

afterEach(() => {
  while (disposables.length) disposables.pop()!();
  globalThis.fetch = originalFetch;
});

test("all three explicit choices release only the supplied required gate after server acknowledgement", async () => {
  const { options, gate } = environment();
  const calls: RequestInit[] = [];
  const acknowledged = deferred<Response>();
  const initial = status(options);
  const recorded: SessionStatus[] = [];
  globalThis.fetch = async (_url, request) => {
    calls.push(request!);
    return request!.method === "POST" && String(_url).endsWith("/v1/sessions")
      ? json({ ...initial, sessionToken: token }, 201)
      : acknowledged.promise;
  };
  const widget = mount({ ...options, onRecorded: (value) => recorded.push(value) });
  assert.equal(gate.inert, true);
  await widget.ready;
  assert.equal(calls.length, 1, "initializing never submits a choice automatically");
  button("Prefer not to say").click();
  assert.equal(gate.inert, true);
  assert.equal(recorded.length, 0);
  acknowledged.resolve(
    json({
      ...initial,
      choice: "prefer_not_to_say",
      receipt: "signed.receipt.value",
      eventId: randomUUID(),
    }),
  );
  await until(() => recorded.length === 1);
  assert.equal(gate.inert, false);
  assert.equal(widget.getState()?.choice, "prefer_not_to_say");
  assert.match(shadow().textContent!, /Response recorded: Prefer not to say/);
  assert.equal(document.querySelector("main")!.inert, undefined);
  for (const request of calls) {
    assert.equal(request.credentials, "omit");
    assert.equal(request.referrerPolicy, "no-referrer");
  }
});

test("AI assistant and Person are self-reported choices, without automatic detection", async () => {
  const { options, gate } = environment();
  for (const [choice, label] of [
    ["ai_assistant", "AI assistant"],
    ["person", "Person"],
  ] as const) {
    options.siteId = `site-${++sequence}`;
    const initial = status(options);
    let submission: Record<string, unknown> | undefined;
    globalThis.fetch = async (_url, request) => {
      if (String(_url).endsWith("/v1/sessions"))
        return json({ ...initial, sessionToken: token }, 201);
      submission = JSON.parse(String(request!.body)) as Record<string, unknown>;
      return json({ ...initial, choice, receipt: "signed.receipt.value", eventId: randomUUID() });
    };
    const widget = mount(options);
    await widget.ready;
    assert.equal(submission, undefined);
    button(label).click();
    await until(() => widget.getState()?.choice === choice);
    assert.deepEqual(Object.keys(submission!).sort(), ["choice", "requestId"]);
    assert.equal(submission!.choice, choice);
    assert.equal(gate.inert, false);
    widget.destroy();
  }
});

test("a response with mismatched site, origin, session, choice or invalid receipt never unlocks", async () => {
  const { options, gate } = environment();
  const invalid: Record<string, unknown>[] = [
    { siteId: "another-site" },
    { origin: "https://attacker.example" },
    { sessionId: randomUUID() },
    { choice: "person" },
    { receipt: null },
    { eventId: "not-a-uuid" },
    { expiresAt: new Date(Date.now() - 1000).toISOString() },
    { evidence: "verified" },
  ];
  for (const change of invalid) {
    options.siteId = `site-${++sequence}`;
    const initial = status(options);
    let notified = false;
    let failed = false;
    globalThis.fetch = async (_url) =>
      String(_url).endsWith("/v1/sessions")
        ? json({ ...initial, sessionToken: token }, 201)
        : json({
            ...initial,
            choice: "ai_assistant",
            receipt: "signed.receipt.value",
            eventId: randomUUID(),
            ...change,
          });
    const widget = mount({
      ...options,
      onRecorded: () => {
        notified = true;
      },
      onError: () => {
        failed = true;
      },
    });
    await widget.ready;
    button("AI assistant").click();
    await until(() => failed);
    assert.equal(notified, false);
    assert.equal(gate.inert, true);
    assert.equal(widget.getState()?.choice, null);
    assert.match(shadow().textContent!, /Could not record your response/);
    widget.destroy();
  }
});

test("restored tokens require current server validation before a required gate opens", async () => {
  const { options, gate } = environment();
  const initial = status(options);
  const accepted = {
    ...initial,
    choice: "person" as const,
    receipt: "signed.receipt.value",
    eventId: randomUUID(),
  };
  globalThis.fetch = async (_url) =>
    String(_url).endsWith("/v1/sessions")
      ? json({ ...initial, sessionToken: token }, 201)
      : json(accepted);
  const first = mount(options);
  await first.ready;
  button("Person").click();
  await until(() => first.getState()?.choice === "person");
  first.destroy();
  const restore = deferred<Response>();
  let request: RequestInit | undefined;
  globalThis.fetch = async (_url, options) => {
    request = options;
    return restore.promise;
  };
  const second = mount(options);
  assert.equal(gate.inert, true);
  await until(() => request !== undefined);
  assert.equal(request!.method, "GET");
  assert.equal((request!.headers as Record<string, string>).Authorization, `Bearer ${token}`);
  assert.equal(second.getState(), null);
  restore.resolve(json(accepted));
  await second.ready;
  assert.equal(gate.inert, false);
});

test("a network retry preserves its request ID, avoiding duplicate declarations after a lost response", async () => {
  const { options } = environment();
  const initial = status(options);
  const submissions: Record<string, unknown>[] = [];
  globalThis.fetch = async (_url, request) => {
    if (String(_url).endsWith("/v1/sessions"))
      return json({ ...initial, sessionToken: token }, 201);
    submissions.push(JSON.parse(String(request!.body)) as Record<string, unknown>);
    if (submissions.length === 1) throw new TypeError("Network request failed.");
    return json({
      ...initial,
      choice: "ai_assistant",
      receipt: "signed.receipt.value",
      eventId: randomUUID(),
    });
  };
  const widget = mount(options);
  await widget.ready;
  button("AI assistant").click();
  await until(() => !button("Retry").hidden);
  button("Retry").click();
  await until(() => widget.getState()?.choice === "ai_assistant");
  assert.equal(submissions.length, 2);
  assert.deepEqual(submissions[0], submissions[1]);
});

test("init is idempotent and rejects conflicting options, shared gates, and a gate containing the widget", async () => {
  const { options } = environment();
  globalThis.fetch = async () => json({ ...status(options), sessionToken: token }, 201);
  const widget = mount(options);
  assert.equal(init(options), widget);
  assert.throws(() => init({ ...options, mode: "optional" }), /different options/);
  const second = document.createElement("div");
  document.body.append(second);
  assert.throws(() => init({ ...options, container: second }), /already controlled/);
  assert.throws(
    () => init({ ...options, container: second, gate: document.body }),
    /must not contain/,
  );
  await widget.ready;
  assert.equal(document.querySelectorAll("[data-agent-identification]").length, 1);
});

test("reset cannot claim success or create a replacement session when revocation fails", async () => {
  const { options, gate } = environment();
  let created = 0;
  let revokeFails = true;
  const methods: string[] = [];
  globalThis.fetch = async (_url, request) => {
    methods.push(request!.method!);
    if (request!.method === "DELETE")
      return revokeFails
        ? json({ error: "unavailable" }, 503)
        : new Response(null, { status: 204 });
    created += 1;
    return json({ ...status(options), sessionToken: token }, 201);
  };
  const widget = mount(options);
  const before = await widget.ready;
  await assert.rejects(widget.reset(), /503/);
  assert.equal(created, 1);
  assert.equal(gate.inert, true);
  assert.equal(widget.getState(), null);
  revokeFails = false;
  const after = await widget.reset();
  assert.notEqual(before.sessionId, after.sessionId);
  assert.deepEqual(methods, ["POST", "DELETE", "DELETE", "POST"]);
  assert.equal(gate.inert, true);
});

test("a delayed response from before reset cannot unlock the new session or call onRecorded", async () => {
  const { options, gate } = environment();
  const old = status(options);
  const fresh = status(options);
  const delayed = deferred<Response>();
  let creates = 0;
  let callbacks = 0;
  globalThis.fetch = async (_url, request) => {
    if (request!.method === "DELETE") return new Response(null, { status: 204 });
    if (String(_url).endsWith("/v1/sessions"))
      return json({ ...(creates++ === 0 ? old : fresh), sessionToken: token }, 201);
    return delayed.promise;
  };
  const widget = mount({
    ...options,
    onRecorded: () => {
      callbacks++;
    },
  });
  await widget.ready;
  button("AI assistant").click();
  await widget.reset();
  delayed.resolve(
    json({
      ...old,
      choice: "ai_assistant",
      receipt: "signed.receipt.value",
      eventId: randomUUID(),
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(callbacks, 0);
  assert.equal(gate.inert, true);
  assert.equal(widget.getState()?.sessionId, fresh.sessionId);
  assert.equal(widget.getState()?.choice, null);
});

test("destroy aborts pending work, removes only its widget, and restores the original gate", async () => {
  const { options, gate } = environment();
  const initial = status(options);
  const delayed = deferred<Response>();
  let callbacks = 0;
  let aborted = false;
  globalThis.fetch = async (_url, request) => {
    if (String(_url).endsWith("/v1/sessions"))
      return json({ ...initial, sessionToken: token }, 201);
    request!.signal!.addEventListener("abort", () => {
      aborted = true;
    });
    return delayed.promise;
  };
  const widget = mount({
    ...options,
    onRecorded: () => {
      callbacks++;
    },
  });
  await widget.ready;
  button("Person").click();
  widget.destroy();
  assert.equal(aborted, true);
  assert.equal(gate.inert, false);
  assert.equal(document.querySelector("[data-agent-identification]"), null);
  assert.equal(gate.textContent, "Edit");
  delayed.resolve(
    json({ ...initial, choice: "person", receipt: "signed.receipt.value", eventId: randomUUID() }),
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(callbacks, 0);
});

test("blocked storage uses memory while binding contexts remain out of persisted keys and values", async () => {
  const { options, dom } = environment();
  options.bindingContext = "signed.private-context.value";
  const initial = status(options);
  globalThis.fetch = async () => json({ ...initial, sessionToken: token }, 201);
  const first = mount(options);
  await first.ready;
  const serialized = Array.from({ length: sessionStorage.length }, (_, index) => {
    const key = sessionStorage.key(index)!;
    return key + sessionStorage.getItem(key);
  }).join("");
  assert.doesNotMatch(serialized, /private-context/);
  first.destroy();
  Object.defineProperty(dom.window.Storage.prototype, "getItem", {
    configurable: true,
    value: () => {
      throw new Error("Storage blocked");
    },
  });
  Object.defineProperty(dom.window.Storage.prototype, "setItem", {
    configurable: true,
    value: () => {
      throw new Error("Storage blocked");
    },
  });
  let method = "";
  globalThis.fetch = async (_url, request) => {
    method = request!.method!;
    return json(initial);
  };
  const second = mount(options);
  await second.ready;
  assert.equal(method, "GET");
});

test("expiry returns a required gate to its locked state and offers a fresh-session retry", async () => {
  const { options, gate } = environment();
  const initial = status(options);
  globalThis.fetch = async (_url) =>
    String(_url).endsWith("/v1/sessions")
      ? json({ ...initial, sessionToken: token }, 201)
      : json({
          ...initial,
          expiresAt: new Date(Date.now() + 60).toISOString(),
          choice: "person",
          receipt: "signed.receipt.value",
          eventId: randomUUID(),
        });
  const widget = mount(options);
  await widget.ready;
  button("Person").click();
  await until(() => widget.getState()?.choice === "person");
  assert.equal(gate.inert, false);
  await until(() => gate.inert);
  assert.equal(widget.getState(), null);
  assert.match(shadow().textContent!, /session expired/);
  assert.equal(button("Retry").hidden, false);
});

test("host callback errors do not turn a confirmed response into a network failure", async () => {
  const { options, gate } = environment();
  const initial = status(options);
  globalThis.fetch = async (_url) =>
    String(_url).endsWith("/v1/sessions")
      ? json({ ...initial, sessionToken: token }, 201)
      : json({
          ...initial,
          choice: "person",
          receipt: "signed.receipt.value",
          eventId: randomUUID(),
        });
  const widget = mount({
    ...options,
    onRecorded: () => {
      throw new Error("Host bug");
    },
    onError: () => {
      throw new Error("Another host bug");
    },
  });
  await widget.ready;
  button("Person").click();
  await until(() => widget.getState()?.choice === "person");
  assert.equal(gate.inert, false);
  assert.equal(button("Retry").hidden, true);
  assert.match(shadow().textContent!, /Response recorded: Person/);
});
