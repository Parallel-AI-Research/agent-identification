import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { PostgresStore, postgresExecutor } from "../collector/postgres-store.js";
import { createCollector } from "../collector/index.js";
import { hashToken } from "../src/server/tokens.js";
import type { StoredSession } from "../collector/store.js";
import type { CreatedSession, RecordedDeclaration } from "../src/protocol.js";
import { createBindingContext, verifyDeclarationOnline } from "../src/server/index.js";

let db: PGlite;
let store: PostgresStore;
const time = Date.parse("2026-10-20T10:00:00Z");
function makeSession(): StoredSession {
  return {
    id: randomUUID(),
    siteId: "postgres-site",
    origin: "https://postgres.test",
    tokenHash: hashToken(randomUUID()),
    bindingHash: null,
    createdAt: time,
    expiresAt: time + 1800000,
    revokedAt: null,
    choice: null,
    receipt: null,
    eventId: null,
    requestId: null,
  };
}
function declaration(session: StoredSession, choice: "person" | "ai_assistant" = "person") {
  return {
    tokenHash: session.tokenHash,
    choice,
    requestId: randomUUID(),
    eventId: randomUUID(),
    receipt: "test-signed-receipt",
    now: time + 1000,
  };
}

before(async () => {
  db = new PGlite();
  const schema = await readFile(new URL("../collector/schema.sql", import.meta.url), "utf8");
  const migration = await readFile(
    new URL(
      "../supabase/migrations/20261020093721_create_agent_identification_collector.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert(migration.startsWith(schema), "Deployment migration must use the tested collector schema");
  await db.exec(migration);
  store = new PostgresStore(
    async (sql, parameters) => (await db.query<Record<string, unknown>>(sql, parameters)).rows,
  );
});
beforeEach(async () => {
  await db.exec(
    "truncate agent_identification.sessions cascade; truncate agent_identification.rate_buckets",
  );
});
after(async () => {
  await db?.close();
});

test("postgres adapter passes values separately, including SQL-looking data", async () => {
  let observed: unknown;
  const execute = postgresExecutor({
    unsafe: async (query, parameters) => {
      observed = { query, parameters };
      return [{ ok: true }];
    },
  });
  assert.deepEqual(await execute("select $1", ["';drop table users;--"]), [{ ok: true }]);
  assert.deepEqual(observed, { query: "select $1", parameters: ["';drop table users;--"] });
});

test("Postgres persists only token hashes, declares atomically and returns one event across retries", async () => {
  const s = makeSession();
  await store.createSession(s);
  assert.deepEqual(await store.getSession(s.tokenHash), s);
  assert.deepEqual(await store.getSessionById(s.id), s);
  const input = declaration(s);
  const results = await Promise.all(
    Array.from({ length: 6 }, () => store.recordDeclaration(input)),
  );
  assert(results.every((result) => result.status === "recorded"));
  assert.equal((await store.listEvents(s.siteId, 100)).length, 1);
  assert.equal((await store.getSession(s.tokenHash))?.eventId, input.eventId);
  assert.equal((await store.recordDeclaration(declaration(s, "ai_assistant"))).status, "conflict");
  assert.equal(await store.getSession("0".repeat(64)), null);
});

test("competing PostgreSQL declarations resolve to a single accepted choice", async () => {
  const s = makeSession();
  await store.createSession(s);
  const results = await Promise.all([
    store.recordDeclaration(declaration(s, "person")),
    store.recordDeclaration(declaration(s, "ai_assistant")),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), ["conflict", "recorded"]);
  assert.equal((await store.listEvents(s.siteId, 100)).length, 1);
});

test("event insertion failure rolls back the declaration in the same SQL statement", async () => {
  const first = makeSession();
  const second = makeSession();
  await store.createSession(first);
  await store.createSession(second);
  const recorded = declaration(first);
  await store.recordDeclaration(recorded);
  await assert.rejects(
    store.recordDeclaration({ ...declaration(second), eventId: recorded.eventId }),
  );
  assert.equal((await store.getSession(second.tokenHash))?.choice, null);
  assert.equal((await store.listEvents(first.siteId, 100)).length, 1);
});

test("revoked/expired Postgres sessions reject writes and evidence remains until bounded retention pruning", async () => {
  const s = makeSession();
  await store.createSession(s);
  await store.recordDeclaration(declaration(s));
  await store.revokeSession(s.tokenHash, time + 5000);
  await store.revokeSession(s.tokenHash, time + 6000);
  assert.equal((await store.getSession(s.tokenHash))?.revokedAt, time + 5000);
  assert.equal((await store.recordDeclaration(declaration(s))).status, "invalid");
  const expired = makeSession();
  await store.createSession(expired);
  assert.equal(
    (await store.recordDeclaration({ ...declaration(expired), now: expired.expiresAt })).status,
    "invalid",
  );
  assert.equal((await store.listEvents(s.siteId, 100)).length, 1);
  assert.equal((await store.prune(time + 1, time + 8 * 86400000, 1)).removedSessions, 1);
  assert.equal((await store.prune(time + 1, time + 8 * 86400000, 1)).removedSessions, 1);
  assert.equal((await store.listEvents(s.siteId, 100)).length, 0);
});

test("Postgres rate counters enforce limits atomically and expire", async () => {
  const key = hashToken("ip-derived-hmac-fixture");
  const results = await Promise.all(
    Array.from({ length: 10 }, () => store.consumeRate(key, 3, 1000, time)),
  );
  assert.equal(results.filter(Boolean).length, 3);
  assert.equal(await store.consumeRate(key, 3, 1000, time + 1000), true);
  await store.prune(time - 1000, time + 2000, 100);
  assert.equal(
    (await db.query<{ count: string }>("select count(*) from agent_identification.rate_buckets"))
      .rows[0]?.count,
    0,
  );
});

test("Postgres pruning drains rate buckets independently of retained sessions", async () => {
  await db.query(
    `insert into agent_identification.rate_buckets (key_hash, count, expires_at)
     select repeat(md5(i::text),2), 1, $1 from generate_series(1,1500) as i`,
    [time - 1000],
  );
  const pruneSecret = "test-prune-secret-012345678901234567890";
  const handler = createCollector({
    sites: [
      {
        id: "rates",
        origins: ["https://rates.test"],
        secret: "test-site-secret-012345678901234567890",
      },
    ],
    store,
    pruneSecret,
    now: () => new Date(time),
  });
  const response = await handler(
    new Request("https://collector.test/internal/prune", {
      method: "POST",
      headers: { authorization: `Bearer ${pruneSecret}` },
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    removedSessions: 0,
    removedRateBuckets: 1500,
    more: false,
  });
  assert.equal(
    (await db.query<{ count: number }>("select count(*) from agent_identification.rate_buckets"))
      .rows[0]?.count,
    0,
  );
});

test("Postgres health checks use the actual database and detect missing storage", async () => {
  await store.checkHealth();
  await db.exec(
    "alter table agent_identification.rate_buckets rename to temporarily_missing_rates",
  );
  try {
    await assert.rejects(store.checkHealth(), /does not exist/i);
  } finally {
    await db.exec(
      "alter table agent_identification.temporarily_missing_rates rename to rate_buckets",
    );
  }
});

test("private tables enable forced RLS and a role with SELECT grants still cannot read rows", async () => {
  await store.createSession(makeSession());
  const flags = await db.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
    "select relrowsecurity, relforcerowsecurity from pg_class where oid in ('agent_identification.sessions'::regclass, 'agent_identification.events'::regclass, 'agent_identification.rate_buckets'::regclass)",
  );
  assert.equal(flags.rows.length, 3);
  assert(flags.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity));
  await db.exec(
    "create role untrusted_collector_probe; grant usage on schema agent_identification to untrusted_collector_probe; grant select on agent_identification.sessions to untrusted_collector_probe; set role untrusted_collector_probe",
  );
  try {
    assert.equal((await db.query("select * from agent_identification.sessions")).rows.length, 0);
  } finally {
    await db.exec("reset role");
  }
});

test("dedicated collector role can run the complete storage lifecycle but cannot escalate or access other schemas", async () => {
  await db.exec(
    "create schema unrelated_private; create table unrelated_private.sensitive (secret text); insert into unrelated_private.sensitive values ('unrelated-secret')",
  );
  const privileges = await db.query<Record<string, boolean>>(
    "select rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit, rolcanlogin from pg_roles where rolname='agent_id_app'",
  );
  assert(Object.values(privileges.rows[0]!).every((enabled) => enabled === false));
  await db.exec("set role agent_id_app");
  try {
    await store.checkHealth();
    const session = makeSession();
    await store.createSession(session);
    assert.equal((await store.getSession(session.tokenHash))?.id, session.id);
    assert.equal((await store.recordDeclaration(declaration(session))).status, "recorded");
    assert.equal((await store.listEvents(session.siteId, 100)).length, 1);
    await store.revokeSession(session.tokenHash, time + 1000);
    assert.equal(await store.consumeRate(hashToken("role-rate"), 2, 1000, time), true);
    assert.equal((await store.prune(time + 1, time + 2000, 100)).removedSessions, 1);
    assert.equal((await store.listEvents(session.siteId, 100)).length, 0);
    for (const forbidden of [
      "select * from unrelated_private.sensitive",
      "create table agent_identification.unexpected (id int)",
      "create schema collector_forbidden",
      "create role collector_escalated superuser",
      "alter table agent_identification.sessions disable row level security",
      "update agent_identification.sessions set origin='https://attacker.test'",
      "update agent_identification.events set choice='person'",
    ]) {
      await assert.rejects(db.exec(forbidden), /permission denied|must be owner/i);
    }
  } finally {
    await db.exec("reset role");
  }
});

test("HTTP lifecycle and online verification work against the SQL store, including revoked receipts", async () => {
  const site = {
    id: "postgres-site",
    origins: ["https://postgres.test"],
    secret: "test-only-postgres-site-secret-0123456789",
  };
  const handle = createCollector({
    sites: [site],
    store,
    production: true,
    now: () => new Date(time),
  });
  const expected = {
    siteId: site.id,
    origin: site.origins[0]!,
    secret: site.secret,
    sessionBinding: "host-login-7",
    now: new Date(time),
  };
  const creation = await handle(
    new Request("https://collector.test/v1/sessions", {
      method: "POST",
      headers: { origin: expected.origin, "content-type": "application/json" },
      body: JSON.stringify({ siteId: site.id, bindingContext: createBindingContext(expected) }),
    }),
  );
  assert.equal(creation.status, 201);
  const session = (await creation.json()) as CreatedSession;
  const headers = {
    origin: expected.origin,
    authorization: `Bearer ${session.sessionToken}`,
    "x-agent-site": site.id,
    "content-type": "application/json",
  };
  const response = await handle(
    new Request("https://collector.test/v1/declarations", {
      method: "POST",
      headers,
      body: JSON.stringify({ choice: "prefer_not_to_say", requestId: randomUUID() }),
    }),
  );
  assert.equal(response.status, 200);
  const accepted = (await response.json()) as RecordedDeclaration;
  const options = {
    ...expected,
    apiUrl: "https://collector.test",
    fetch: ((url: RequestInfo | URL, init?: RequestInit) =>
      handle(new Request(url, init))) as typeof fetch,
  };
  assert.equal(
    (await verifyDeclarationOnline(accepted.receipt, options)).choice,
    "prefer_not_to_say",
  );
  await handle(
    new Request("https://collector.test/v1/sessions/current", { method: "DELETE", headers }),
  );
  await assert.rejects(verifyDeclarationOnline(accepted.receipt, options));
});
