import assert from "node:assert/strict";
import test from "node:test";
import {
  packageSnippet,
  parseOrigins,
  reactSnippet,
  scriptSnippet,
  serverSnippet,
} from "../lib/snippets";

const values = { siteId: "site_abc123", collectorUrl: "https://collector.example" };

test("every snippet uses the product's own site ID and collector", () => {
  for (const build of [scriptSnippet, packageSnippet, reactSnippet, serverSnippet]) {
    const snippet = build(values);
    assert(snippet.includes(values.siteId));
    assert(snippet.includes(values.collectorUrl));
    assert(!snippet.includes("YOUR-SITE-ID"));
  }
});

test("browser snippets never contain a secret reference", () => {
  for (const build of [scriptSnippet, packageSnippet, reactSnippet]) {
    assert(!/secret/i.test(build(values)));
  }
});

test("origins can be separated by new lines, commas or spaces, without duplicates", () => {
  assert.deepEqual(parseOrigins(" https://a.example\nhttps://b.example, https://a.example  "), [
    "https://a.example",
    "https://b.example",
  ]);
  assert.deepEqual(parseOrigins("  \n "), []);
});
