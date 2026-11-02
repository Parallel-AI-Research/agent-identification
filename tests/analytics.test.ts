import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { summarize } from "../collector/analytics.js";
import { MemoryStore } from "../collector/store.js";
import type {
  ActionEvent,
  ActivityEvent,
  DeclarationEvent,
  PageViewEvent,
  SignatureEvent,
} from "../src/protocol.js";

const siteId = "shop";
const origin = "https://shop.test";
const now = Date.parse("2026-11-02T12:00:00Z");
const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString();
const unknown = { name: null, provider: null, purpose: null };

function view(sessionId: string, minutes: number, id = randomUUID()): PageViewEvent {
  return {
    id,
    siteId,
    sessionId,
    origin,
    type: "page_view",
    source: "browser",
    evidence: "browser_reported",
    occurredAt: at(minutes),
    receivedAt: at(minutes),
    accountRef: null,
    path: "/pricing",
    route: null,
  };
}
function declared(sessionId: string, choice: DeclarationEvent["choice"]): DeclarationEvent {
  return {
    id: randomUUID(),
    siteId,
    sessionId,
    origin,
    type: "declaration",
    source: "browser",
    evidence: "self_reported",
    occurredAt: at(1),
    receivedAt: at(1),
    accountRef: null,
    choice,
    agent: unknown,
  };
}
function signed(sessionId: string | null, verified = true, signer = "Test agent"): SignatureEvent {
  return {
    id: randomUUID(),
    siteId,
    sessionId,
    origin: null,
    type: "signature",
    source: "server",
    evidence: verified ? "signature_verified" : "signature_claimed",
    occurredAt: at(2),
    receivedAt: at(2),
    accountRef: null,
    signer: verified ? signer : null,
    signatureAgent: "https://agent.test",
    result: verified ? "verified" : "unknown_signer",
    verifier: null,
    path: "/pricing",
  };
}
function acted(sessionId: string | null, outcome: ActionEvent["outcome"]): ActionEvent {
  return {
    id: randomUUID(),
    siteId,
    sessionId,
    origin: null,
    type: "action",
    source: "server",
    evidence: "host_reported",
    occurredAt: at(3),
    receivedAt: at(3),
    accountRef: "acct_42",
    action: "ticket.update",
    resourceRef: null,
    outcome,
  };
}

test("each session is counted once, with one label and every signal kept", async () => {
  const store = new MemoryStore();
  const [a, b, c, d] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const retried = view(a, 0);
  const events: ActivityEvent[] = [
    retried,
    // The widget's retry and the original are one event.
    { ...retried, receivedAt: at(5) },
    view(a, 4),
    declared(a, "person"),
    signed(a),
    declared(b, "ai_assistant"),
    acted(b, "attempted"),
    acted(b, "confirmed"),
    view(c, 0),
    signed(c, false),
    declared(d, "prefer_not_to_say"),
    acted(null, "confirmed"),
    signed(null),
  ];
  for (const event of events) await store.recordActivity(event);
  const recorded = await store.listActivity(siteId, { limit: 100 });
  assert.equal(recorded.length, events.length - 1);
  const { overview, sessions } = summarize(recorded);

  assert.deepEqual(overview, {
    sessions: 4,
    labels: {
      verified_signer: 1,
      declared_ai: 1,
      suspected_automation: 0,
      declared_person: 0,
      unknown: 2,
    },
    pageViews: 3,
    signedRequests: { verified: 2, unverified: 1 },
    actions: { attempted: 1, rejected: 0, confirmed: 2 },
    declarations: { ai_assistant: 1, person: 1, prefer_not_to_say: 1 },
    withoutSession: { actions: 1, signedRequests: 1 },
  });
  // Counts reconcile with the events they come from.
  assert.equal(overview.pageViews, recorded.filter((event) => event.type === "page_view").length);

  const byId = new Map(sessions.map((session) => [session.sessionId, session]));
  const both = byId.get(a)!;
  assert.equal(both.label, "verified_signer");
  assert.deepEqual(both.verifiedSigners, ["Test agent"]);
  assert.equal(both.declaration?.choice, "person");
  assert.equal(both.pageViews, 2);
  assert.equal(both.conflicts.length, 1);
  assert.equal(byId.get(b)!.label, "declared_ai");
  assert.deepEqual(byId.get(b)!.actions, { attempted: 1, rejected: 0, confirmed: 1 });
  assert.equal(byId.get(c)!.label, "unknown");
  assert.equal(byId.get(c)!.unverifiedSignatures, 1);
  assert.equal(byId.get(d)!.label, "unknown");
  for (const session of sessions) assert.notEqual(session.label as string, "human");
});

test("a Person answer is a label of its own, and two signers are a conflict", () => {
  const person = randomUUID();
  const twice = randomUUID();
  const { sessions } = summarize([
    declared(person, "person"),
    signed(twice, true, "First agent"),
    signed(twice, true, "Second agent"),
  ]);
  const byId = new Map(sessions.map((session) => [session.sessionId, session]));
  assert.equal(byId.get(person)!.label, "declared_person");
  assert.deepEqual(byId.get(person)!.conflicts, []);
  assert.equal(byId.get(twice)!.conflicts.length, 1);
});
