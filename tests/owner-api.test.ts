import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, describe, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import postgres from "postgres";
import { createCollector } from "../collector/index.js";
import { PostgresStore, postgresExecutor } from "../collector/postgres-store.js";
import { MemoryStore, type CollectorStore } from "../collector/store.js";
import {
  ProductDirectory,
  SecretCipher,
  type EnvironmentRecord,
  type ProductStore,
} from "../collector/products.js";
import { importSites } from "../scripts/import-sites.js";
import { createBindingContext, verifyDeclarationOnline } from "../src/server/index.js";
import type {
  ActionEvent,
  ActivityEvent,
  CreatedSession,
  DeclarationEvent,
  PageViewEvent,
  RecordedDeclaration,
  SignatureEvent,
} from "../src/protocol.js";

const cipher = new SecretCipher("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8");
const owners = { alice: randomUUID(), bob: randomUUID() };
const time = Date.parse("2026-11-01T10:00:00Z");
const origin = "https://alice.example";

const MIGRATIONS = [
  "20261020093721_create_agent_identification_collector.sql",
  "20261101120000_add_customer_products.sql",
  "20261101130000_add_domain_claims.sql",
  "20261101140000_add_environments.sql",
  "20261102120000_add_install_activity.sql",
  "20261102130000_add_activity_events.sql",
  "20261102140000_add_signature_events.sql",
];
const RESET = `reset role;
  truncate agent_identification.products cascade;
  truncate agent_identification.domain_claims;
  truncate agent_identification.sessions cascade;
  truncate agent_identification.rate_buckets;
  truncate agent_identification.install_activity;
  truncate agent_identification.activity_events;
  set role agent_id_app`;

async function migrated(): Promise<PGlite> {
  const instance = new PGlite();
  for (const file of MIGRATIONS) {
    await instance.exec(
      await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"),
    );
  }
  return instance;
}

let database: PGlite;
let wireDatabase: PGlite;
let wireServer: PGLiteSocketServer;
let wire: postgres.Sql;
before(async () => {
  database = await migrated();
  // The driver production uses treats parameters differently from PGlite's own client.
  wireDatabase = await migrated();
  wireServer = new PGLiteSocketServer({ db: wireDatabase, host: "127.0.0.1", port: 55432 });
  await wireServer.start();
  wire = postgres({
    host: "127.0.0.1",
    port: 55432,
    user: "postgres",
    database: "postgres",
    max: 1,
    prepare: false,
    ssl: false,
  });
});
after(async () => {
  await wire?.end({ timeout: 2 });
  await wireServer?.stop();
  await wireDatabase?.close();
  await database?.close();
});

interface Created {
  product: { id: string; name: string; environments: Environment[] };
  environment: Environment;
  serverSecret: string;
}
interface Environment {
  id: string;
  type: string;
  name: string;
  siteId: string;
  origins: string[];
  previousSecretExpiresAt: string | null;
}
interface Install {
  status: "waiting" | "receiving";
  loaded: { origin: string; firstSeenAt: string; lastSeenAt: string }[];
  lastDeclarationAt: string | null;
  checkedAt: string;
  issues: { signal: string; origin: string | null; firstSeenAt: string; lastSeenAt: string }[];
}
const path = (created: Created) =>
  `/products/${created.product.id}/environments/${created.environment.id}`;

const stores: [string, () => Promise<CollectorStore & ProductStore>][] = [
  ["memory", async () => new MemoryStore()],
  [
    "postgres",
    async () => {
      await database.exec(RESET);
      // Runs as the restricted role, so a missing grant or policy fails here, not in production.
      return new PostgresStore(
        async (sql, parameters) =>
          (await database.query<Record<string, unknown>>(sql, parameters)).rows,
      );
    },
  ],
  [
    "postgres driver",
    async () => {
      await wire.unsafe(RESET);
      return new PostgresStore(postgresExecutor(wire));
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
  const create = async (ownerId: string, name: string, origins = [origin]): Promise<Created> => {
    const response = await owner(ownerId, "/products", {
      method: "POST",
      body: JSON.stringify({ name, origins }),
    });
    assert.equal(response.status, 201);
    const created = (await response.json()) as Omit<Created, "environment">;
    return { ...created, environment: created.product.environments[0]! };
  };
  const addEnvironment = async (ownerId: string, base: Created, data: object): Promise<Created> => {
    const response = await owner(ownerId, `/products/${base.product.id}/environments`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    assert.equal(response.status, 201);
    const created = (await response.json()) as Pick<Created, "environment" | "serverSecret">;
    return { ...base, ...created };
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
  const install = async (ownerId: string, created: Created): Promise<Install> =>
    ((await (await owner(ownerId, path(created))).json()) as { environment: { install: Install } })
      .environment.install;
  return { handle, owner, create, addEnvironment, visitor, declare, install };
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
      assert.notEqual(a.environment.siteId, b.environment.siteId);
      assert.notEqual(a.serverSecret, b.serverSecret);
      assert.match(a.environment.siteId, /^site_[A-Za-z0-9_-]{16}$/);
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
      const session = (await (await visitor(a.environment.siteId)).json()) as CreatedSession;
      assert.equal((await declare(session)).status, 200);

      for (const [route, init] of [
        [`/products/${a.product.id}`, {}],
        [path(a), {}],
        [`${path(a)}/events`, {}],
        [
          `/products/${a.product.id}`,
          { method: "PATCH", body: JSON.stringify({ name: "Taken over" }) },
        ],
      ] as [string, RequestInit][]) {
        const response = await owner(owners.bob, route, init);
        assert.equal(response.status, 404, route);
        assert.equal(((await response.json()) as { error: string }).error, "Not found");
      }
      const mine = await owner(owners.alice, `/products/${a.product.id}`);
      assert.equal(
        ((await mine.json()) as { product: { name: string } }).product.name,
        "Alice's product",
      );
      const events = (await (await owner(owners.alice, `${path(a)}/events`)).json()) as {
        events: { choice: string }[];
      };
      assert.deepEqual(
        events.events.map((event) => event.choice),
        ["ai_assistant"],
      );
    });

    test("responses never expose secrets, and the secret is only returned at creation", async () => {
      const { owner, create } = fixture(store);
      const a = await create(owners.alice, "Alice's product");
      const stored = (await store.getProduct(owners.alice, a.product.id))?.environments[0];
      assert(stored);
      assert(!stored.secretCiphertext.includes(a.serverSecret));
      assert.equal(cipher.open(stored.secretCiphertext, a.environment.siteId), a.serverSecret);
      for (const route of ["/products", `/products/${a.product.id}`, path(a)]) {
        const text = await (await owner(owners.alice, route)).text();
        assert(!text.includes(a.serverSecret), route);
        assert(!text.includes("ciphertext"), route);
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
      assert.equal((await visitor(a.environment.siteId)).status, 201);
      assert.equal((await visitor(a.environment.siteId, "https://other.example")).status, 403);

      const next = "https://new.example";
      const updated = await owner(owners.alice, path(a), {
        method: "PATCH",
        body: JSON.stringify({ origins: [next] }),
      });
      assert.deepEqual(
        ((await updated.json()) as { environment: { origins: string[] } }).environment.origins,
        [next],
      );
      assert.equal((await visitor(a.environment.siteId, next)).status, 201);
      assert.equal((await visitor(a.environment.siteId)).status, 403);
    });

    test("an install waits until the widget loads, and copying a snippet changes nothing", async () => {
      const { owner, create, visitor, declare, install } = fixture(store);
      const a = await create(owners.alice, "Alice's product");
      assert.deepEqual(await install(owners.alice, a), {
        status: "waiting",
        loaded: [],
        lastDeclarationAt: null,
        checkedAt: new Date(time).toISOString(),
        issues: [],
      });
      // Reading the product is all that copying a snippet involves.
      await owner(owners.alice, `/products/${a.product.id}`);
      assert.equal((await install(owners.alice, a)).status, "waiting");

      const session = (await (await visitor(a.environment.siteId)).json()) as CreatedSession;
      let current = await install(owners.alice, a);
      assert.equal(current.status, "receiving");
      assert.deepEqual(
        current.loaded.map((row) => row.origin),
        [origin],
      );
      assert.equal(current.lastDeclarationAt, null);
      assert.equal((await declare(session)).status, 200);
      current = await install(owners.alice, a);
      assert.equal(current.lastDeclarationAt, new Date(time).toISOString());

      const list = (await (await owner(owners.alice, "/products")).json()) as {
        products: { environments: { install: Install }[] }[];
      };
      assert.equal(list.products[0]!.environments[0]!.install.status, "receiving");

      // Loads only count from origins the environment still allows.
      await owner(owners.alice, path(a), {
        method: "PATCH",
        body: JSON.stringify({ origins: ["https://moved.example"] }),
      });
      assert.equal((await install(owners.alice, a)).status, "waiting");
    });

    test("a refused install tells its owner what to fix, and nobody else", async () => {
      const { handle, owner, create, visitor, install } = fixture(store);
      const a = await create(owners.alice, "Alice's product");
      const b = await create(owners.bob, "Bob's product", ["https://bob.example"]);
      const www = "https://www.alice.example";
      assert.equal((await visitor(a.environment.siteId, www)).status, 403);
      const unbound = await visitor(a.environment.siteId, origin, { bindingContext: "invalid" });
      assert.equal(unbound.status, 400);
      const exported = await handle(
        new Request(`https://collector.test/v1/events?siteId=${a.environment.siteId}`, {
          headers: { authorization: `Bearer ${b.serverSecret}` },
        }),
      );
      assert.equal(exported.status, 401);

      const current = await install(owners.alice, a);
      assert.equal(current.status, "waiting");
      assert.deepEqual(current.issues.map(({ signal, origin }) => [signal, origin]).sort(), [
        ["binding_refused", origin],
        ["origin_refused", www],
        ["secret_refused", null],
      ]);
      assert.deepEqual((await install(owners.bob, b)).issues, []);

      await owner(owners.alice, path(a), {
        method: "PATCH",
        body: JSON.stringify({ origins: [origin, www] }),
      });
      const fixed = await install(owners.alice, a);
      assert(!fixed.issues.some((issue) => issue.signal === "origin_refused"));
      assert.equal((await visitor(a.environment.siteId, www)).status, 201);
      assert.equal((await install(owners.alice, a)).status, "receiving");
    });

    test("refusals are capped per site, noted once a minute, and drop off after a week", async () => {
      let now = time;
      const { create, visitor, install } = fixture(store, { clock: () => now });
      const a = await create(owners.alice, "Alice's product");
      for (let index = 0; index < 30; index++) {
        await visitor(a.environment.siteId, `https://made-up-${index}.example`);
      }
      assert.equal((await install(owners.alice, a)).issues.length, 20);

      const first = "https://made-up-0.example";
      const lastSeen = async () =>
        (await install(owners.alice, a)).issues.find((issue) => issue.origin === first)?.lastSeenAt;
      now = time + 30_000;
      await visitor(a.environment.siteId, first);
      assert.equal(await lastSeen(), new Date(time).toISOString());
      now = time + 61_000;
      await visitor(a.environment.siteId, first);
      assert.equal(await lastSeen(), new Date(now).toISOString());

      now = time + 8 * 24 * 60 * 60 * 1000;
      assert.deepEqual((await install(owners.alice, a)).issues, []);
    });

    test("a declaration joins its session's timeline with the agent's own description", async () => {
      const { handle, owner, create, visitor } = fixture(store);
      const a = await create(owners.alice, "Alice's product");
      const session = (await (await visitor(a.environment.siteId)).json()) as CreatedSession;
      const requestId = randomUUID();
      const declare = (data: object) =>
        handle(
          new Request("https://collector.test/v1/declarations", {
            method: "POST",
            headers: {
              origin,
              authorization: `Bearer ${session.sessionToken}`,
              "x-agent-site": session.siteId,
              "content-type": "application/json",
            },
            body: JSON.stringify({ choice: "ai_assistant", requestId, ...data }),
          }),
        );
      assert.equal((await declare({ agent: { name: "x".repeat(101) } })).status, 400);
      assert.equal((await declare({ agent: { model: "anything" } })).status, 400);
      const agent = { name: "Research helper", provider: "Example AI", purpose: "Compare plans" };
      const accepted = (await (await declare({ agent })).json()) as RecordedDeclaration;
      // A retry is the same declaration, so its description can't be changed afterwards.
      const retried = await declare({ agent: { name: "Someone else" } });
      assert.equal(((await retried.json()) as RecordedDeclaration).eventId, accepted.eventId);

      const timeline = async (ownerId: string, query = "") =>
        owner(ownerId, `${path(a)}/activity${query}`);
      const { events } = (await (await timeline(owners.alice)).json()) as {
        events: ActivityEvent[];
      };
      const at = new Date(time).toISOString();
      assert.deepEqual(events, [
        {
          id: accepted.eventId,
          siteId: a.environment.siteId,
          sessionId: session.sessionId,
          origin,
          type: "declaration",
          source: "browser",
          evidence: "self_reported",
          occurredAt: at,
          receivedAt: at,
          accountRef: null,
          choice: "ai_assistant",
          agent,
        },
      ]);
      const count = async (query: string) =>
        ((await (await timeline(owners.alice, query)).json()) as { events: unknown[] }).events
          .length;
      assert.equal(await count(`?sessionId=${session.sessionId}`), 1);
      assert.equal(await count(`?sessionId=${randomUUID()}`), 0);
      assert.equal((await timeline(owners.alice, "?sessionId=not-a-session")).status, 400);
      assert.equal((await timeline(owners.bob)).status, 404);
    });

    test("activity keeps every source side by side, records a retry once and refuses a changed one", async () => {
      const { create, visitor } = fixture(store);
      const a = await create(owners.alice, "Alice's product");
      const b = await create(owners.bob, "Bob's product", ["https://bob.example"]);
      const session = (await (await visitor(a.environment.siteId)).json()) as CreatedSession;
      const at = (offset: number) => new Date(time + offset).toISOString();
      const base = { siteId: a.environment.siteId, sessionId: session.sessionId };
      const view: PageViewEvent = {
        ...base,
        id: randomUUID(),
        type: "page_view",
        source: "browser",
        evidence: "browser_reported",
        origin,
        occurredAt: at(0),
        receivedAt: at(0),
        accountRef: null,
        path: "/tickets/:id",
        route: "/tickets/:ticketId",
      };
      const attempted: ActionEvent = {
        ...base,
        id: randomUUID(),
        type: "action",
        source: "server",
        evidence: "host_reported",
        origin: null,
        occurredAt: at(1000),
        receivedAt: at(1000),
        accountRef: "acct_42",
        action: "ticket.update",
        resourceRef: "ticket_7",
        outcome: "attempted",
      };
      const rejected: ActionEvent = {
        ...attempted,
        id: randomUUID(),
        occurredAt: at(2000),
        receivedAt: at(2000),
        outcome: "rejected",
      };
      const person: DeclarationEvent = {
        ...base,
        id: randomUUID(),
        type: "declaration",
        source: "browser",
        evidence: "self_reported",
        origin,
        occurredAt: at(3000),
        receivedAt: at(3000),
        accountRef: null,
        choice: "person",
        agent: { name: null, provider: null, purpose: null },
      };
      for (const event of [view, attempted, rejected, person]) {
        assert.equal((await store.recordActivity(event)).status, "recorded");
      }
      // A retry repeats the event; only when it arrived differs.
      assert.deepEqual(await store.recordActivity({ ...view, receivedAt: at(9000) }), {
        status: "duplicate",
        event: view,
      });
      assert.deepEqual(await store.recordActivity({ ...attempted, outcome: "confirmed" }), {
        status: "conflict",
      });
      // IDs belong to a site, so another customer's events never collide.
      const elsewhere = { ...view, siteId: b.environment.siteId };
      assert.equal((await store.recordActivity(elsewhere)).status, "recorded");

      // A Person answer and the host's reports of agent-like actions stay side by side.
      const timeline = await store.listActivity(a.environment.siteId, {
        limit: 100,
        sessionId: session.sessionId,
      });
      assert.deepEqual(
        timeline.map((event) => [event.type, event.source, event.evidence]),
        [
          ["declaration", "browser", "self_reported"],
          ["action", "server", "host_reported"],
          ["action", "server", "host_reported"],
          ["page_view", "browser", "browser_reported"],
        ],
      );
      assert.deepEqual(timeline[3], view);
      assert.equal((await store.listActivity(a.environment.siteId, { limit: 2 })).length, 2);

      for (const invalid of [
        { ...view, id: randomUUID(), path: "/tickets/12345" },
        { ...view, id: randomUUID(), route: "/search?q=alice" },
        { ...attempted, id: randomUUID(), accountRef: "alice@example.com" },
        { ...attempted, id: randomUUID(), origin },
        { ...attempted, id: randomUUID(), action: "Update ticket" },
        { ...person, id: randomUUID(), evidence: "host_reported" },
        { ...view, id: randomUUID().toUpperCase() },
      ] as ActivityEvent[]) {
        await assert.rejects(store.recordActivity(invalid), /Invalid activity event/);
      }
    });

    test("signature events keep how they were checked, and the timeline filters by type", async () => {
      const { owner, create } = fixture(store);
      const a = await create(owners.alice, "Alice's product");
      const at = new Date(time).toISOString();
      const verified: SignatureEvent = {
        id: randomUUID(),
        siteId: a.environment.siteId,
        sessionId: null,
        origin: null,
        type: "signature",
        source: "server",
        evidence: "signature_verified",
        occurredAt: at,
        receivedAt: at,
        accountRef: "acct_42",
        signer: "Test agent",
        signatureAgent: "https://agent.test",
        result: "verified",
        verifier: null,
        path: "/pricing",
      };
      const claimed: SignatureEvent = {
        ...verified,
        id: randomUUID(),
        evidence: "signature_claimed",
        signer: null,
        signatureAgent: "https://unknown.test",
        result: "unknown_signer",
      };
      const viaCdn: SignatureEvent = {
        ...verified,
        id: randomUUID(),
        evidence: "cdn_reported",
        signatureAgent: null,
        verifier: "akamai",
      };
      for (const event of [verified, claimed, viaCdn]) {
        assert.equal((await store.recordActivity(event)).status, "recorded");
      }
      for (const invalid of [
        { ...claimed, id: randomUUID(), result: "verified" },
        { ...verified, id: randomUUID(), signer: null },
        { ...verified, id: randomUUID(), result: "expired" },
        { ...viaCdn, id: randomUUID(), verifier: null },
        { ...verified, id: randomUUID(), origin },
      ] as SignatureEvent[]) {
        await assert.rejects(store.recordActivity(invalid), /Invalid activity event/);
      }
      const response = await owner(owners.alice, `${path(a)}/activity?type=signature`);
      const { events } = (await response.json()) as { events: SignatureEvent[] };
      assert.deepEqual(
        events.map((event) => event.id).sort(),
        [verified.id, claimed.id, viaCdn.id].sort(),
      );
      assert.deepEqual(
        events.find((event) => event.id === verified.id),
        verified,
      );
      assert.equal((await owner(owners.alice, `${path(a)}/activity?type=nope`)).status, 400);
    });

    test("activity is kept for 30 days, after its session has gone", async () => {
      const { create, visitor, declare } = fixture(store);
      const a = await create(owners.alice, "Alice's product");
      const session = (await (await visitor(a.environment.siteId)).json()) as CreatedSession;
      assert.equal((await declare(session)).status, 200);
      const day = 24 * 60 * 60 * 1000;
      const prune = (at: number) =>
        store.prune({ sessions: at - 7 * day, activity: at - 30 * day }, at, 1000);
      const activity = () => store.listActivity(a.environment.siteId, { limit: 100 });
      assert.equal((await prune(time + 8 * day)).removedSessions, 1);
      assert.equal((await store.listEvents(a.environment.siteId, 100)).length, 0);
      assert.equal((await activity()).length, 1);
      assert.equal((await prune(time + 31 * day)).removedActivity, 1);
      assert.deepEqual(await activity(), []);
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

    test("a product starts with production, and each environment has its own credentials", async () => {
      const { owner, create, addEnvironment } = fixture(store);
      const production = await create(owners.alice, "Alice's product");
      assert.deepEqual(
        production.product.environments.map(({ type, name }) => [type, name]),
        [["production", "Production"]],
      );
      const dev = await addEnvironment(owners.alice, production, {
        type: "dev",
        origins: ["http://localhost:3000"],
      });
      const beta = await addEnvironment(owners.alice, production, {
        type: "beta",
        name: "Early access",
        origins: ["https://beta.alice.example"],
      });
      assert.equal(new Set([production, dev, beta].map((item) => item.environment.siteId)).size, 3);
      assert.equal(new Set([production, dev, beta].map((item) => item.serverSecret)).size, 3);
      assert.equal(dev.environment.name, "Dev");
      assert.equal(beta.environment.name, "Early access");

      // Production always comes first, so it can be the default.
      const listed = (await (
        await owner(owners.alice, `/products/${production.product.id}`)
      ).json()) as {
        product: { environments: Environment[] };
      };
      assert.deepEqual(
        listed.product.environments.map((item) => item.type),
        ["production", "beta", "dev"],
      );

      const add = (data: object) =>
        owner(owners.alice, `/products/${production.product.id}/environments`, {
          method: "POST",
          body: JSON.stringify(data),
        });
      assert.equal((await add({ type: "dev", origins: [origin] })).status, 409);
      assert.equal((await add({ type: "production", origins: [origin] })).status, 409);
      assert.equal((await add({ type: "qa", origins: [origin] })).status, 400);
      assert.equal(
        (await add({ type: "staging", origins: ["https://*.alice.example"] })).status,
        400,
      );

      // The name can change. The type is fixed.
      const renamed = await owner(owners.alice, path(beta), {
        method: "PATCH",
        body: JSON.stringify({ name: "Preview" }),
      });
      const { environment } = (await renamed.json()) as { environment: Environment };
      assert.deepEqual([environment.name, environment.type], ["Preview", "beta"]);
      const retyped = await owner(owners.alice, path(beta), {
        method: "PATCH",
        body: JSON.stringify({ type: "production" }),
      });
      assert.equal(retyped.status, 400);
    });

    test("environments stay isolated from each other within one customer", async () => {
      const { handle, owner, create, addEnvironment, visitor, declare } = fixture(store);
      const production = await create(owners.alice, "Alice's product");
      const devOrigin = "http://localhost:3000";
      const dev = await addEnvironment(owners.alice, production, {
        type: "dev",
        origins: [devOrigin],
      });
      const session = (await (
        await visitor(dev.environment.siteId, devOrigin)
      ).json()) as CreatedSession;
      assert.equal((await declare(session, devOrigin)).status, 200);

      // Dev traffic never reaches production's numbers.
      const events = async (created: Created) =>
        (
          (await (await owner(owners.alice, `${path(created)}/events`)).json()) as {
            events: unknown[];
          }
        ).events.length;
      assert.equal(await events(dev), 1);
      assert.equal(await events(production), 0);

      // Each site ID works only from its own origins.
      assert.equal((await visitor(production.environment.siteId, devOrigin)).status, 403);
      assert.equal((await visitor(dev.environment.siteId, origin)).status, 403);

      // One environment's secret can't read another's events.
      const exportEvents = (siteId: string, secret: string) =>
        handle(
          new Request(`https://collector.test/v1/events?siteId=${siteId}`, {
            headers: { authorization: `Bearer ${secret}` },
          }),
        );
      assert.equal((await exportEvents(dev.environment.siteId, dev.serverSecret)).status, 200);
      assert.equal(
        (await exportEvents(dev.environment.siteId, production.serverSecret)).status,
        401,
      );
      assert.equal(
        (await exportEvents(production.environment.siteId, dev.serverSecret)).status,
        401,
      );

      // Even on a shared origin, a receipt from one environment fails against another.
      const staging = await addEnvironment(owners.alice, production, {
        type: "staging",
        origins: [origin],
      });
      const settings = {
        siteId: staging.environment.siteId,
        origin,
        secret: staging.serverSecret,
        sessionBinding: "host-session",
        now: new Date(time),
      };
      const bound = (await (
        await visitor(staging.environment.siteId, origin, {
          bindingContext: createBindingContext(settings),
        })
      ).json()) as CreatedSession;
      const recorded = (await (await declare(bound)).json()) as RecordedDeclaration;
      const verify = (siteId: string, secret: string) =>
        handle(
          new Request("https://collector.test/v1/verify", {
            method: "POST",
            headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
            body: JSON.stringify({
              siteId,
              origin,
              sessionBinding: "host-session",
              receipt: recorded.receipt,
            }),
          }),
        );
      assert.equal((await verify(staging.environment.siteId, staging.serverSecret)).status, 200);
      assert.equal(
        (await verify(production.environment.siteId, production.serverSecret)).status,
        401,
      );

      // Rotating one environment leaves the others untouched.
      assert.equal(
        (await owner(owners.alice, `${path(dev)}/secret`, { method: "POST" })).status,
        200,
      );
      const current = (await (await owner(owners.alice, path(production))).json()) as {
        environment: Environment;
      };
      assert.equal(current.environment.previousSecretExpiresAt, null);
      assert.equal(
        (await exportEvents(production.environment.siteId, production.serverSecret)).status,
        200,
      );
    });

    test("another customer cannot add to or reach a product's environments", async () => {
      const { owner, create, addEnvironment } = fixture(store);
      const a = await create(owners.alice, "Alice's product");
      const dev = await addEnvironment(owners.alice, a, {
        type: "dev",
        origins: ["http://localhost:3000"],
      });
      const b = await create(owners.bob, "Bob's product", ["https://bob.example"]);
      const adding = await owner(owners.bob, `/products/${a.product.id}/environments`, {
        method: "POST",
        body: JSON.stringify({ type: "staging", origins: ["https://bob.example"] }),
      });
      assert.equal(adding.status, 404);
      for (const [route, init] of [
        [`/products/${a.product.id}/environments`, {}],
        [path(dev), {}],
        [`${path(dev)}/events`, {}],
        [`${path(dev)}/domains`, {}],
        [`${path(dev)}/secret`, { method: "POST" }],
        [path(dev), { method: "PATCH", body: JSON.stringify({ name: "Taken" }) }],
        // Their own product ID doesn't unlock someone else's environment.
        [`/products/${b.product.id}/environments/${dev.environment.id}`, {}],
      ] as [string, RequestInit][]) {
        assert.equal((await owner(owners.bob, route, init)).status, 404, route);
      }
      assert.equal((await owner(owners.alice, path(dev))).status, 200);
    });

    test("rotation keeps both secrets working for 24 hours, then only the new one", async () => {
      let clock = time;
      const { handle, owner, create, visitor, declare } = fixture(store, { clock: () => clock });
      const a = await create(owners.alice, "Alice's product");
      const siteId = a.environment.siteId;
      const rotated = await owner(owners.alice, `${path(a)}/secret`, {
        method: "POST",
      });
      assert.equal(rotated.status, 200);
      const { serverSecret: next, environment } = (await rotated.json()) as {
        serverSecret: string;
        environment: { previousSecretExpiresAt: string };
      };
      assert.notEqual(next, a.serverSecret);
      assert.equal(environment.previousSecretExpiresAt, new Date(time + 86400000).toISOString());

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

      const again = await owner(owners.alice, `${path(a)}/secret`, {
        method: "POST",
      });
      assert.equal(again.status, 409);

      clock = time + 86400001;
      assert.equal(await exportWith(a.serverSecret), 401);
      assert.equal(await exportWith(next), 200);
      assert.equal(
        (await owner(owners.alice, `${path(a)}/secret`, { method: "POST" })).status,
        200,
      );
    });

    test("revoke-now ends the old secret immediately and only for the owner", async () => {
      const { handle, owner, create } = fixture(store);
      const a = await create(owners.alice, "Alice's product");
      await owner(owners.alice, `${path(a)}/secret`, { method: "POST" });
      const revokePath = `${path(a)}/secret/previous`;
      assert.equal((await owner(owners.bob, revokePath, { method: "DELETE" })).status, 404);
      assert.equal((await owner(owners.bob, `${path(a)}/secret`, { method: "POST" })).status, 404);
      const exportOld = () =>
        handle(
          new Request(`https://collector.test/v1/events?siteId=${a.environment.siteId}`, {
            headers: { authorization: `Bearer ${a.serverSecret}` },
          }),
        );
      assert.equal((await exportOld()).status, 200);
      const revoked = await owner(owners.alice, revokePath, { method: "DELETE" });
      assert.equal(
        ((await revoked.json()) as { environment: Environment }).environment
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
      const domainsPath = `${path(a)}/domains`;
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
        await visitor(a.environment.siteId, "https://www.alice.example")
      ).json()) as CreatedSession;
      assert.equal((await declare(session, "https://www.alice.example")).status, 200);

      const verify = (ownerId: string, created: Created, domain: string) =>
        owner(ownerId, `${path(created)}/domains/verify`, {
          method: "POST",
          body: JSON.stringify({ domain }),
        });
      const missing = await verify(owners.alice, a, "www.alice.example");
      assert.equal(missing.status, 422);
      assert.match(((await missing.json()) as { error: string }).error, /No matching TXT record/);
      assert.equal((await verify(owners.alice, a, "other.example")).status, 400);

      txt.set(before[0]!.record!.name, ["unrelated", before[0]!.record!.value]);
      assert.equal((await verify(owners.alice, a, "www.alice.example")).status, 200);
      assert.equal((await list())[0]!.status, "verified");

      // The same owner can reuse the domain; another owner cannot verify it.
      const second = await create(owners.alice, "Second product", ["https://www.alice.example"]);
      const reused = (await (await owner(owners.alice, `${path(second)}/domains`)).json()) as {
        domains: Domain[];
      };
      assert.equal(reused.domains[0]!.status, "verified");

      const b = await create(owners.bob, "Bob's product", ["https://www.alice.example"]);
      const theirs = (await (await owner(owners.bob, `${path(b)}/domains`)).json()) as {
        domains: Domain[];
      };
      txt.set(theirs.domains[0]!.record!.name, [theirs.domains[0]!.record!.value]);
      assert.equal((await verify(owners.bob, b, "www.alice.example")).status, 409);
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
      const stored = (await store.getEnvironmentBySiteId("ticket-management")) as EnvironmentRecord;
      assert.equal(stored.type, "production");
      assert.equal(await store.getProduct(owners.alice, stored.productId), null);
      assert.equal((await owner(owners.alice, `/products/${stored.productId}`)).status, 404);

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
      if (key === "getEnvironmentBySiteId") lookups++;
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
  const productId = randomUUID();
  await store.createProduct(
    { id: productId, ownerId: owners.alice, name: "Later", createdAt: time, updatedAt: time },
    {
      id: randomUUID(),
      productId,
      type: "production",
      name: "Production",
      siteId: "unknown",
      origins: [origin],
      secretCiphertext: cipher.seal("a-secret-long-enough-for-this-test-00000", "unknown"),
      previousSecretCiphertext: null,
      previousSecretExpiresAt: null,
      createdAt: time,
      updatedAt: time,
    },
  );
  directory.invalidate("unknown");
  assert.equal((await directory.find("unknown"))?.id, "unknown");
});
