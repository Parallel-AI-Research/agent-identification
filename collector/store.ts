import type { ActivityEvent, AgentClaim, Choice } from "../src/protocol.js";
import { assertActivity, declarationEvent, sameActivity, type ActivityResult } from "./activity.js";
import {
  ENVIRONMENT_TYPES,
  type DomainClaim,
  type EnvironmentChanges,
  type EnvironmentRecord,
  type ProductRecord,
  type ProductStore,
  type ProductWithEnvironments,
  type SecretRotation,
} from "./products.js";

export interface StoredSession {
  id: string;
  siteId: string;
  origin: string;
  tokenHash: string;
  bindingHash: string | null;
  /** Fingerprint of the site secret that signed this session's binding context. */
  signingSecretHash: string | null;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
  choice: Choice | null;
  receipt: string | null;
  eventId: string | null;
  requestId: string | null;
}
export interface StoredEvent {
  id: string;
  siteId: string;
  origin: string;
  sessionId: string;
  choice: Choice;
  evidence: "self_reported";
  createdAt: string;
}
/** What an install has done, kept per site so its owner can see whether it works. */
export type InstallSignal =
  "loaded" | "declared" | "origin_refused" | "secret_refused" | "binding_refused";
export interface InstallActivity {
  siteId: string;
  signal: InstallSignal;
  /** Empty for server requests, which have no origin. */
  origin: string;
  firstSeenAt: number;
  lastSeenAt: number;
}
/** Requests can claim any origin, so a site keeps only this many per signal. */
export const MAX_INSTALL_ORIGINS = 20;
export const INSTALL_REFUSALS: InstallSignal[] = [
  "origin_refused",
  "secret_refused",
  "binding_refused",
];
export type DeclarationResult =
  { status: "recorded"; session: StoredSession } | { status: "conflict" | "invalid" };
export interface PruneResult {
  removedSessions: number;
  removedRateBuckets: number;
  removedActivity: number;
  /** A full batch warrants another pass; this may conservatively overestimate. */
  more: boolean;
}
export interface PruneCutoffs {
  /** Sessions, and their legacy declaration events, created before this go. */
  sessions: number;
  /** Activity events received before this go. They are kept longer than sessions. */
  activity: number;
}
export interface CollectorStore {
  readonly kind: "memory" | "postgres";
  checkHealth(): Promise<void>;
  createSession(session: StoredSession): Promise<void>;
  getSession(tokenHash: string): Promise<StoredSession | null>;
  getSessionById(id: string): Promise<StoredSession | null>;
  /** Also adds the declaration to the session's activity timeline, in the same write. */
  recordDeclaration(input: DeclarationInput): Promise<DeclarationResult>;
  revokeSession(tokenHash: string, now: number): Promise<void>;
  /** The v0.1.0 declaration export. */
  listEvents(siteId: string, limit: number): Promise<StoredEvent[]>;
  /** Appends one event. A retry with the same ID and content is a duplicate, not a change. */
  recordActivity(event: ActivityEvent): Promise<ActivityResult>;
  /** Newest first by when the collector received them. */
  listActivity(siteId: string, options: ActivityQuery): Promise<ActivityEvent[]>;
  consumeRate(key: string, limit: number, windowMs: number, now: number): Promise<boolean>;
  noteInstall(activity: {
    siteId: string;
    signal: InstallSignal;
    origin: string;
    now: number;
  }): Promise<void>;
  listInstallActivity(siteIds: string[]): Promise<InstallActivity[]>;
  /** Also removes refusals older than the session cutoff. Loads and declarations stay as history. */
  prune(cutoffs: PruneCutoffs, now: number, limit: number): Promise<PruneResult>;
}
export interface ActivityQuery {
  limit: number;
  sessionId?: string;
  type?: ActivityEvent["type"];
}
export interface DeclarationInput {
  tokenHash: string;
  choice: Choice;
  requestId: string;
  eventId: string;
  receipt: string;
  /** Kept from the first accepted request; a retry can't change it. */
  agent: AgentClaim;
  now: number;
}

/** Development/test storage. Production must use shared persistent storage. */
export class MemoryStore implements CollectorStore, ProductStore {
  readonly kind = "memory" as const;
  private products = new Map<string, ProductRecord>();
  private environments = new Map<string, EnvironmentRecord>();
  private domains = new Map<string, DomainClaim & { ownerId: string }>();
  private sessions = new Map<string, StoredSession>();
  private events = new Map<string, StoredEvent>();
  private rates = new Map<string, { count: number; expiresAt: number }>();
  private installs = new Map<string, InstallActivity>();
  private activity = new Map<string, ActivityEvent>();
  async checkHealth(): Promise<void> {}
  /** Synchronous so a local fixture can register its sites during startup. */
  seedProduct(product: ProductRecord, production: EnvironmentRecord): void {
    this.products.set(product.id, { ...product });
    this.addEnvironment(production);
  }
  private addEnvironment(environment: EnvironmentRecord): void {
    if ([...this.environments.values()].some((row) => row.siteId === environment.siteId)) {
      throw new Error("Duplicate site id");
    }
    this.environments.set(environment.id, {
      ...environment,
      origins: [...environment.origins].sort(),
    });
  }
  private withEnvironments(product: ProductRecord): ProductWithEnvironments {
    const environments = [...this.environments.values()]
      .filter((row) => row.productId === product.id)
      .sort((a, b) => ENVIRONMENT_TYPES.indexOf(a.type) - ENVIRONMENT_TYPES.indexOf(b.type))
      .map((row) => ({ ...row, origins: [...row.origins] }));
    return { ...product, environments };
  }
  private owned(ownerId: string, productId: string, id: string): EnvironmentRecord | undefined {
    const row = this.environments.get(id);
    const product = this.products.get(productId);
    return row && row.productId === productId && product?.ownerId === ownerId ? row : undefined;
  }
  async createProduct(product: ProductRecord, production: EnvironmentRecord): Promise<void> {
    this.seedProduct(product, production);
  }
  async countProducts(ownerId: string): Promise<number> {
    return (await this.listProducts(ownerId)).length;
  }
  async listProducts(ownerId: string): Promise<ProductWithEnvironments[]> {
    return [...this.products.values()]
      .filter((row) => row.ownerId === ownerId)
      .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
      .map((row) => this.withEnvironments(row));
  }
  async getProduct(ownerId: string, id: string): Promise<ProductWithEnvironments | null> {
    const row = this.products.get(id);
    return row && row.ownerId === ownerId ? this.withEnvironments(row) : null;
  }
  async renameProduct(
    ownerId: string,
    id: string,
    name: string,
    now: number,
  ): Promise<ProductWithEnvironments | null> {
    const row = this.products.get(id);
    if (!row || row.ownerId !== ownerId) return null;
    row.name = name;
    row.updatedAt = now;
    return this.withEnvironments(row);
  }
  async createEnvironment(ownerId: string, environment: EnvironmentRecord): Promise<boolean> {
    if (this.products.get(environment.productId)?.ownerId !== ownerId) return false;
    const taken = [...this.environments.values()].some(
      (row) => row.productId === environment.productId && row.type === environment.type,
    );
    if (taken) return false;
    this.addEnvironment(environment);
    return true;
  }
  async updateEnvironment(
    ownerId: string,
    productId: string,
    id: string,
    changes: EnvironmentChanges,
  ): Promise<EnvironmentRecord | null> {
    const row = this.owned(ownerId, productId, id);
    if (!row) return null;
    if (changes.name !== undefined) row.name = changes.name;
    if (changes.origins !== undefined) row.origins = [...changes.origins].sort();
    row.updatedAt = changes.now;
    return { ...row, origins: [...row.origins] };
  }
  async rotateSecret(
    ownerId: string,
    productId: string,
    id: string,
    rotation: SecretRotation,
  ): Promise<EnvironmentRecord | null> {
    const row = this.owned(ownerId, productId, id);
    if (!row || row.secretCiphertext !== rotation.expectedCiphertext) return null;
    row.previousSecretCiphertext = row.secretCiphertext;
    row.previousSecretExpiresAt = rotation.previousSecretExpiresAt;
    row.secretCiphertext = rotation.secretCiphertext;
    row.updatedAt = rotation.now;
    return { ...row, origins: [...row.origins] };
  }
  async revokePreviousSecret(
    ownerId: string,
    productId: string,
    id: string,
    now: number,
  ): Promise<EnvironmentRecord | null> {
    const row = this.owned(ownerId, productId, id);
    if (!row) return null;
    row.previousSecretCiphertext = null;
    row.previousSecretExpiresAt = null;
    row.updatedAt = now;
    return { ...row, origins: [...row.origins] };
  }
  async claimDomains(
    ownerId: string,
    claims: { domain: string; token: string }[],
    _now: number,
  ): Promise<DomainClaim[]> {
    return claims.map(({ domain, token }) => {
      const key = `${ownerId}:${domain}`;
      if (!this.domains.has(key)) {
        this.domains.set(key, { ownerId, domain, token, verifiedAt: null });
      }
      const { token: stored, verifiedAt } = this.domains.get(key)!;
      return { domain, token: stored, verifiedAt };
    });
  }
  async markDomainVerified(ownerId: string, domain: string, now: number): Promise<boolean> {
    const taken = [...this.domains.values()].some(
      (row) => row.domain === domain && row.ownerId !== ownerId && row.verifiedAt !== null,
    );
    if (taken) return false;
    const row = this.domains.get(`${ownerId}:${domain}`);
    if (row) row.verifiedAt ??= now;
    return true;
  }
  async getEnvironmentBySiteId(siteId: string): Promise<EnvironmentRecord | null> {
    const row = [...this.environments.values()].find((value) => value.siteId === siteId);
    return row ? { ...row, origins: [...row.origins] } : null;
  }
  async isRegisteredOrigin(origin: string): Promise<boolean> {
    return [...this.environments.values()].some((row) => row.origins.includes(origin));
  }
  async createSession(session: StoredSession): Promise<void> {
    if (this.sessions.has(session.tokenHash)) throw new Error("Duplicate session");
    this.sessions.set(session.tokenHash, { ...session });
  }
  async getSession(hash: string): Promise<StoredSession | null> {
    const row = this.sessions.get(hash);
    return row ? { ...row } : null;
  }
  async getSessionById(id: string): Promise<StoredSession | null> {
    const row = [...this.sessions.values()].find((value) => value.id === id);
    return row ? { ...row } : null;
  }
  async recordDeclaration(input: DeclarationInput): Promise<DeclarationResult> {
    const row = this.sessions.get(input.tokenHash);
    if (!row || row.revokedAt !== null || row.expiresAt <= input.now) {
      return { status: "invalid" };
    }
    if (row.choice !== null) {
      return row.choice === input.choice
        ? { status: "recorded", session: { ...row } }
        : { status: "conflict" };
    }
    Object.assign(row, {
      choice: input.choice,
      requestId: input.requestId,
      eventId: input.eventId,
      receipt: input.receipt,
    });
    this.events.set(input.eventId, {
      id: input.eventId,
      siteId: row.siteId,
      origin: row.origin,
      sessionId: row.id,
      choice: input.choice,
      evidence: "self_reported",
      createdAt: new Date(input.now).toISOString(),
    });
    const event = declarationEvent(row, input);
    this.activity.set(JSON.stringify([event.siteId, event.id]), event);
    return { status: "recorded", session: { ...row } };
  }
  async recordActivity(event: ActivityEvent): Promise<ActivityResult> {
    assertActivity(event);
    const key = JSON.stringify([event.siteId, event.id]);
    const existing = this.activity.get(key);
    if (existing) {
      return sameActivity(existing, event)
        ? { status: "duplicate", event: structuredClone(existing) }
        : { status: "conflict" };
    }
    this.activity.set(key, structuredClone(event));
    return { status: "recorded", event: structuredClone(event) };
  }
  async listActivity(siteId: string, options: ActivityQuery): Promise<ActivityEvent[]> {
    return [...this.activity.values()]
      .filter(
        (event) =>
          event.siteId === siteId &&
          (options.sessionId === undefined || event.sessionId === options.sessionId) &&
          (options.type === undefined || event.type === options.type),
      )
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.id.localeCompare(a.id))
      .slice(0, options.limit)
      .map((event) => structuredClone(event));
  }
  async revokeSession(hash: string, now: number): Promise<void> {
    const row = this.sessions.get(hash);
    if (row && row.revokedAt === null) row.revokedAt = now;
  }
  async listEvents(siteId: string, limit: number): Promise<StoredEvent[]> {
    return [...this.events.values()]
      .filter((event) => event.siteId === siteId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, limit)
      .map((row) => ({ ...row }));
  }
  async consumeRate(key: string, limit: number, windowMs: number, now: number): Promise<boolean> {
    let rate = this.rates.get(key);
    if (!rate || rate.expiresAt <= now) {
      rate = { count: 0, expiresAt: now + windowMs };
      this.rates.set(key, rate);
    }
    rate.count++;
    return rate.count <= limit;
  }
  async noteInstall(activity: {
    siteId: string;
    signal: InstallSignal;
    origin: string;
    now: number;
  }): Promise<void> {
    const { siteId, signal, origin, now } = activity;
    const key = JSON.stringify([siteId, signal, origin]);
    const row = this.installs.get(key);
    if (row) {
      row.lastSeenAt = Math.max(row.lastSeenAt, now);
      return;
    }
    const kept = [...this.installs.values()].filter(
      (value) => value.siteId === siteId && value.signal === signal,
    ).length;
    if (kept >= MAX_INSTALL_ORIGINS) return;
    this.installs.set(key, { siteId, signal, origin, firstSeenAt: now, lastSeenAt: now });
  }
  async listInstallActivity(siteIds: string[]): Promise<InstallActivity[]> {
    return [...this.installs.values()]
      .filter((row) => siteIds.includes(row.siteId))
      .map((row) => ({ ...row }));
  }
  async prune(cutoffs: PruneCutoffs, now: number, limit: number): Promise<PruneResult> {
    for (const [key, row] of this.installs) {
      if (INSTALL_REFUSALS.includes(row.signal) && row.lastSeenAt < cutoffs.sessions) {
        this.installs.delete(key);
      }
    }
    let activityRemoved = 0;
    for (const [key, event] of this.activity) {
      if (activityRemoved >= limit) break;
      if (Date.parse(event.receivedAt) < cutoffs.activity) {
        this.activity.delete(key);
        activityRemoved++;
      }
    }
    let removed = 0;
    for (const [key, session] of this.sessions) {
      if (removed >= limit) break;
      if (session.createdAt < cutoffs.sessions) {
        this.sessions.delete(key);
        if (session.eventId) this.events.delete(session.eventId);
        removed++;
      }
    }
    let ratesRemoved = 0;
    for (const [key, rate] of this.rates) {
      if (ratesRemoved >= limit) break;
      if (rate.expiresAt <= now) {
        this.rates.delete(key);
        ratesRemoved++;
      }
    }
    return {
      removedSessions: removed,
      removedRateBuckets: ratesRemoved,
      removedActivity: activityRemoved,
      more: removed === limit || ratesRemoved === limit || activityRemoved === limit,
    };
  }
}
