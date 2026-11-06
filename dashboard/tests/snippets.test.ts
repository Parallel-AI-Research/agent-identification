import assert from "node:assert/strict";
import test from "node:test";
import {
  agentPrompt,
  checkCommand,
  httpSnippet,
  nextPageScriptSnippet,
  nextSnippet,
  nodeSnippet,
  packageSnippet,
  pageScriptSnippet,
  parseOrigins,
  reactSnippet,
  scriptSnippet,
  serverSnippet,
  trackSnippet,
} from "../lib/snippets";

const values = { siteId: "site_abc123", collectorUrl: "https://collector.example" };
const serverSnippets = [nextSnippet, nodeSnippet, httpSnippet];
const pageSnippets = [pageScriptSnippet, nextPageScriptSnippet, trackSnippet];
const widgetSnippets = [scriptSnippet, packageSnippet, reactSnippet];

test("every snippet uses the product's own site ID and collector", () => {
  for (const build of [...serverSnippets, ...pageSnippets, ...widgetSnippets, serverSnippet]) {
    const snippet = build(values);
    assert(snippet.includes(values.siteId));
    assert(snippet.includes(values.collectorUrl));
    assert(!snippet.includes("YOUR-SITE-ID"));
  }
});

test("the default install reports from the server and adds nothing to the page", () => {
  for (const build of serverSnippets) {
    const snippet = build(values);
    // The secret only ever comes from the environment, never from the snippet itself.
    assert.match(snippet, /AGENT_ID_SITE_SECRET/);
    assert(!snippet.includes("visitor-choice"));
    assert(!/agent-id\.js|<script|AgentIdentification|init\(/.test(snippet));
  }
  for (const build of [nextSnippet, nodeSnippet]) {
    assert(build(values).includes("reportSignedRequest"));
    assert(build(values).includes("reportRequestSignals"));
  }
  // Next.js rewrites the request URL to localhost, so the signed host must be passed on.
  assert(nextSnippet(values).includes("url: url.href"));
  assert(httpSnippet(values).includes("/v1/signatures"));
  assert(httpSnippet(values).includes("/v1/signals"));
});

test("the page script snippets load the script that draws nothing, never the widget", () => {
  for (const build of [pageScriptSnippet, nextPageScriptSnippet]) {
    assert(build(values).includes("/sdk/v0.6.0/agent-id-track.js"));
  }
  assert(trackSnippet(values).includes("track({"));
  assert(trackSnippet(values).includes("-0.6.0.tgz"));
  for (const build of pageSnippets) {
    const snippet = build(values);
    assert(!/visitor-choice|data-target|agent-id\.js|init\(|AgentIdentification/.test(snippet));
  }
});

test("the widget leaves page views to the page script, so a visit isn't counted twice", () => {
  assert(scriptSnippet(values).includes('data-page-views="off"'));
  assert(packageSnippet(values).includes("pageViews: false"));
  assert(reactSnippet(values).includes("pageViews={false}"));
});

test("browser snippets never contain a secret reference", () => {
  for (const build of [...pageSnippets, ...widgetSnippets]) {
    assert(!/secret/i.test(build(values)));
  }
});

test("the install check claims a headless browser, not a real agent", () => {
  const command = checkCommand("https://a.example");
  assert.equal(command, 'curl -A "HeadlessChrome/1.0 (install check)" https://a.example/');
});

test("origins can be separated by new lines, commas or spaces, without duplicates", () => {
  assert.deepEqual(parseOrigins(" https://a.example\nhttps://b.example, https://a.example  "), [
    "https://a.example",
    "https://b.example",
  ]);
  assert.deepEqual(parseOrigins("  \n "), []);
});

test("agent instructions install server reporting and the page script, and carry no secret", () => {
  const docsUrl = "https://dashboard.example/llms.txt";
  const prompt = agentPrompt(values, ["https://a.example", "https://b.example"], docsUrl);
  assert(prompt.includes(docsUrl));
  assert(prompt.includes(values.siteId));
  assert(prompt.includes(values.collectorUrl));
  assert(prompt.includes("https://a.example, https://b.example"));
  assert(prompt.includes(nextSnippet(values)));
  assert(prompt.includes(nodeSnippet(values)));
  assert(prompt.includes(checkCommand("https://a.example")));
  assert(prompt.includes(pageScriptSnippet(values)));
  assert(prompt.includes(nextPageScriptSnippet(values)));
  assert(!prompt.includes("YOUR-SITE-ID"));
  // The widget shows to every visitor, so the agent is told not to add it.
  assert(!prompt.includes(scriptSnippet(values)));
  assert(!prompt.includes(reactSnippet(values)));
  assert(prompt.includes("Don't add the declaration widget"));
  // The secret is only ever named as an environment variable the customer sets.
  assert(!/secret:\s*["'][^"']/.test(prompt));
  assert(prompt.includes("Never commit the secret"));
});
