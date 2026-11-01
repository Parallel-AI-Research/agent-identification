import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, describe, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createCollector } from "../collector/index.js";
import { PostgresStore } from "../collector/postgres-store.js";
import { MemoryStore, type CollectorStore } from "../collector/store.js";
import {
  ProductDirectory,
  SecretCipher,
  type ProductRecord,
  type ProductStore,
} from "../collector/products.js";
import { importSites } from "../scripts/import-sites.js";
import { createBindingContext, verifyDeclarationOnline } from "../src/server/index.js";
import type { CreatedSession, RecordedDeclaration } from "../src/protocol.js";

const cipher = new SecretCipher("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8");
const owners = { alice: randomUUID(), bob: randomUUID() };
const time = Date.parse("2026-11-01T10:00:00Z");
const origin = "https://alice.example";

let database: PGlite;
before(async () => {
  database = new PGlite();
  for (const file of [
    "20261020093721_create_agent_identification_collector.sql",
    "20261101120000_add_customer_products.sql",
    "20261101130000_add_domain_claims.sql",
  ]) {
    await database.exec(
      await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"),
    );
  }
});
after(async () => {
  await database?.close();
});

const stores: [string, () => Promise<CollectorStore & ProductStore>][] = [
  ["memory", async () => new MemoryStore()],
  [
    "postgres",
    async () => {
      await database.exec(
        `truncate agent_identification.products cascade;
         truncate agent_identification.domain_claims;
         truncate agent_identification.sessions cascade;
         truncate agent_identification.rate_buckets`,
      );
      return new PostgresStore(
        async (sql, parameters) =>
          (await database.query<Record<string, unknown>>(sql, parameters)).rows,
      );
    },
  ],
];

function fixture(
  store: CollectorStore & ProductStore,
  options: { clock?: () => number; txt?: Map<string, string[]> } = {},
) {
  const clock = options.clock ?? (() => time);
  const handle = createCollector({
    directory: new ProductDirectory(store, cipher, { ttlMs: 0 }),
    store,
    now: () => new Date(clock()),
    owners: {
      resolveTxt: async (name) => {
        const values = options.txt?.get(name);
        if (!values) throw new Error("ENOTFOUND");
        return values.map((value) => [value]);
      },
      // A credential here is simply the owner's ID; real tokens are covered in owner-auth tests.
      authenticate: async (request) =>
        request.headers.get("authorization")?.replace("Bearer ", "") ?? null,
      products: store,
      cipher,
    },
  });
  const owner = (ownerId: string, path: string, init: RequestInit = {}) =>
    handle(
      new Request(`https://collector.test/v1/owner${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${ownerId}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
      }),
    );
  const create = async (ownerId: string, name: string, origins = [origin]) => {
    const response = await owner(ownerId, "/products", {
      method: "POST",
      body: JSON.stringify({ name, origins }),
    });
    assert.equal(response.status, 201);
    return (await response.json()) as {
      product: { id: string; siteId: string; origins: string[] };
      serverSecret: string;
    };
  };
  const visitor = async (siteId: string, usedOrigin = origin, data: object = {}) =>
    handle(
      new Request("https://collector.test/v1/sessions", {
        method: "POST",
        headers: { origin: usedOrigin, "content-type": "application/json" },
        body: JSON.stringify({ siteId, ...data }),
      }),
    );
  const declare = async (session: CreatedSession, usedOrigin = origin) =>
    handle(
      new Request("https://collector.test/v1/declarations", {
        method: "POST",
        headers: {
          origin: usedOrigin,
          authorization: `Bearer ${session.sessionToken}`,
          "x-agent-site": session.siteId,
          "content-type": "application/json",
        },
        body: JSON.stringify({ choice: "ai_assistant", requestId: randomUUID() }),
      }),
    );
  return { handle, owner, create, visitor, declare };
}

for (const [kind, open] of stores) {
  describe(`customer ownership (${kind})`, () => {
    let store: CollectorStore & ProductStore;
    beforeEach(async () => {
      store = await open();
    });

    test("two customers get different configuration and see only their own products", async () => {
      const { owner, create } = fixture(store);
      const a = await create(owners.alice, "Alice's product");
      const b = await create(owners.bob, "Bob's product", ["https://bob.example"]);
      assert.notEqual(a.product.siteId, b.product.siteId);
      assert.notEqual(a.serverSecret, b.serverSecret);
      assert.match(a.product.siteId, /^site_[A-Za-z0-9_-]{16}$/);
      const list = (await (await owner(owners.alice, "/products")).json()) as {
        products: { id: string }[];
      };
      assert.deepEqual(
        list.products.map((product) => product.id),
        [a.product.id],
      );
    });

    test("another customer cannot read, change or export a product", async () => {
      const { owner, create, visitor, declare } = fixture(store);
      const a = await create(owners.alice, "Alice's product");
      const session = (await (await visitor(a.product.siteId)).json()) as CreatedSession;
      assert.equal((await declare(session)).status, 200);

      for (const [path, init] of [
        [`/products/${a.product.id}`, {}],
        [`/products/${a.product.id}/events`, {}],
        [
          `/products/${a.product.id}`,
          { method: "PATCH", body: JSON.stringify({ name: "Taken over" }) },
        ],
      ] as [string, RequestInit][]) {
        const response = await owner(owners.bob, path, init);
        assert.equal(response.status, 404, path);
        assert.equal(((await response.json()) as { error: string }).error, "Not found");
      }
      const mine = await owner(owners.alice, `/products/${a.product.id}`);
      assert.equal(
        ((await mine.json()) as { product: { name: string } }).product.name,
        "Alice's product",
      );
      const events = (await (
        await owner(owners.alice, `/products/${a.product.id}/events`)
      ).json()) as { events: { choice: string }[] };
      assert.deepEqual(
        events.events.map((event) => event.choice),
        ["ai_assistant"],
      );
    });

    test("responses never expose secrets, and the secret is only returned at creation", async () => {
      const { owner, create } = fixture(store);
      const a = await create(owners.alice, "Alice's product");
      const stored = await store.getProduct(owners.alice, a.product.id);
      assert(stored);
      assert(!stored.secretCiphertext.includes(a.serverSecret));
      assert.equal(cipher.open(stored.secretCiphertext, a.product.siteId), a.serverSecret);
      for (const path of ["/products", `/products/${a.product.id}`]) {
        const text = await (await owner(owners.alice, path)).text();
        assert(!text.includes(a.serverSecret), path);
        assert(!text.includes("ciphertext"), path);
      }
    });

    test("invalid origins and names fail clearly and create nothing", async () => {
      const { owner } = fixture(store);
      for (const data of [
        { name: "No origins", origins: [] },
        { name: "Path", origins: ["https://example.com/app"] },
        { name: "Wildcard", origins: ["https://*.example.com"] },
        { name: "Plain http", origins: ["http://example.com"] },
        { name: "Not a URL", origins: ["example.com"] },
        { name: "", origins: [origin] },
      ]) {
        const response = await owner(owners.alice, "/products", {
          method: "POST",
          body: JSON.stringify(data),
        });
        assert.equal(response.status, 400, JSON.stringify(data));
        assert(((await response.json()) as { error: string }).error.length > 10);
      }
      assert.equal(await store.countProducts(owners.alice), 0);
    });

    test("a new product works immediately, and only for its exact origins", async () => {
      const { create, visitor, owner } = fixture(store);
      const a = await create(owners.alice, "Alice's product");
      assert.equal((await visitor(a.product.siteId)).status, 201);
      assert.equal((await visitor(a.product.siteId, "https://other.example")).status, 403);

      const next = "https://new.example";
      const updated = await owner(owners.alice, `/products/${a.product.id}`, {
        method: "PATCH",
        body: JSON.stringify({ origins: [next] }),
      });
      assert.deepEqual(
        ((await updated.json()) as { product: { origins: string[] } }).product.origins,
        [next],
      );
      assert.equal((await visitor(a.product.siteId, next)).status, 201);
      assert.equal((await visitor(a.product.siteId)).status, 403);
    });

    test("owner routes require a sign-in and reject browser requests", async () => {
      const { handle, owner } = fixture(store);
      const anonymous = await handle(new Request("https://collector.test/v1/owner/products"));
      assert.equal(anonymous.status, 401);
      const browser = await owner(owners.alice, "/products", {
        headers: { origin: "https://dashboard.example" },
      });
      assert.equal(browser.status, 403);
      assert.equal(browser.headers.get("access-control-allow-origin"), null);
      assert.equal((await owner(owners.alice, "/products/not-a-uuid")).status, 404);
    });

    test("rotation keeps both secrets working for 24 hours, then only the new one", async () => {
      let clock = time;
      const { handle, owner, create, visitor, declare } = fixture(store, { clock: () => clock });
      const a = await create(owners.alice, "Alice's product");
      const siteId = a.product.siteId;
      const rotated = await owner(owners.alice, `/products/${a.product.id}/secret`, {
        method: "POST",
      });
      assert.equal(rotated.status, 200);
      const { serverSecret: next, product } = (await rotated.json()) as {
        serverSecret: string;
        product: { previousSecretExpiresAt: string };
      };
      assert.notEqual(next, a.serverSecret);
      assert.equal(product.previousSecretExpiresAt, new Date(time + 86400000).toISOString());

      const exportWith = async (secret: string) =>
        (
          await handle(
            new Request(`https://collector.test/v1/events?siteId=${siteId}`, {
              headers: { authorization: `Bearer ${secret}` },
            }),
          )
        ).status;
      assert.equal(await exportWith(a.serverSecret), 200);
      assert.equal(await exportWith(next), 200);

      // A server that hasn't deployed yet and one that has can both complete a protected action.
      for (const [index, secret] of [a.serverSecret, next].entries()) {
        const settings = {
          siteId,
          origin,
          secret,
          sessionBinding: `host-session-${index}`,
          now: new Date(clock),
        };
        const session = (await (
          await visitor(siteId, origin, { bindingContext: createBindingContext(settings) })
        ).json()) as CreatedSession;
        const recorded = (await (await declare(session)).json()) as RecordedDeclaration;
        const claims = await verifyDeclarationOnline(recorded.receipt, {
          ...settings,
          apiUrl: "https://collector.test",
          fetch: (input, init) => handle(new Request(input as URL, init)),
        });
        assert.equal(claims.choice, "ai_assistant");
      }

      const again = await owner(owners.alice, `/products/${a.product.id}/secret`, {
        method: "POST",
      });
      assert.equal(again.status, 409);

      clock = time + 86400001;
      assert.equal(await exportWith(a.serverSecret), 401);
      assert.equal(await exportWith(next), 200);
      assert.equal(
        (await owner(owners.alice, `/products/${a.product.id}/secret`, { method: "POST" })).status,
        200,
      );
    });

    test("revoke-now ends the old secret immediately and only for the owner", async () => {
      const { handle, owner, create } = fixture(store);
      const a = await create(owners.alice, "Alice's product");
      await owner(owners.alice, `/products/${a.product.id}/secret`, { method: "POST" });
      const path = `/products/${a.product.id}/secret/previous`;
      assert.equal((await owner(owners.bob, path, { method: "DELETE" })).status, 404);
      assert.equal(
        (await owner(owners.bob, `/products/${a.product.id}/secret`, { method: "POST" })).status,
        404,
      );
      const exportOld = () =>
        handle(
          new Request(`https://collector.test/v1/events?siteId=${a.product.siteId}`, {
            headers: { authorization: `Bearer ${a.serverSecret}` },
          }),
        );
      assert.equal((await exportOld()).status, 200);
      const revoked = await owner(owners.alice, path, { method: "DELETE" });
      assert.equal(
        ((await revoked.json()) as { product: { previousSecretExpiresAt: null } }).product
          .previousSecretExpiresAt,
        null,
      );
      assert.equal((await exportOld()).status, 401);
    });

    test("DNS verification is non-blocking, and a domain has one verified owner", async () => {
      const txt = new Map<string, string[]>();
      const { owner, create, visitor, declare } = fixture(store, { txt });
      const a = await create(owners.alice, "Alice's product", [
        "https://www.alice.example",
        "http://localhost:3000",
      ]);
      const domainsPath = `/products/${a.product.id}/domains`;
      type Domain = {
        domain: string;
        status: string;
        record: { name: string; value: string } | null;
      };
      const list = async () =>
        ((await (await owner(owners.alice, domainsPath)).json()) as { domains: Domain[] }).domains;
      const before = await list();
      assert.deepEqual(
        before.map(({ domain, status }) => [domain, status]),
        [
          ["www.alice.example", "unverified"],
          ["localhost", "not_applicable"],
        ],
      );
      assert.equal(before[0]!.record!.name, "_agent-identification.www.alice.example");

      // Events arrive before the domain is verified.
      const session = (await (
        await visitor(a.product.siteId, "https://www.alice.example")
      ).json()) as CreatedSession;
      assert.equal((await declare(session, "https://www.alice.example")).status, 200);

      const verify = (ownerId: string, id: string, domain: string) =>
        owner(ownerId, `/products/${id}/domains/verify`, {
          method: "POST",
          body: JSON.stringify({ domain }),
        });
      const missing = await verify(owners.alice, a.product.id, "www.alice.example");
      assert.equal(missing.status, 422);
      assert.match(((await missing.json()) as { error: string }).error, /No matching TXT record/);
      assert.equal((await verify(owners.alice, a.product.id, "other.example")).status, 400);

      txt.set(before[0]!.record!.name, ["unrelated", before[0]!.record!.value]);
      assert.equal((await verify(owners.alice, a.product.id, "www.alice.example")).status, 200);
      assert.equal((await list())[0]!.status, "verified");

      // The same owner can reuse the domain; another owner cannot verify it.
      const second = await create(owners.alice, "Second product", ["https://www.alice.example"]);
      const reused = (await (
        await owner(owners.alice, `/products/${second.product.id}/domains`)
      ).json()) as { domains: Domain[] };
      assert.equal(reused.domains[0]!.status, "verified");

      const b = await create(owners.bob, "Bob's product", ["https://www.alice.example"]);
      const theirs = (await (
        await owner(owners.bob, `/products/${b.product.id}/domains`)
      ).json()) as {
        domains: Domain[];
      };
      txt.set(theirs.domains[0]!.record!.name, [theirs.domains[0]!.record!.value]);
      assert.equal((await verify(owners.bob, b.product.id, "www.alice.example")).status, 409);
    });

    test("operator sites keep their IDs and secrets, and no customer can reach them", async () => {
      const secret = "operator-site-secret-0123456789012345678901";
      const site = { id: "ticket-management", origins: [origin], secret };
      assert.deepEqual(await importSites([site], store, cipher, time), {
        imported: ["ticket-management"],
        skipped: [],
      });
      assert.deepEqual(await importSites([site], store, cipher, time), {
        imported: [],
        skipped: ["ticket-management"],
      });

      const { handle, owner, visitor, declare } = fixture(store);
      assert.deepEqual(
        ((await (await owner(owners.alice, "/products")).json()) as { products: unknown[] })
          .products,
        [],
      );
      const stored = (await store.getProductBySiteId("ticket-management")) as ProductRecord;
      assert.equal(stored.ownerId, null);
      assert.equal((await owner(owners.alice, `/products/${stored.id}`)).status, 404);

      // An install bound with the existing secret still verifies after the move to storage.
      const sessionBinding = "host-session-1";
      const settings = {
        siteId: "ticket-management",
        origin,
        secret,
        sessionBinding,
        now: new Date(time),
      };
      const session = (await (
        await visitor("ticket-management", origin, {
          bindingContext: createBindingContext(settings),
        })
      ).json()) as CreatedSession;
      const recorded = (await (await declare(session)).json()) as RecordedDeclaration;
      const claims = await verifyDeclarationOnline(recorded.receipt, {
        ...settings,
        apiUrl: "https://collector.test",
        fetch: (input, init) => handle(new Request(input as URL, init)),
      });
      assert.equal(claims.choice, "ai_assistant");
    });
  });
}

test("ciphertext cannot be moved to another site or read with another key", () => {
  const sealed = cipher.seal("a-site-secret", "site-one");
  assert.equal(cipher.open(sealed, "site-one"), "a-site-secret");
  assert.throws(() => cipher.open(sealed, "site-two"));
  assert.throws(() =>
    new SecretCipher("HxwbGhkYFxYVFBMSERAPDg0MCwoJCAcGBQQDAgEAHx4").open(sealed, "site-one"),
  );
  assert.throws(() => new SecretCipher("too-short"));
});

test("the directory caches misses and hits, and sees changes once invalidated", async () => {
  const store = new MemoryStore();
  let lookups = 0;
  const counting = new Proxy(store, {
    get(target, key, receiver) {
      if (key === "getProductBySiteId") lookups++;
      const value = Reflect.get(target, key, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  let clock = time;
  const directory = new ProductDirectory(counting, cipher, { clock: () => clock, ttlMs: 1000 });
  assert.equal(await directory.find("unknown"), null);
  assert.equal(await directory.find("unknown"), null);
  assert.equal(lookups, 1);
  clock += 1001;
  assert.equal(await directory.find("unknown"), null);
  assert.equal(lookups, 2);
  await store.createProduct({
    id: randomUUID(),
    ownerId: owners.alice,
    name: "Later",
    siteId: "unknown",
    origins: [origin],
    secretCiphertext: cipher.seal("a-secret-long-enough-for-this-test-00000", "unknown"),
    previousSecretCiphertext: null,
    previousSecretExpiresAt: null,
    createdAt: time,
    updatedAt: time,
  });
  directory.invalidate("unknown");
  assert.equal((await directory.find("unknown"))?.id, "unknown");
});
