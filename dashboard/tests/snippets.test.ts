import assert from "node:assert/strict";
import test from "node:test";
import {
  agentPrompt,
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

test("agent instructions are specific to the product and carry no secret", () => {
  const docsUrl = "https://dashboard.example/llms.txt";
  const prompt = agentPrompt(values, ["https://a.example", "https://b.example"], docsUrl);
  assert(prompt.includes(docsUrl));
  assert(prompt.includes(values.siteId));
  assert(prompt.includes(values.collectorUrl));
  assert(prompt.includes("https://a.example, https://b.example"));
  assert(prompt.includes(scriptSnippet(values)));
  assert(prompt.includes(reactSnippet(values)));
  assert(!prompt.includes("YOUR-SITE-ID"));
  // The secret is only ever named as an environment variable the customer sets.
  assert.deepEqual(prompt.match(/AGENT_ID_SITE_SECRET/g)?.length, 1);
  assert(prompt.includes("Don't describe it as detecting agents"));
});
