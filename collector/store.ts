import type { Choice } from "../src/protocol.js";
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
export type DeclarationResult =
  { status: "recorded"; session: StoredSession } | { status: "conflict" | "invalid" };
export interface PruneResult {
  removedSessions: number;
  removedRateBuckets: number;
  /** A full batch warrants another pass; this may conservatively overestimate. */
  more: boolean;
}
export interface CollectorStore {
  readonly kind: "memory" | "postgres";
  checkHealth(): Promise<void>;
  createSession(session: StoredSession): Promise<void>;
  getSession(tokenHash: string): Promise<StoredSession | null>;
  getSessionById(id: string): Promise<StoredSession | null>;
  recordDeclaration(input: {
    tokenHash: string;
    choice: Choice;
    requestId: string;
    eventId: string;
    receipt: string;
    now: number;
  }): Promise<DeclarationResult>;
  revokeSession(tokenHash: string, now: number): Promise<void>;
  listEvents(siteId: string, limit: number): Promise<StoredEvent[]>;
  consumeRate(key: string, limit: number, windowMs: number, now: number): Promise<boolean>;
  prune(cutoff: number, now: number, limit: number): Promise<PruneResult>;
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
  async recordDeclaration(input: {
    tokenHash: string;
    choice: Choice;
    requestId: string;
    eventId: string;
    receipt: string;
    now: number;
  }): Promise<DeclarationResult> {
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
    return { status: "recorded", session: { ...row } };
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
  async prune(cutoff: number, now: number, limit: number): Promise<PruneResult> {
    let removed = 0;
    for (const [key, session] of this.sessions) {
      if (removed >= limit) break;
      if (session.createdAt < cutoff) {
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
      more: removed === limit || ratesRemoved === limit,
    };
  }
}
