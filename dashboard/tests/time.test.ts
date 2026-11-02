import assert from "node:assert/strict";
import { test } from "node:test";
import { ago } from "../lib/time";

test("times read as plain relative phrases", () => {
  const now = Date.parse("2026-11-02T12:00:00Z");
  const before = (seconds: number) => new Date(now - seconds * 1000).toISOString();
  assert.equal(ago(before(0), now), "just now");
  assert.equal(ago(before(59), now), "just now");
  assert.equal(ago(before(60), now), "1 minute ago");
  assert.equal(ago(before(5 * 60), now), "5 minutes ago");
  assert.equal(ago(before(3 * 3600), now), "3 hours ago");
  assert.equal(ago(before(86400), now), "yesterday");
  assert.equal(ago(before(9 * 86400), now), "9 days ago");
  // A clock slightly ahead of the server never reads as the future.
  assert.equal(ago(new Date(now + 5000).toISOString(), now), "just now");
});
