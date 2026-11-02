import assert from "node:assert/strict";
import { test } from "node:test";
import {
  agentClaim,
  isActionName,
  isOutcome,
  isReference,
  isRoutePattern,
  routePath,
} from "../src/protocol.js";

test("page paths drop the query and fragment and mask segments that look like IDs", () => {
  const cases: [string, string][] = [
    ["/", "/"],
    ["", "/"],
    ["/pricing", "/pricing"],
    ["/tickets/12345", "/tickets/:id"],
    ["/tickets/12345/edit?tab=history#notes", "/tickets/:id/edit"],
    ["/orders/3f2a9c1e-8b7d-4e6f-9a0b-1c2d3e4f5a6b", "/orders/:id"],
    ["/files/a3f9c2e81b7d", "/files/:id"],
    ["/users/alice@example.com/settings", "/users/:id/settings"],
    ["/users/alice%40example.com", "/users/:id"],
    ["/share/ord_8f2k3j9d", "/share/:id"],
    ["/blog/how-to-reset-your-password", "/blog/how-to-reset-your-password"],
    ["/docs/v2/install", "/docs/v2/install"],
    ["/search?q=alice@example.com", "/search"],
    ["/bad/%E0%A4%A", "/bad/%E0%A4%A"],
    ["relative/123", "/relative/:id"],
  ];
  for (const [input, expected] of cases) assert.equal(routePath(input), expected, input);
  assert.equal(routePath(`/${"z".repeat(600)}`).length, 512);
  // Masking is idempotent, so a path the collector checks again stays the same.
  for (const [input] of cases) assert.equal(routePath(routePath(input)), routePath(input));
});

test("references, action names, outcomes and route patterns accept only their documented shapes", () => {
  assert(isReference("acct_42"));
  assert(isReference("org:7:user:19"));
  assert(!isReference("alice@example.com"));
  assert(!isReference("Alice Smith"));
  assert(!isReference(""));
  assert(!isReference("x".repeat(129)));
  assert(isActionName("ticket.update"));
  assert(isActionName("checkout:submit"));
  assert(!isActionName("Ticket Update"));
  assert(!isActionName("1update"));
  assert(isOutcome("attempted") && isOutcome("rejected") && isOutcome("confirmed"));
  assert(!isOutcome("succeeded"));
  assert(isRoutePattern("/tickets/:id"));
  assert(isRoutePattern("/files/{fileId}/*"));
  assert(!isRoutePattern("tickets/:id"));
  assert(!isRoutePattern("/search?q=x"));
});

test("an agent's description is optional self-report, and unknown is valid", () => {
  const unknown = { name: null, provider: null, purpose: null };
  assert.deepEqual(agentClaim(undefined), unknown);
  assert.deepEqual(agentClaim(null), unknown);
  assert.deepEqual(agentClaim({}), unknown);
  assert.deepEqual(agentClaim({ name: "  ", provider: null }), unknown);
  assert.deepEqual(agentClaim({ name: " Research helper ", purpose: "Compare plans" }), {
    name: "Research helper",
    provider: null,
    purpose: "Compare plans",
  });
  assert.equal(agentClaim({ name: "x".repeat(101) }), null);
  assert.equal(agentClaim({ name: "line\nbreak" }), null);
  assert.equal(agentClaim({ name: 7 }), null);
  assert.equal(agentClaim({ model: "anything" }), null);
  assert.equal(agentClaim(["name"]), null);
  assert.equal(agentClaim("name"), null);
});
