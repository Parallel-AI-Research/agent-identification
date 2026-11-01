import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { hashToken, type SiteConfig } from "../src/server/tokens.js";

export const ENVIRONMENT_TYPES = ["production", "beta", "staging", "dev"] as const;
export type EnvironmentType = (typeof ENVIRONMENT_TYPES)[number];

export interface ProductRecord {
  id: string;
  /** Null for operator-provisioned sites, which no customer can reach. */
  ownerId: string | null;
  name: string;
  createdAt: number;
  updatedAt: number;
}
/** Holds the site ID, secret and origins, so each environment's traffic stays separate. */
export interface EnvironmentRecord {
  id: string;
  productId: string;
  type: EnvironmentType;
  name: string;
  siteId: string;
  origins: string[];
  secretCiphertext: string;
  previousSecretCiphertext: string | null;
  previousSecretExpiresAt: number | null;
  createdAt: number;
  updatedAt: number;
}
export interface ProductWithEnvironments extends ProductRecord {
  environments: EnvironmentRecord[];
}
export interface EnvironmentChanges {
  name?: string;
  origins?: string[];
  now: number;
}
export interface SecretRotation {
  /** The secret being replaced, so concurrent rotations cannot both win. */
  expectedCiphertext: string;
  secretCiphertext: string;
  previousSecretExpiresAt: number;
  now: number;
}
export interface DomainClaim {
  domain: string;
  token: string;
  verifiedAt: number | null;
}
/** Owner-facing methods take the owner first so a query cannot omit the ownership check. */
export interface ProductStore {
  createProduct(product: ProductRecord, production: EnvironmentRecord): Promise<void>;
  countProducts(ownerId: string): Promise<number>;
  listProducts(ownerId: string): Promise<ProductWithEnvironments[]>;
  getProduct(ownerId: string, id: string): Promise<ProductWithEnvironments | null>;
  renameProduct(
    ownerId: string,
    id: string,
    name: string,
    now: number,
  ): Promise<ProductWithEnvironments | null>;
  /** Returns false when the product already has an environment of this type. */
  createEnvironment(ownerId: string, environment: EnvironmentRecord): Promise<boolean>;
  updateEnvironment(
    ownerId: string,
    productId: string,
    id: string,
    changes: EnvironmentChanges,
  ): Promise<EnvironmentRecord | null>;
  rotateSecret(
    ownerId: string,
    productId: string,
    id: string,
    rotation: SecretRotation,
  ): Promise<EnvironmentRecord | null>;
  revokePreviousSecret(
    ownerId: string,
    productId: string,
    id: string,
    now: number,
  ): Promise<EnvironmentRecord | null>;
  /** Creates missing claims and returns the owner's claims for these domains. */
  claimDomains(
    ownerId: string,
    claims: { domain: string; token: string }[],
    now: number,
  ): Promise<DomainClaim[]>;
  /** Returns false when another owner has already verified the domain. */
  markDomainVerified(ownerId: string, domain: string, now: number): Promise<boolean>;
  /** Collector-internal lookups for install traffic, which has no owner. */
  getEnvironmentBySiteId(siteId: string): Promise<EnvironmentRecord | null>;
  isRegisteredOrigin(origin: string): Promise<boolean>;
}

export interface Site extends SiteConfig {
  previousSecret: string | null;
  previousSecretExpiresAt: number | null;
}
export interface SiteDirectory {
  find(id: string): Promise<Site | null>;
  hasOrigin(origin: string): Promise<boolean>;
  invalidate(siteId: string, origins?: string[]): void;
}

/** Secrets the collector accepts right now, newest first. */
export function activeSecrets(site: Site, now: number): string[] {
  return site.previousSecret !== null && (site.previousSecretExpiresAt ?? 0) > now
    ? [site.secret, site.previousSecret]
    : [site.secret];
}
export function secretFingerprint(secret: string): string {
  return hashToken(`agent-identification-secret-v1:${secret}`);
}
export function newSiteId(): string {
  return `site_${randomBytes(12).toString("base64url")}`;
}
export function newSiteSecret(): string {
  return randomBytes(32).toString("base64url");
}

const SEALED = /^v1\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]+)$/;

/** Site secrets must stay readable to sign receipts, so they are encrypted, not hashed. */
export class SecretCipher {
  private readonly key: Buffer;
  constructor(encodedKey: string) {
    this.key = Buffer.from(encodedKey, "base64url");
    if (this.key.length !== 32) throw new Error("Encryption key must be 32 base64url bytes");
  }
  // Binding each ciphertext to its site stops one site's secret being copied onto another.
  private context(siteId: string): Buffer {
    return Buffer.from(`agent-identification-site-secret-v1:${siteId}`);
  }
  seal(secret: string, siteId: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(this.context(siteId));
    const sealed = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    return [
      "v1",
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      sealed.toString("base64url"),
    ].join(".");
  }
  open(value: string, siteId: string): string {
    const parts = SEALED.exec(value);
    if (!parts) throw new Error("Invalid sealed secret");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(parts[1]!, "base64url"));
    decipher.setAAD(this.context(siteId));
    decipher.setAuthTag(Buffer.from(parts[2]!, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[3]!, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }
}

export function staticDirectory(sites: SiteConfig[]): SiteDirectory {
  const byId = new Map(
    sites.map((site) => [
      site.id,
      {
        ...site,
        origins: [...site.origins],
        previousSecret: null,
        previousSecretExpiresAt: null,
      },
    ]),
  );
  const origins = new Set(sites.flatMap((site) => site.origins));
  return {
    find: async (id) => byId.get(id) ?? null,
    hasOrigin: async (origin) => origins.has(origin),
    invalidate: () => {},
  };
}

class ExpiringCache<V> {
  private entries = new Map<string, { value: V; expiresAt: number }>();
  constructor(
    private ttlMs: number,
    private maxEntries: number,
    private clock: () => number,
  ) {}
  read(key: string): { value: V } | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.clock()) {
      this.entries.delete(key);
      return null;
    }
    return { value: entry.value };
  }
  write(key: string, value: V): void {
    if (this.entries.size >= this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value!);
    }
    this.entries.set(key, { value, expiresAt: this.clock() + this.ttlMs });
  }
  delete(key: string): void {
    this.entries.delete(key);
  }
}

/**
 * Loads sites from storage. Install traffic is public, so results, including misses,
 * are cached briefly and in bounded memory to keep it from reaching the database.
 */
export class ProductDirectory implements SiteDirectory {
  private sites: ExpiringCache<Site | null>;
  private origins: ExpiringCache<boolean>;
  constructor(
    private products: ProductStore,
    private cipher: SecretCipher,
    options: { ttlMs?: number; maxEntries?: number; clock?: () => number } = {},
  ) {
    const ttlMs = options.ttlMs ?? 30000;
    const maxEntries = options.maxEntries ?? 2000;
    const clock = options.clock ?? Date.now;
    this.sites = new ExpiringCache(ttlMs, maxEntries, clock);
    this.origins = new ExpiringCache(ttlMs, maxEntries, clock);
  }
  async find(id: string): Promise<Site | null> {
    const cached = this.sites.read(id);
    if (cached) return cached.value;
    const environment = await this.products.getEnvironmentBySiteId(id);
    const site = environment ? this.toSite(environment) : null;
    this.sites.write(id, site);
    return site;
  }
  async hasOrigin(origin: string): Promise<boolean> {
    const cached = this.origins.read(origin);
    if (cached) return cached.value;
    const known = await this.products.isRegisteredOrigin(origin);
    this.origins.write(origin, known);
    return known;
  }
  invalidate(siteId: string, origins: string[] = []): void {
    this.sites.delete(siteId);
    for (const origin of origins) this.origins.delete(origin);
  }
  private toSite(environment: EnvironmentRecord): Site {
    return {
      id: environment.siteId,
      origins: environment.origins,
      secret: this.cipher.open(environment.secretCiphertext, environment.siteId),
      previousSecret:
        environment.previousSecretCiphertext === null
          ? null
          : this.cipher.open(environment.previousSecretCiphertext, environment.siteId),
      previousSecretExpiresAt: environment.previousSecretExpiresAt,
    };
  }
}
