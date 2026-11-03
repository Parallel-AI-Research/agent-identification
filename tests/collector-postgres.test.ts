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
    signingSecretHash: null,
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
    agent: { name: null, provider: null, purpose: null },
    now: time + 1000,
  };
}
const cutoff = (at: number) => ({ sessions: at, activity: at });

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
  await db.exec(
    await readFile(
      new URL("../supabase/migrations/20261101120000_add_customer_products.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL("../supabase/migrations/20261101130000_add_domain_claims.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL("../supabase/migrations/20261101140000_add_environments.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL("../supabase/migrations/20261102120000_add_install_activity.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL("../supabase/migrations/20261102130000_add_activity_events.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL("../supabase/migrations/20261102140000_add_signature_events.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20261102150000_add_session_binding_index.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL("../supabase/migrations/20261102160000_add_signal_events.sql", import.meta.url),
      "utf8",
    ),
  );
  store = new PostgresStore(
    async (sql, parameters) => (await db.query<Record<string, unknown>>(sql, parameters)).rows,
  );
});
beforeEach(async () => {
  await db.exec(
    "truncate agent_identification.sessions cascade; truncate agent_identification.rate_buckets; truncate agent_identification.activity_events",
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
  assert.equal((await store.prune(cutoff(time + 1), time + 8 * 86400000, 1)).removedSessions, 1);
  assert.equal((await store.prune(cutoff(time + 1), time + 8 * 86400000, 1)).removedSessions, 1);
  assert.equal((await store.listEvents(s.siteId, 100)).length, 0);
});

test("Postgres rate counters enforce limits atomically and expire", async () => {
  const key = hashToken("ip-derived-hmac-fixture");
  const results = await Promise.all(
    Array.from({ length: 10 }, () => store.consumeRate(key, 3, 1000, time)),
  );
  assert.equal(results.filter(Boolean).length, 3);
  assert.equal(await store.consumeRate(key, 3, 1000, time + 1000), true);
  await store.prune(cutoff(time - 1000), time + 2000, 100);
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
    removedActivity: 0,
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
    "select relrowsecurity, relforcerowsecurity from pg_class where oid in ('agent_identification.sessions'::regclass, 'agent_identification.events'::regclass, 'agent_identification.rate_buckets'::regclass, 'agent_identification.activity_events'::regclass)",
  );
  assert.equal(flags.rows.length, 4);
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
    assert.equal((await store.prune(cutoff(time + 1), time + 2000, 100)).removedSessions, 1);
    assert.equal((await store.listEvents(session.siteId, 100)).length, 0);
    for (const forbidden of [
      "select * from unrelated_private.sensitive",
      "create table agent_identification.unexpected (id int)",
      "create schema collector_forbidden",
      "create role collector_escalated superuser",
      "alter table agent_identification.sessions disable row level security",
      "update agent_identification.sessions set origin='https://attacker.test'",
      "update agent_identification.events set choice='person'",
      "update agent_identification.activity_events set choice='person'",
    ]) {
      await assert.rejects(db.exec(forbidden), /permission denied|must be owner/i);
    }
  } finally {
    await db.exec("reset role");
  }
});

const migration = (file: string) =>
  readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");

test("the activity table refuses events that break the contract, without the collector's checks", async () => {
  const valid = {
    site_id: "postgres-site",
    id: randomUUID(),
    type: "page_view",
    source: "browser",
    evidence: "browser_reported",
    origin: "https://postgres.test",
    occurred_at: time,
    received_at: time,
    path: "/pricing",
  };
  const insert = async (row: Record<string, unknown>) => {
    const columns = Object.keys(row);
    await db.query(
      `insert into agent_identification.activity_events (${columns.join(", ")})
       values (${columns.map((_, index) => `$${index + 1}`).join(", ")})`,
      Object.values(row),
    );
  };
  await insert(valid);
  const action = {
    ...valid,
    type: "action",
    source: "server",
    evidence: "host_reported",
    origin: null,
    path: null,
    action: "ticket.update",
    outcome: "attempted",
  };
  await insert({ ...action, id: randomUUID() });
  for (const broken of [
    { ...valid },
    { ...valid, id: randomUUID(), choice: "person" },
    { ...valid, id: randomUUID(), path: "pricing" },
    { ...valid, id: randomUUID(), evidence: "self_reported" },
    { ...valid, id: randomUUID(), origin: null },
    { ...action, id: randomUUID(), account_ref: "alice@example.com" },
    { ...action, id: randomUUID(), outcome: "succeeded" },
    { ...action, id: randomUUID(), origin: "https://postgres.test" },
    { ...valid, id: randomUUID(), signer: "Test agent" },
  ]) {
    await assert.rejects(insert(broken));
  }
  const signature = {
    ...valid,
    type: "signature",
    source: "server",
    evidence: "signature_verified",
    origin: null,
    signer: "Test agent",
    signature_agent: "https://agent.test",
    signature_result: "verified",
  };
  await insert({ ...signature, id: randomUUID() });
  for (const broken of [
    { ...signature, id: randomUUID(), signer: null },
    { ...signature, id: randomUUID(), signature_result: "expired" },
    { ...signature, id: randomUUID(), evidence: "signature_claimed" },
    { ...signature, id: randomUUID(), evidence: "cdn_reported" },
    { ...signature, id: randomUUID(), verifier: "akamai" },
    { ...signature, id: randomUUID(), signature_result: null },
    { ...signature, id: randomUUID(), signature_agent: "ftp://agent.test" },
    { ...signature, id: randomUUID(), signal: "webdriver" },
  ]) {
    await assert.rejects(insert(broken));
  }
  const signal = {
    ...valid,
    type: "signal",
    path: null,
    signal: "webdriver",
    signal_detail: "navigator.webdriver",
  };
  await insert({ ...signal, id: randomUUID() });
  for (const broken of [
    { ...signal, id: randomUUID(), signal: "agent_user_agent" },
    { ...signal, id: randomUUID(), signal: null },
    { ...signal, id: randomUUID(), source: "server", evidence: "host_reported" },
    { ...signal, id: randomUUID(), choice: "person" },
    { ...signal, id: randomUUID(), signal_detail: "x".repeat(101) },
  ]) {
    await assert.rejects(insert(broken));
  }
});

test("declarations recorded before the activity table join the timeline when it's added", async () => {
  const earlier = new PGlite();
  try {
    for (const file of [
      "20261020093721_create_agent_identification_collector.sql",
      "20261101120000_add_customer_products.sql",
      "20261101130000_add_domain_claims.sql",
      "20261101140000_add_environments.sql",
      "20261102120000_add_install_activity.sql",
    ]) {
      await earlier.exec(await migration(file));
    }
    const execute = async (sql: string, parameters: unknown[]) =>
      (await earlier.query<Record<string, unknown>>(sql, parameters)).rows;
    const s = makeSession();
    await new PostgresStore(execute).createSession(s);
    const eventId = randomUUID();
    await execute(
      `insert into agent_identification.events (id, site_id, origin, session_id, choice, created_at)
       values ($1, $2, $3, $4, 'person', $5)`,
      [eventId, s.siteId, s.origin, s.id, time],
    );
    await earlier.exec(await migration("20261102130000_add_activity_events.sql"));
    await earlier.exec(await migration("20261102140000_add_signature_events.sql"));
    await earlier.exec(await migration("20261102160000_add_signal_events.sql"));
    const at = new Date(time).toISOString();
    assert.deepEqual(await new PostgresStore(execute).listActivity(s.siteId, { limit: 10 }), [
      {
        id: eventId,
        siteId: s.siteId,
        sessionId: s.id,
        origin: s.origin,
        type: "declaration",
        source: "browser",
        evidence: "self_reported",
        occurredAt: at,
        receivedAt: at,
        accountRef: null,
        choice: "person",
        agent: { name: null, provider: null, purpose: null },
      },
    ]);
  } finally {
    await earlier.close();
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
