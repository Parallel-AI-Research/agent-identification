import type {
  CollectorStore,
  DeclarationResult,
  PruneResult,
  StoredEvent,
  StoredSession,
} from "./store.js";
import type { Choice } from "../src/protocol.js";

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
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
    choice: row.choice as Choice | null,
    receipt: row.receipt as string | null,
    eventId: row.event_id as string | null,
    requestId: row.request_id as string | null,
  };
}

export class PostgresStore implements CollectorStore {
  readonly kind = "postgres" as const;
  constructor(private execute: QueryExecutor) {}

  async checkHealth(): Promise<void> {
    // Check the connection, relations and runtime read permissions without
    // reading or returning visitor records.
    await this.execute(
      `select 1 from agent_identification.sessions,
       agent_identification.events, agent_identification.rate_buckets limit 0`,
      [],
    );
  }

  async createSession(s: StoredSession): Promise<void> {
    await this.execute(
      `insert into agent_identification.sessions
       (id, site_id, origin, token_hash, binding_hash, created_at, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [s.id, s.siteId, s.origin, s.tokenHash, s.bindingHash, s.createdAt, s.expiresAt],
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
