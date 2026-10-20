import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JSDOM } from "jsdom";
import { AgentIdentification } from "../src/react/index.js";

test("React can server-render an empty mounting point without DOM, storage or network access", () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("SSR must not make requests");
  };
  try {
    const html = renderToString(
      createElement(AgentIdentification, {
        siteId: "test-site",
        apiUrl: "http://localhost:4310",
        id: "visitor-choice",
        className: "identification",
      }),
    );
    assert.equal(html, '<div class="identification" id="visitor-choice"></div>');
  } finally {
    globalThis.fetch = previous;
  }
});

test("React updates host callbacks without resetting the visitor session and restores the gate on unmount", async () => {
  const dom = new JSDOM('<div id="root"></div><section id="gate"></section>', {
    url: "http://localhost:4200/",
  });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const name of ["window", "document", "HTMLElement", "sessionStorage"]) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: dom.window[name as keyof Window],
    });
  }
  previous.set(
    "IS_REACT_ACT_ENVIRONMENT",
    Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"),
  );
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
  });
  const oldFetch = globalThis.fetch;
  const gate = document.querySelector<HTMLElement>("#gate")!;
  gate.inert = false;
  const sessionId = randomUUID();
  const session = {
    sessionId,
    siteId: "react-lifecycle",
    origin: "http://localhost:4200",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    evidence: "self_reported",
  };
  let requests = 0;
  let originalCallback = 0;
  let updatedCallback = 0;
  globalThis.fetch = async (url) => {
    requests++;
    return new Response(
      JSON.stringify(
        String(url).endsWith("/v1/sessions")
          ? { ...session, choice: null, receipt: null, eventId: null, sessionToken: "a".repeat(43) }
          : {
              ...session,
              choice: "person",
              receipt: "signed.receipt.value",
              eventId: randomUUID(),
            },
      ),
      {
        status: String(url).endsWith("/v1/sessions") ? 201 : 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };
  const root = createRoot(document.querySelector("#root")!);
  const props = {
    siteId: "react-lifecycle",
    apiUrl: "http://localhost:4310",
    gate,
    mode: "required" as const,
  };
  try {
    await act(async () => {
      root.render(
        createElement(AgentIdentification, {
          ...props,
          onRecorded: () => {
            originalCallback++;
          },
        }),
      );
    });
    for (let i = 0; i < 100 && requests === 0; i++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(requests, 1);
    assert.equal(gate.inert, true);
    await act(async () => {
      root.render(
        createElement(AgentIdentification, {
          ...props,
          onRecorded: () => {
            updatedCallback++;
          },
        }),
      );
    });
    assert.equal(requests, 1, "callback rerender must not create or restore a second session");
    const shadow = document.querySelector("[data-agent-identification]")!.shadowRoot!;
    const person = [...shadow.querySelectorAll("button")].find(
      (button) => button.textContent === "Person",
    )!;
    await act(async () => person.click());
    for (let i = 0; i < 100 && updatedCallback === 0; i++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(updatedCallback, 1);
    assert.equal(originalCallback, 0);
    assert.equal(gate.inert, false);
    await act(async () => root.unmount());
    assert.equal(gate.inert, false);
    assert.equal(document.querySelector("[data-agent-identification]"), null);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = oldFetch;
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    dom.window.close();
  }
});
