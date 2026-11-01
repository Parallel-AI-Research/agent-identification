import type {
  CollectorStore,
  DeclarationResult,
  PruneResult,
  StoredEvent,
  StoredSession,
} from "./store.js";
import type { Choice } from "../src/protocol.js";
import type {
  DomainClaim,
  ProductChanges,
  ProductRecord,
  ProductStore,
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
  // Drivers differ on whether a jsonb column arrives parsed.
  const origins = typeof row.origins === "string" ? JSON.parse(row.origins) : row.origins;
  return {
    id: String(row.id),
    ownerId: row.owner_id === null ? null : String(row.owner_id),
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
const PRODUCT_COLUMNS = `p.*, coalesce((
  select jsonb_agg(o.origin order by o.origin)
  from agent_identification.product_origins o where o.product_id = p.id
), '[]'::jsonb) as origins`;

export class PostgresStore implements CollectorStore, ProductStore {
  readonly kind = "postgres" as const;
  constructor(private execute: QueryExecutor) {}

  async checkHealth(): Promise<void> {
    // Check the connection, relations and runtime read permissions without
    // reading or returning visitor records.
    await this.execute(
      `select 1 from agent_identification.sessions,
       agent_identification.events, agent_identification.rate_buckets,
       agent_identification.products, agent_identification.product_origins,
       agent_identification.domain_claims limit 0`,
      [],
    );
  }

  async createProduct(p: ProductRecord): Promise<void> {
    // One statement, so a product can never exist without its origins.
    await this.execute(
      `with created as (
         insert into agent_identification.products
         (id, owner_id, name, site_id, secret_ciphertext, previous_secret_ciphertext,
          previous_secret_expires_at, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id
       )
       insert into agent_identification.product_origins (product_id, origin)
       select created.id, value from created, jsonb_array_elements_text($10::jsonb) as value`,
      [
        p.id,
        p.ownerId,
        p.name,
        p.siteId,
        p.secretCiphertext,
        p.previousSecretCiphertext,
        p.previousSecretExpiresAt,
        p.createdAt,
        p.updatedAt,
        JSON.stringify(p.origins),
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
  async listProducts(ownerId: string): Promise<ProductRecord[]> {
    const rows = await this.execute(
      `select ${PRODUCT_COLUMNS} from agent_identification.products p
       where p.owner_id=$1 order by p.created_at desc, p.id desc`,
      [ownerId],
    );
    return rows.map(product);
  }
  async getProduct(ownerId: string, id: string): Promise<ProductRecord | null> {
    const rows = await this.execute(
      `select ${PRODUCT_COLUMNS} from agent_identification.products p
       where p.owner_id=$1 and p.id=$2`,
      [ownerId, id],
    );
    return rows[0] ? product(rows[0]) : null;
  }
  async updateProduct(
    ownerId: string,
    id: string,
    changes: ProductChanges,
  ): Promise<ProductRecord | null> {
    const origins = changes.origins === undefined ? null : JSON.stringify(changes.origins);
    const rows = await this.execute(
      `with target as (
         update agent_identification.products
         set name=coalesce($3,name), updated_at=$4
         where owner_id=$1 and id=$2 returning id
       ), removed as (
         delete from agent_identification.product_origins
         where $5::jsonb is not null and product_id in (select id from target)
           and origin not in (select jsonb_array_elements_text($5::jsonb))
       ), added as (
         insert into agent_identification.product_origins (product_id, origin)
         select target.id, value from target, jsonb_array_elements_text($5::jsonb) as value
         on conflict do nothing
       )
       select id from target`,
      [ownerId, id, changes.name ?? null, changes.now, origins],
    );
    return rows[0] ? this.getProduct(ownerId, id) : null;
  }
  async rotateSecret(
    ownerId: string,
    id: string,
    rotation: SecretRotation,
  ): Promise<ProductRecord | null> {
    const rows = await this.execute(
      `update agent_identification.products
       set previous_secret_ciphertext=secret_ciphertext, previous_secret_expires_at=$3,
           secret_ciphertext=$4, updated_at=$5
       where owner_id=$1 and id=$2 and secret_ciphertext=$6 returning id`,
      [
        ownerId,
        id,
        rotation.previousSecretExpiresAt,
        rotation.secretCiphertext,
        rotation.now,
        rotation.expectedCiphertext,
      ],
    );
    return rows[0] ? this.getProduct(ownerId, id) : null;
  }
  async revokePreviousSecret(
    ownerId: string,
    id: string,
    now: number,
  ): Promise<ProductRecord | null> {
    const rows = await this.execute(
      `update agent_identification.products
       set previous_secret_ciphertext=null, previous_secret_expires_at=null, updated_at=$3
       where owner_id=$1 and id=$2 returning id`,
      [ownerId, id, now],
    );
    return rows[0] ? this.getProduct(ownerId, id) : null;
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
       from jsonb_array_elements($2::jsonb) as claim
       on conflict (owner_id, domain) do nothing`,
      [ownerId, JSON.stringify(claims), now],
    );
    const rows = await this.execute(
      `select domain, token, verified_at from agent_identification.domain_claims
       where owner_id=$1 and domain in (
         select claim->>'domain' from jsonb_array_elements($2::jsonb) as claim
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
  async getProductBySiteId(siteId: string): Promise<ProductRecord | null> {
    const rows = await this.execute(
      `select ${PRODUCT_COLUMNS} from agent_identification.products p where p.site_id=$1`,
      [siteId],
    );
    return rows[0] ? product(rows[0]) : null;
  }
  async isRegisteredOrigin(origin: string): Promise<boolean> {
    const rows = await this.execute(
      "select 1 from agent_identification.product_origins where origin=$1 limit 1",
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
  async recordDeclaration(input: {
    tokenHash: string;
    choice: Choice;
    requestId: string;
    eventId: string;
    receipt: string;
    now: number;
  }): Promise<DeclarationResult> {
    // The row lock and event insertion occur atomically in one statement.
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
       )
       select changed.* from changed cross join (select count(*) from logged) as inserted`,
      [input.tokenHash, input.choice, input.requestId, input.eventId, input.receipt, input.now],
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
  async prune(cutoff: number, now: number, limit: number): Promise<PruneResult> {
    const rows = await this.execute(
      `delete from agent_identification.sessions
       where id in (select id from agent_identification.sessions
                    where created_at<$1 order by created_at limit $2)
       returning id`,
      [cutoff, limit],
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
      more: rows.length === limit || rates.length === limit,
    };
  }
}
