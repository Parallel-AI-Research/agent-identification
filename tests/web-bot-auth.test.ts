import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, sign, constants, type KeyObject } from "node:crypto";
import { test } from "node:test";
import { createCollector } from "../collector/index.js";
import { MemoryStore } from "../collector/store.js";
import {
  KeyDirectory,
  thumbprint,
  verifySignedRequest,
  type SignedRequest,
  type VerifyOptions,
} from "../collector/web-bot-auth.js";
import { reportSignedRequest } from "../src/server/index.js";
import type { SignatureEvent } from "../src/protocol.js";

const now = Date.parse("2026-11-02T12:00:00Z");
const AGENT = "https://agent.test";
const DIRECTORY = `${AGENT}/.well-known/http-message-signatures-directory`;
const signers = [{ agent: AGENT, name: "Test agent" }];
const site = {
  id: "shop",
  origins: ["https://shop.test", "https://www.shop.test"],
  secret: "test-only-shop-site-secret-0123456789abcdef",
};

function keyPair(type: "ed25519" | "rsa" = "ed25519") {
  const pair =
    type === "ed25519"
      ? generateKeyPairSync("ed25519")
      : generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = pair.publicKey.export({ format: "jwk" });
  return { privateKey: pair.privateKey, jwk, keyid: thumbprint(jwk)! };
}
const ed25519 = keyPair();

function directoryFetch(
  keys: object[],
  init: { status?: number; type?: string; cache?: string; location?: string } = {},
) {
  const calls: string[] = [];
  const fetcher = (async (url: string | URL) => {
    calls.push(String(url));
    return new Response(init.status === 302 ? null : JSON.stringify({ keys }), {
      status: init.status ?? 200,
      headers: {
        "content-type": init.type ?? "application/http-message-signatures-directory+json",
        "cache-control": init.cache ?? "max-age=3600",
        ...(init.location ? { location: init.location } : {}),
      },
    });
  }) as typeof fetch;
  return { fetcher, calls };
}

interface SignOptions {
  url?: string;
  signedUrl?: string;
  agent?: string;
  label?: string;
  created?: number;
  expires?: number;
  legacy?: boolean;
  tag?: string;
  coverAgent?: boolean;
  key?: { privateKey: KeyObject; keyid: string };
  alg?: "ed25519" | "rsa-pss-sha512";
}
/** Signs a request the way a Web Bot Auth agent would. */
function signed(options: SignOptions = {}): SignedRequest {
  const url = new URL(options.url ?? "https://shop.test/tickets/123?tab=history");
  const authority = new URL(options.signedUrl ?? url.href).host;
  const agent = options.agent ?? AGENT;
  const label = options.label ?? "sig1";
  const created = options.created ?? Math.floor(now / 1000) - 10;
  const expires = options.expires ?? created + 300;
  const key = options.key ?? ed25519;
  const alg = options.alg ?? "ed25519";
  const agentComponent = options.legacy ? `"signature-agent"` : `"signature-agent";key="${label}"`;
  const components = [`"@authority"`, ...(options.coverAgent === false ? [] : [agentComponent])];
  const params = `(${components.join(" ")});created=${created};keyid="${key.keyid}";alg="${alg}";expires=${expires};nonce="${randomBytes(16).toString("base64")}";tag="${options.tag ?? "web-bot-auth"}"`;
  const lines = [`"@authority": ${authority}`];
  if (options.coverAgent !== false) lines.push(`${agentComponent}: "${agent}"`);
  const base = Buffer.from([...lines, `"@signature-params": ${params}`].join("\n"));
  const signature =
    alg === "ed25519"
      ? sign(null, base, key.privateKey)
      : sign("sha512", base, {
          key: key.privateKey,
          padding: constants.RSA_PKCS1_PSS_PADDING,
          saltLength: 64,
        });
  return {
    method: "GET",
    url,
    headers: {
      "signature-agent": options.legacy ? `"${agent}"` : `${label}="${agent}"`,
      "signature-input": `${label}=${params}`,
      signature: `${label}=:${signature.toString("base64")}:`,
    },
  };
}
function verifier(overrides: Partial<VerifyOptions> = {}, keys: object[] = [ed25519.jwk]) {
  return {
    now,
    authorities: ["shop.test", "www.shop.test"],
    signers,
    keys: new KeyDirectory(directoryFetch(keys).fetcher, () => now),
    ...overrides,
  };
}

test("the draft's own Ed25519 test vector verifies", async () => {
  const jwk = {
    kty: "OKP",
    crv: "Ed25519",
    kid: "poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U",
    x: "JrQLj5P_89iXES9-vFgrIy29clF9CC_oPPsw3c5D0bs",
    use: "sig",
  };
  const request: SignedRequest = {
    method: "GET",
    url: new URL("https://example.com/"),
    headers: {
      "signature-agent": 'sig2="https://signature-agent.test"',
      "signature-input":
        'sig2=("@authority" "signature-agent";key="sig2");created=1735689600;keyid="poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U";alg="ed25519";expires=4889289600;nonce="n9p433xm+NJ3ph3upfBIGmsuwHw387YV7Q/F+6BSpGCVjYCqQw6rznNA8PVVLySrAWsv0hQtFioQb6E1YsauiA==";tag="web-bot-auth"',
      signature:
        "sig2=:CGokAoY/FrPpyuzTe1Fb2kLTAH9Idw6qSFd1+D77r1firsMRCxeuLu5e6O+ek3zQgDMAzjiXtLVfqE00xnABCQ==:",
    },
  };
  const result = await verifySignedRequest(request, {
    now,
    // The draft's example is valid for a century, far beyond the one-day policy.
    maxLifetimeMs: Infinity,
    authorities: ["example.com"],
    signers: [{ agent: "https://signature-agent.test", name: "Draft example" }],
    keys: new KeyDirectory(directoryFetch([jwk]).fetcher, () => now),
  });
  assert.equal(result.result, "verified");
  assert.equal(result.signer, "Draft example");
  assert.equal(thumbprint(jwk), jwk.kid);
});

test("an allowlisted signer's signature verifies, in the dictionary and legacy forms", async () => {
  for (const legacy of [false, true]) {
    const result = await verifySignedRequest(signed({ legacy }), verifier());
    assert.equal(result.result, "verified", `legacy ${legacy}`);
    assert.equal(result.signer, "Test agent");
    assert.equal(result.signatureAgent, AGENT);
  }
  const rsa = keyPair("rsa");
  const result = await verifySignedRequest(
    signed({ key: rsa, alg: "rsa-pss-sha512" }),
    verifier({}, [rsa.jwk]),
  );
  assert.equal(result.result, "verified");
});

test("every way a signature can fail says why, and none counts as verified", async () => {
  const created = Math.floor(now / 1000);
  const other = keyPair();
  const cases: [string, SignedRequest, Partial<VerifyOptions>?, object[]?][] = [
    // Signed for one allowed host, reported for another.
    ["bad_signature", signed({ url: "https://www.shop.test/", signedUrl: "https://shop.test/" })],
    ["wrong_authority", signed({ url: "https://elsewhere.test/" })],
    ["expired", signed({ created: created - 600, expires: created - 1 })],
    ["expired", signed({ created: created + 600 })],
    ["expired", signed({ created: created - 10, expires: created + 2 * 86400 })],
    ["unknown_signer", signed({ agent: "https://someone-else.test" })],
    // A key the signer never published, under its own key ID.
    ["bad_signature", signed({ key: other }), {}, [ed25519.jwk]],
    // A different key claiming the published key's ID.
    ["bad_signature", signed({ key: { privateKey: other.privateKey, keyid: ed25519.keyid } })],
    ["malformed", signed({ coverAgent: false })],
    ["malformed", signed({ tag: "something-else" })],
  ];
  for (const [expected, request, overrides, keys] of cases) {
    const result = await verifySignedRequest(request, verifier(overrides, keys));
    assert.equal(result.result, expected, JSON.stringify(request.headers));
  }
  const forged = signed();
  forged.headers.signature = `sig1=:${randomBytes(64).toString("base64")}:`;
  assert.equal((await verifySignedRequest(forged, verifier())).result, "bad_signature");
  // A header that only names a provider proves nothing.
  const named: SignedRequest = {
    method: "GET",
    url: new URL("https://shop.test/"),
    headers: { "signature-agent": `sig1="${AGENT}"` },
  };
  assert.equal((await verifySignedRequest(named, verifier())).result, "malformed");
  const unavailable = {
    ...verifier(),
    keys: new KeyDirectory(directoryFetch([], { status: 500 }).fetcher, () => now),
  };
  assert.equal((await verifySignedRequest(signed(), unavailable)).result, "key_unavailable");
});

test("the key directory caches as told, refuses redirects and keeps keys through a failed refresh", async () => {
  let clock = now;
  let healthy = true;
  const calls: string[] = [];
  const fetcher = (async (url: string | URL, init?: RequestInit) => {
    calls.push(String(url));
    assert.equal(init?.redirect, "manual");
    return healthy
      ? new Response(JSON.stringify({ keys: [ed25519.jwk, { kty: "oct", k: "secret" }] }), {
          headers: {
            "content-type": "application/http-message-signatures-directory+json",
            "cache-control": "max-age=120",
          },
        })
      : new Response("down", { status: 503 });
  }) as typeof fetch;
  const directory = new KeyDirectory(fetcher, () => clock);
  assert.deepEqual(await directory.get(DIRECTORY), [ed25519.jwk]);
  assert.deepEqual(await directory.get(DIRECTORY), [ed25519.jwk]);
  assert.equal(calls.length, 1);
  clock += 121_000;
  healthy = false;
  assert.deepEqual(await directory.get(DIRECTORY), [ed25519.jwk]);
  assert.equal(calls.length, 2);

  for (const init of [
    { status: 302, location: "https://attacker.test/keys" },
    { type: "text/html" },
    { status: 404 },
  ]) {
    const { fetcher: refused } = directoryFetch([ed25519.jwk], init);
    assert.equal(await new KeyDirectory(refused, () => now).get(DIRECTORY), null);
  }
  const expiring = { ...ed25519.jwk, exp: Math.floor(now / 1000) - 1 };
  const { fetcher: stale } = directoryFetch([expiring]);
  assert.deepEqual(await new KeyDirectory(stale, () => now).get(DIRECTORY), []);
});

test("a key the signer rotates in is fetched again, at most every 10 seconds", async () => {
  let clock = now;
  let published: object[] = [ed25519.jwk];
  let fetches = 0;
  const fetcher = (async () => {
    fetches++;
    return new Response(JSON.stringify({ keys: published }), {
      headers: { "content-type": "application/http-message-signatures-directory+json" },
    });
  }) as typeof fetch;
  const options = { ...verifier(), keys: new KeyDirectory(fetcher, () => clock) };
  assert.equal((await verifySignedRequest(signed(), options)).result, "verified");
  const rotated = keyPair();
  published = [rotated.jwk];
  clock += 11_000;
  const fresh = { ...options, now: clock };
  assert.equal(
    (
      await verifySignedRequest(
        signed({ key: rotated, created: Math.floor(clock / 1000) - 5 }),
        fresh,
      )
    ).result,
    "verified",
  );
  assert.equal(fetches, 2);
  // Unknown key IDs right after a fetch don't trigger another one.
  const unknown = keyPair();
  assert.equal(
    (
      await verifySignedRequest(
        signed({ key: unknown, created: Math.floor(clock / 1000) - 5 }),
        fresh,
      )
    ).result,
    "bad_signature",
  );
  assert.equal(fetches, 2);
});

function collector(store = new MemoryStore()) {
  const handle = createCollector({
    sites: [site],
    store,
    now: () => new Date(now),
    signers,
    keyFetch: directoryFetch([ed25519.jwk]).fetcher,
  });
  const report = (data: object, headers: Record<string, string> = {}) =>
    handle(
      new Request("https://collector.test/v1/signatures", {
        method: "POST",
        headers: {
          authorization: `Bearer ${site.secret}`,
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify({ siteId: site.id, ...data }),
      }),
    );
  return { handle, report, store };
}
const asReport = (request: SignedRequest) => ({
  method: request.method,
  url: request.url.href,
  headers: request.headers,
});

test("the endpoint records a verified visit once, and a reused signature as a replay", async () => {
  const { report, store } = collector();
  const request = signed();
  const sessionId = "3f2a9c1e-8b7d-4e6f-9a0b-1c2d3e4f5a6b";
  const first = await report({ request: asReport(request), sessionId, accountRef: "acct_42" });
  assert.equal(first.status, 200);
  const { event } = (await first.json()) as { event: SignatureEvent };
  assert.equal(event.evidence, "signature_verified");
  assert.equal(event.result, "verified");
  assert.equal(event.signer, "Test agent");
  assert.equal(event.path, "/tickets/:id");
  assert.equal(event.sessionId, sessionId);
  assert.equal(event.accountRef, "acct_42");

  const retry = await report({ request: asReport(request), sessionId, accountRef: "acct_42" });
  assert.equal(((await retry.json()) as { event: SignatureEvent }).event.id, event.id);

  const reused = { ...asReport(request), url: "https://shop.test/admin" };
  const replay = (await (await report({ request: reused })).json()) as { event: SignatureEvent };
  assert.equal(replay.event.result, "replayed");
  assert.equal(replay.event.evidence, "signature_claimed");
  assert.notEqual(replay.event.id, event.id);

  const cdn = await report({
    request: { method: "GET", url: "https://shop.test/pricing" },
    cdn: { verifier: "cloudflare", signer: "ChatGPT Agent" },
  });
  const viaCdn = ((await cdn.json()) as { event: SignatureEvent }).event;
  assert.equal(viaCdn.evidence, "cdn_reported");
  assert.equal(viaCdn.verifier, "cloudflare");

  const timeline = await store.listActivity(site.id, { limit: 10, type: "signature" });
  assert.deepEqual(timeline.map((item) => item.type === "signature" && item.result).sort(), [
    "replayed",
    "verified",
    "verified",
  ]);
});

test("the endpoint is server to server, needs the site's secret and checks its input", async () => {
  const { report } = collector();
  const body = { request: asReport(signed()) };
  assert.equal((await report(body, { authorization: "Bearer wrong" })).status, 401);
  assert.equal((await report(body, { origin: "https://shop.test" })).status, 403);
  for (const broken of [
    { request: { ...asReport(signed()), url: "not a url" } },
    { request: { ...asReport(signed()), headers: { Signature: "x" } } },
    { request: asReport(signed()), accountRef: "alice@example.com" },
    { request: asReport(signed()), sessionId: "not-a-session" },
    { request: asReport(signed()), cdn: { verifier: "unknown-cdn", signer: "x" } },
    { request: asReport(signed()), extra: true },
  ]) {
    assert.equal((await report(broken)).status, 400, JSON.stringify(broken));
  }
});

test("the Node helper sends only what the signature covers, skips unsigned requests and never throws", async () => {
  const { handle, store } = collector();
  const sent: unknown[] = [];
  const through = (async (url: string | URL, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return handle(new Request(url, init));
  }) as typeof fetch;
  const options = { apiUrl: "https://collector.test", siteId: site.id, secret: site.secret };

  const unsigned = new Request("https://shop.test/pricing");
  assert.deepEqual(await reportSignedRequest(unsigned, { ...options, fetch: through }), {
    status: "skipped",
  });
  assert.equal(sent.length, 0);

  const request = signed();
  const fetchRequest = new Request(request.url, {
    headers: { ...request.headers, cookie: "session=secret", authorization: "Bearer user" },
  });
  const result = await reportSignedRequest(fetchRequest, { ...options, fetch: through });
  assert.equal(result.status, "recorded");
  assert.equal(result.status === "recorded" && result.event.result, "verified");
  const forwarded = (sent[0] as { request: { headers: Record<string, string> } }).request.headers;
  assert.deepEqual(Object.keys(forwarded).sort(), [
    "signature",
    "signature-agent",
    "signature-input",
  ]);

  // Assets would inflate counts, so only documents are reported unless asked.
  for (const asset of [
    new Request("https://shop.test/pricing", {
      headers: { ...request.headers, "sec-fetch-dest": "image" },
    }),
    new Request("https://shop.test/logo.png", { headers: request.headers }),
  ]) {
    assert.deepEqual(await reportSignedRequest(asset, { ...options, fetch: through }), {
      status: "skipped",
    });
  }
  assert.equal(sent.length, 1);

  const node = {
    method: "get",
    originalUrl: "/tickets/123?tab=history",
    headers: { host: "shop.test", ...signed().headers },
  };
  const fromNode = await reportSignedRequest(node, { ...options, fetch: through });
  assert.equal(fromNode.status === "recorded" && fromNode.event.result, "verified");
  assert.equal((await store.listActivity(site.id, { limit: 10 })).length, 2);

  const errors: Error[] = [];
  const failing = (async () => new Response("down", { status: 503 })) as typeof fetch;
  const failed = await reportSignedRequest(fetchRequest, {
    ...options,
    fetch: failing,
    onError: (error) => errors.push(error),
  });
  assert.equal(failed.status, "failed");
  assert.equal(errors.length, 1);
  const thrown = (async () => {
    throw new Error("offline");
  }) as typeof fetch;
  const offline = await reportSignedRequest(fetchRequest, {
    ...options,
    fetch: thrown,
    onError: (error) => errors.push(error),
  });
  assert.equal(offline.status, "failed");
  const insecure = await reportSignedRequest(fetchRequest, {
    ...options,
    apiUrl: "http://collector.example",
    onError: (error) => errors.push(error),
  });
  assert.equal(insecure.status, "failed");
  assert.equal(errors.length, 3);
});
