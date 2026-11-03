import {
  INSTALL_REFUSALS,
  MAX_INSTALL_ORIGINS,
  type CollectorStore,
  type DeclarationInput,
  type DeclarationResult,
  type InstallActivity,
  type InstallSignal,
  type ActivityQuery,
  type PruneCutoffs,
  type PruneResult,
  type StoredEvent,
  type StoredSession,
} from "./store.js";
import type {
  ActivityEvent,
  Choice,
  EventSource,
  Evidence,
  Outcome,
  SignatureEvent,
  SignatureResult,
} from "../src/protocol.js";
import { assertActivity, sameActivity, type ActivityResult } from "./activity.js";
import type {
  DomainClaim,
  EnvironmentChanges,
  EnvironmentRecord,
  EnvironmentType,
  ProductRecord,
  ProductStore,
  ProductWithEnvironments,
  SecretRotation,
} from "./products.js";

/** Works with postgres.js, a Postgres pool, or PGlite without interpolating values. */
export type QueryExecutor = (
  text: string,
  parameters: unknown[],
) => Promise<Record<string, unknown>[]>;

export function postgresExecutor(sql: {
  unsafe: (query: string, parameters?: never[]) => PromiseLike<Record<string, unknown>[]>;
}): QueryExecutor {
  return async (text, parameters) => [...(await sql.unsafe(text, parameters as never[]))];
}

function session(row: Record<string, unknown>): StoredSession {
  return {
    id: String(row.id),
    siteId: String(row.site_id),
    origin: String(row.origin),
    tokenHash: String(row.token_hash),
    bindingHash: row.binding_hash === null ? null : String(row.binding_hash),
    signingSecretHash: (row.signing_secret_hash ?? null) as string | null,
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
    choice: row.choice as Choice | null,
    receipt: row.receipt as string | null,
    eventId: row.event_id as string | null,
    requestId: row.request_id as string | null,
  };
}

function product(row: Record<string, unknown>): ProductRecord {
  return {
    id: String(row.id),
    ownerId: row.owner_id === null ? null : String(row.owner_id),
    name: String(row.name),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}
function environment(row: Record<string, unknown>): EnvironmentRecord {
  // Drivers differ on whether a jsonb column arrives parsed.
  const origins = typeof row.origins === "string" ? JSON.parse(row.origins) : row.origins;
  return {
    id: String(row.id),
    productId: String(row.product_id),
    type: row.type as EnvironmentType,
    name: String(row.name),
    siteId: String(row.site_id),
    origins: origins as string[],
    secretCiphertext: String(row.secret_ciphertext),
    previousSecretCiphertext: row.previous_secret_ciphertext as string | null,
    previousSecretExpiresAt:
      row.previous_secret_expires_at === null ? null : Number(row.previous_secret_expires_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}
const text = (value: unknown) => (value === null ? null : String(value));
function activity(row: Record<string, unknown>): ActivityEvent {
  const base = {
    id: String(row.id),
    siteId: String(row.site_id),
    sessionId: text(row.session_id),
    origin: text(row.origin),
    occurredAt: new Date(Number(row.occurred_at)).toISOString(),
    receivedAt: new Date(Number(row.received_at)).toISOString(),
    accountRef: text(row.account_ref),
    source: row.source as EventSource,
    evidence: row.evidence as Evidence,
  };
  switch (row.type) {
    case "declaration":
      return {
        ...base,
        type: "declaration",
        source: "browser",
        evidence: "self_reported",
        choice: row.choice as Choice,
        agent: {
          name: text(row.agent_name),
          provider: text(row.agent_provider),
          purpose: text(row.agent_purpose),
        },
      };
    case "signature":
      return {
        ...base,
        type: "signature",
        source: "server",
        evidence: row.evidence as SignatureEvent["evidence"],
        signer: text(row.signer),
        signatureAgent: text(row.signature_agent),
        result: row.signature_result as SignatureResult,
        verifier: text(row.verifier),
        path: text(row.path),
      };
    case "page_view":
      return {
        ...base,
        type: "page_view",
        source: "browser",
        evidence: "browser_reported",
        path: String(row.path),
        route: text(row.route),
      };
    default:
      return {
        ...base,
        type: "action",
        source: "server",
        evidence: "host_reported",
        action: String(row.action),
        resourceRef: text(row.resource_ref),
        outcome: row.outcome as Outcome,
      };
  }
}
const ACTIVITY_COLUMNS = `site_id, id, session_id, type, source, evidence, origin, occurred_at,
  received_at, account_ref, choice, agent_name, agent_provider, agent_purpose, path, route,
  action, resource_ref, outcome, signer, signature_agent, signature_result, verifier`;

const ENVIRONMENT_COLUMNS = `e.*, coalesce((
  select jsonb_agg(o.origin order by o.origin)
  from agent_identification.environment_origins o where o.environment_id = e.id
), '[]'::jsonb) as origins`;
const OWNED_ENVIRONMENTS = `agent_identification.environments e
  join agent_identification.products p on p.id = e.product_id`;
const ENVIRONMENT_ORDER = `array_position(array['production','beta','staging','dev'], e.type)`;

export class PostgresStore implements CollectorStore, ProductStore {
  readonly kind = "postgres" as const;
  constructor(private execute: QueryExecutor) {}

  async checkHealth(): Promise<void> {
    // Check the connection, relations and runtime read permissions without
    // reading or returning visitor records.
    await this.execute(
      `select 1 from agent_identification.sessions,
       agent_identification.events, agent_identification.rate_buckets,
       agent_identification.products, agent_identification.environments,
       agent_identification.environment_origins, agent_identification.domain_claims,
       agent_identification.install_activity, agent_identification.activity_events limit 0`,
      [],
    );
  }

  async createProduct(p: ProductRecord, e: EnvironmentRecord): Promise<void> {
    // One statement, so a product can never exist without a production environment.
    await this.execute(
      `with created as (
         insert into agent_identification.products (id, owner_id, name, created_at, updated_at)
         values ($1,$2,$3,$4,$5) returning id
       ), environment as (
         insert into agent_identification.environments
         (id, product_id, type, name, site_id, secret_ciphertext, previous_secret_ciphertext,
          previous_secret_expires_at, created_at, updated_at)
         select $6, created.id, $7, $8, $9, $10, $11, $12, $4, $5 from created
         returning id
       )
       insert into agent_identification.environment_origins (environment_id, origin)
       select environment.id, value
       from environment, jsonb_array_elements_text($13::text::jsonb) as value`,
      [
        p.id,
        p.ownerId,
        p.name,
        p.createdAt,
        p.updatedAt,
        e.id,
        e.type,
        e.name,
        e.siteId,
        e.secretCiphertext,
        e.previousSecretCiphertext,
        e.previousSecretExpiresAt,
        JSON.stringify(e.origins),
      ],
    );
  }
  async countProducts(ownerId: string): Promise<number> {
    const rows = await this.execute(
      "select count(*) as total from agent_identification.products where owner_id=$1",
      [ownerId],
    );
    return Number(rows[0]?.total);
  }
  async listProducts(ownerId: string): Promise<ProductWithEnvironments[]> {
    const products = await this.execute(
      `select * from agent_identification.products
       where owner_id=$1 order by created_at desc, id desc`,
      [ownerId],
    );
    const environments = await this.execute(
      `select ${ENVIRONMENT_COLUMNS} from ${OWNED_ENVIRONMENTS}
       where p.owner_id=$1 order by ${ENVIRONMENT_ORDER}`,
      [ownerId],
    );
    const rows = environments.map(environment);
    return products.map((row) => ({
      ...product(row),
      environments: rows.filter((item) => item.productId === String(row.id)),
    }));
  }
  async getProduct(ownerId: string, id: string): Promise<ProductWithEnvironments | null> {
    const products = await this.execute(
      "select * from agent_identification.products where owner_id=$1 and id=$2",
      [ownerId, id],
    );
    if (!products[0]) return null;
    const environments = await this.execute(
      `select ${ENVIRONMENT_COLUMNS} from ${OWNED_ENVIRONMENTS}
       where p.owner_id=$1 and e.product_id=$2 order by ${ENVIRONMENT_ORDER}`,
      [ownerId, id],
    );
    return { ...product(products[0]), environments: environments.map(environment) };
  }
  async renameProduct(
    ownerId: string,
    id: string,
    name: string,
    now: number,
  ): Promise<ProductWithEnvironments | null> {
    const rows = await this.execute(
      `update agent_identification.products set name=$3, updated_at=$4
       where owner_id=$1 and id=$2 returning id`,
      [ownerId, id, name, now],
    );
    return rows[0] ? this.getProduct(ownerId, id) : null;
  }
  async createEnvironment(ownerId: string, e: EnvironmentRecord): Promise<boolean> {
    const rows = await this.execute(
      `with allowed as (
         select id from agent_identification.products where owner_id=$1 and id=$2
       ), created as (
         insert into agent_identification.environments
         (id, product_id, type, name, site_id, secret_ciphertext, created_at, updated_at)
         select $3, allowed.id, $4, $5, $6, $7, $8, $9 from allowed
         on conflict (product_id, type) do nothing
         returning id
       ), origins as (
         insert into agent_identification.environment_origins (environment_id, origin)
         select created.id, value
         from created, jsonb_array_elements_text($10::text::jsonb) as value
       )
       select id from created`,
      [
        ownerId,
        e.productId,
        e.id,
        e.type,
        e.name,
        e.siteId,
        e.secretCiphertext,
        e.createdAt,
        e.updatedAt,
        JSON.stringify(e.origins),
      ],
    );
    return rows.length > 0;
  }
  private async readEnvironment(
    ownerId: string,
    productId: string,
    id: string,
  ): Promise<EnvironmentRecord | null> {
    const rows = await this.execute(
      `select ${ENVIRONMENT_COLUMNS} from ${OWNED_ENVIRONMENTS}
       where p.owner_id=$1 and e.product_id=$2 and e.id=$3`,
      [ownerId, productId, id],
    );
    return rows[0] ? environment(rows[0]) : null;
  }
  async updateEnvironment(
    ownerId: string,
    productId: string,
    id: string,
    changes: EnvironmentChanges,
  ): Promise<EnvironmentRecord | null> {
    const origins = changes.origins === undefined ? null : JSON.stringify(changes.origins);
    const rows = await this.execute(
      `with target as (
         update agent_identification.environments e
         set name=coalesce($4,e.name), updated_at=$5
         from agent_identification.products p
         where p.id=e.product_id and p.owner_id=$1 and e.product_id=$2 and e.id=$3
         returning e.id
       ), removed as (
         delete from agent_identification.environment_origins
         where $6::text::jsonb is not null and environment_id in (select id from target)
           and origin not in (select jsonb_array_elements_text($6::text::jsonb))
       ), added as (
         insert into agent_identification.environment_origins (environment_id, origin)
         select target.id, value from target, jsonb_array_elements_text($6::text::jsonb) as value
         on conflict do nothing
       )
       select id from target`,
      [ownerId, productId, id, changes.name ?? null, changes.now, origins],
    );
    return rows[0] ? this.readEnvironment(ownerId, productId, id) : null;
  }
  async rotateSecret(
    ownerId: string,
    productId: string,
    id: string,
    rotation: SecretRotation,
  ): Promise<EnvironmentRecord | null> {
    const rows = await this.execute(
      `update agent_identification.environments e
       set previous_secret_ciphertext=e.secret_ciphertext, previous_secret_expires_at=$4,
           secret_ciphertext=$5, updated_at=$6
       from agent_identification.products p
       where p.id=e.product_id and p.owner_id=$1 and e.product_id=$2 and e.id=$3
         and e.secret_ciphertext=$7
       returning e.id`,
      [
        ownerId,
        productId,
        id,
        rotation.previousSecretExpiresAt,
        rotation.secretCiphertext,
        rotation.now,
        rotation.expectedCiphertext,
      ],
    );
    return rows[0] ? this.readEnvironment(ownerId, productId, id) : null;
  }
  async revokePreviousSecret(
    ownerId: string,
    productId: string,
    id: string,
    now: number,
  ): Promise<EnvironmentRecord | null> {
    const rows = await this.execute(
      `update agent_identification.environments e
       set previous_secret_ciphertext=null, previous_secret_expires_at=null, updated_at=$4
       from agent_identification.products p
       where p.id=e.product_id and p.owner_id=$1 and e.product_id=$2 and e.id=$3
       returning e.id`,
      [ownerId, productId, id, now],
    );
    return rows[0] ? this.readEnvironment(ownerId, productId, id) : null;
  }
  async claimDomains(
    ownerId: string,
    claims: { domain: string; token: string }[],
    now: number,
  ): Promise<DomainClaim[]> {
    if (!claims.length) return [];
    await this.execute(
      `insert into agent_identification.domain_claims (owner_id, domain, token, created_at)
       select $1, claim->>'domain', claim->>'token', $3
       from jsonb_array_elements($2::text::jsonb) as claim
       on conflict (owner_id, domain) do nothing`,
      [ownerId, JSON.stringify(claims), now],
    );
    const rows = await this.execute(
      `select domain, token, verified_at from agent_identification.domain_claims
       where owner_id=$1 and domain in (
         select claim->>'domain' from jsonb_array_elements($2::text::jsonb) as claim
       ) order by domain`,
      [ownerId, JSON.stringify(claims)],
    );
    return rows.map((row) => ({
      domain: String(row.domain),
      token: String(row.token),
      verifiedAt: row.verified_at === null ? null : Number(row.verified_at),
    }));
  }
  async markDomainVerified(ownerId: string, domain: string, now: number): Promise<boolean> {
    try {
      await this.execute(
        `update agent_identification.domain_claims set verified_at=$3
         where owner_id=$1 and domain=$2 and verified_at is null`,
        [ownerId, domain, now],
      );
      return true;
    } catch (error) {
      // The partial unique index is what guarantees one verified owner per domain.
      if ((error as { code?: string }).code === "23505") return false;
      throw error;
    }
  }
  async getEnvironmentBySiteId(siteId: string): Promise<EnvironmentRecord | null> {
    const rows = await this.execute(
      `select ${ENVIRONMENT_COLUMNS} from agent_identification.environments e where e.site_id=$1`,
      [siteId],
    );
    return rows[0] ? environment(rows[0]) : null;
  }
  async isRegisteredOrigin(origin: string): Promise<boolean> {
    const rows = await this.execute(
      "select 1 from agent_identification.environment_origins where origin=$1 limit 1",
      [origin],
    );
    return rows.length > 0;
  }

  async createSession(s: StoredSession): Promise<void> {
    await this.execute(
      `insert into agent_identification.sessions
       (id, site_id, origin, token_hash, binding_hash, signing_secret_hash, created_at, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        s.id,
        s.siteId,
        s.origin,
        s.tokenHash,
        s.bindingHash,
        s.signingSecretHash,
        s.createdAt,
        s.expiresAt,
      ],
    );
  }
  async getSession(hash: string): Promise<StoredSession | null> {
    const rows = await this.execute(
      "select * from agent_identification.sessions where token_hash=$1",
      [hash],
    );
    return rows[0] ? session(rows[0]) : null;
  }
  async getSessionById(id: string): Promise<StoredSession | null> {
    const rows = await this.execute("select * from agent_identification.sessions where id=$1", [
      id,
    ]);
    return rows[0] ? session(rows[0]) : null;
  }
  async findSessionByBinding(siteId: string, bindingHash: string): Promise<string | null> {
    const rows = await this.execute(
      `select id from agent_identification.sessions
       where site_id=$1 and binding_hash=$2
       order by (revoked_at is null) desc, created_at desc, id desc limit 1`,
      [siteId, bindingHash],
    );
    return rows[0] ? String(rows[0].id) : null;
  }
  async recordDeclaration(input: DeclarationInput): Promise<DeclarationResult> {
    // The row lock and both event insertions occur atomically in one statement.
    // A concurrent winner causes UPDATE's predicate to be rechecked by Postgres.
    const rows = await this.execute(
      `with changed as (
         update agent_identification.sessions
         set choice=$2, request_id=$3, event_id=$4, receipt=$5
         where token_hash=$1 and choice is null and revoked_at is null and expires_at>$6
         returning *
       ), logged as (
         insert into agent_identification.events (id, site_id, origin, session_id, choice, created_at)
         select event_id, site_id, origin, id, choice, $6 from changed returning id
       ), timeline as (
         insert into agent_identification.activity_events
           (site_id, id, session_id, type, source, evidence, origin, occurred_at, received_at,
            choice, agent_name, agent_provider, agent_purpose)
         select site_id, event_id, id, 'declaration', 'browser', 'self_reported', origin, $6, $6,
           choice, $7, $8, $9 from changed returning id
       )
       select changed.* from changed
       cross join (select count(*) from logged) as inserted
       cross join (select count(*) from timeline) as appended`,
      [
        input.tokenHash,
        input.choice,
        input.requestId,
        input.eventId,
        input.receipt,
        input.now,
        input.agent.name,
        input.agent.provider,
        input.agent.purpose,
      ],
    );
    if (rows[0]) return { status: "recorded", session: session(rows[0]) };
    const current = await this.getSession(input.tokenHash);
    if (!current || current.revokedAt !== null || current.expiresAt <= input.now) {
      return { status: "invalid" };
    }
    if (current.choice !== input.choice) return { status: "conflict" };
    return { status: "recorded", session: current };
  }
  async revokeSession(hash: string, now: number): Promise<void> {
    await this.execute(
      `update agent_identification.sessions set revoked_at=$2
       where token_hash=$1 and revoked_at is null`,
      [hash, now],
    );
  }
  async listEvents(siteId: string, limit: number): Promise<StoredEvent[]> {
    const rows = await this.execute(
      `select id, site_id, origin, session_id, choice, created_at
       from agent_identification.events where site_id=$1
       order by created_at desc, id desc limit $2`,
      [siteId, limit],
    );
    return rows.map((row) => ({
      id: String(row.id),
      siteId: String(row.site_id),
      origin: String(row.origin),
      sessionId: String(row.session_id),
      choice: row.choice as Choice,
      evidence: "self_reported",
      createdAt: new Date(Number(row.created_at)).toISOString(),
    }));
  }
  async recordActivity(event: ActivityEvent): Promise<ActivityResult> {
    assertActivity(event);
    const declaration = event.type === "declaration" ? event : null;
    const pageView = event.type === "page_view" ? event : null;
    const action = event.type === "action" ? event : null;
    const signed = event.type === "signature" ? event : null;
    const inserted = await this.execute(
      `insert into agent_identification.activity_events (${ACTIVITY_COLUMNS})
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
       on conflict (site_id, id) do nothing
       returning ${ACTIVITY_COLUMNS}`,
      [
        event.siteId,
        event.id,
        event.sessionId,
        event.type,
        event.source,
        event.evidence,
        event.origin,
        Date.parse(event.occurredAt),
        Date.parse(event.receivedAt),
        event.accountRef,
        declaration?.choice ?? null,
        declaration?.agent.name ?? null,
        declaration?.agent.provider ?? null,
        declaration?.agent.purpose ?? null,
        pageView?.path ?? signed?.path ?? null,
        pageView?.route ?? null,
        action?.action ?? null,
        action?.resourceRef ?? null,
        action?.outcome ?? null,
        signed?.signer ?? null,
        signed?.signatureAgent ?? null,
        signed?.result ?? null,
        signed?.verifier ?? null,
      ],
    );
    if (inserted[0]) return { status: "recorded", event: activity(inserted[0]) };
    const [existing] = await this.execute(
      `select ${ACTIVITY_COLUMNS} from agent_identification.activity_events
       where site_id=$1 and id=$2`,
      [event.siteId, event.id],
    );
    // Pruned between the insert and this read, a retry no longer has anything to match.
    if (!existing) return { status: "conflict" };
    const stored = activity(existing);
    return sameActivity(stored, event)
      ? { status: "duplicate", event: stored }
      : { status: "conflict" };
  }
  async listActivity(siteId: string, options: ActivityQuery): Promise<ActivityEvent[]> {
    const rows = await this.execute(
      `select ${ACTIVITY_COLUMNS} from agent_identification.activity_events
       where site_id=$1 and ($2::uuid is null or session_id=$2::uuid)
         and ($3::text is null or type=$3::text)
         and ($4::bigint is null or received_at>=$4::bigint)
         and ($5::bigint is null or received_at<$5::bigint)
       order by received_at desc, id desc limit $6`,
      [
        siteId,
        options.sessionId ?? null,
        options.type ?? null,
        options.from ?? null,
        options.to ?? null,
        options.limit,
      ],
    );
    return rows.map(activity);
  }
  async consumeRate(key: string, limit: number, windowMs: number, now: number): Promise<boolean> {
    const rows = await this.execute(
      `insert into agent_identification.rate_buckets as existing (key_hash, count, expires_at)
       values ($1,1,$3)
       on conflict (key_hash) do update set
         count = case when existing.expires_at <= $2 then 1 else existing.count+1 end,
         expires_at = case when existing.expires_at <= $2 then $3 else existing.expires_at end
       returning count`,
      [key, now, now + windowMs],
    );
    return Number(rows[0]?.count) <= limit;
  }
  async noteInstall(activity: {
    siteId: string;
    signal: InstallSignal;
    origin: string;
    now: number;
  }): Promise<void> {
    await this.execute(
      `insert into agent_identification.install_activity as existing
       (site_id, signal, origin, first_seen_at, last_seen_at)
       select $1, $2, $3, $4, $4
       where exists (select 1 from agent_identification.install_activity
                     where site_id=$1 and signal=$2 and origin=$3)
          or (select count(*) from agent_identification.install_activity
              where site_id=$1 and signal=$2) < $5
       on conflict (site_id, signal, origin) do update
       set last_seen_at = greatest(existing.last_seen_at, excluded.last_seen_at)`,
      [activity.siteId, activity.signal, activity.origin, activity.now, MAX_INSTALL_ORIGINS],
    );
  }
  async listInstallActivity(siteIds: string[]): Promise<InstallActivity[]> {
    if (!siteIds.length) return [];
    const rows = await this.execute(
      `select site_id, signal, origin, first_seen_at, last_seen_at
       from agent_identification.install_activity
       where site_id in (select jsonb_array_elements_text($1::text::jsonb))`,
      [JSON.stringify(siteIds)],
    );
    return rows.map((row) => ({
      siteId: String(row.site_id),
      signal: row.signal as InstallSignal,
      origin: String(row.origin),
      firstSeenAt: Number(row.first_seen_at),
      lastSeenAt: Number(row.last_seen_at),
    }));
  }
  async prune(cutoffs: PruneCutoffs, now: number, limit: number): Promise<PruneResult> {
    await this.execute(
      `delete from agent_identification.install_activity
       where signal in (select jsonb_array_elements_text($1::text::jsonb)) and last_seen_at<$2`,
      [JSON.stringify(INSTALL_REFUSALS), cutoffs.sessions],
    );
    const activityRows = await this.execute(
      `delete from agent_identification.activity_events
       where (site_id, id) in (select site_id, id from agent_identification.activity_events
                               where received_at<$1 order by received_at limit $2)
       returning id`,
      [cutoffs.activity, limit],
    );
    const rows = await this.execute(
      `delete from agent_identification.sessions
       where id in (select id from agent_identification.sessions
                    where created_at<$1 order by created_at limit $2)
       returning id`,
      [cutoffs.sessions, limit],
    );
    const rates = await this.execute(
      `delete from agent_identification.rate_buckets
       where key_hash in (select key_hash from agent_identification.rate_buckets
                          where expires_at<=$1 order by expires_at limit $2)
       returning key_hash`,
      [now, limit],
    );
    return {
      removedSessions: rows.length,
      removedRateBuckets: rates.length,
      removedActivity: activityRows.length,
      more: rows.length === limit || rates.length === limit || activityRows.length === limit,
    };
  }
}
