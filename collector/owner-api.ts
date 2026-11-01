import { randomBytes, randomUUID } from "node:crypto";
import { Resolver } from "node:dns/promises";
import { hashToken, isAllowedOrigin, isUuid } from "../src/server/tokens.js";
import { body, eventLimit, HttpError } from "./http.js";
import {
  newSiteId,
  newSiteSecret,
  type DomainClaim,
  type ProductRecord,
  type ProductStore,
  type SecretCipher,
  type SiteDirectory,
} from "./products.js";
import type { CollectorStore } from "./store.js";

export interface OwnerApiOptions {
  /** Returns the verified owner ID, or null for a rejected credential. */
  authenticate: (request: Request) => Promise<string | null>;
  products: ProductStore;
  cipher: SecretCipher;
  /** Injected in tests; deployments use public DNS. */
  resolveTxt?: (name: string) => Promise<string[][]>;
}
const ROUTE =
  /^\/v1\/owner\/products(?:\/([^/]+)(?:\/(events|secret|secret\/previous|domains|domains\/verify))?)?$/;
const MAX_ORIGINS = 20;
const MAX_PRODUCTS = 25;
const OVERLAP_MS = 24 * 60 * 60 * 1000;
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z][a-z0-9-]+$/;
const TXT_PREFIX = "_agent-identification";
const TXT_VALUE = "agent-identification-verification";

/**
 * Asks public resolvers, so the answer doesn't depend on a host's DNS setup and can't
 * come from internal records. Bounded, so a slow lookup can't hold a request open.
 */
export async function publicTxtLookup(name: string): Promise<string[][]> {
  const dns = new Resolver({ timeout: 3000, tries: 1 });
  dns.setServers(["1.1.1.1", "8.8.8.8"]);
  const deadline = setTimeout(() => dns.cancel(), 6000);
  try {
    return await dns.resolveTxt(name);
  } finally {
    clearTimeout(deadline);
  }
}
function view(product: ProductRecord, now: number) {
  const overlap = (product.previousSecretExpiresAt ?? 0) > now;
  return {
    id: product.id,
    name: product.name,
    siteId: product.siteId,
    origins: product.origins,
    previousSecretExpiresAt: overlap
      ? new Date(product.previousSecretExpiresAt!).toISOString()
      : null,
    createdAt: new Date(product.createdAt).toISOString(),
    updatedAt: new Date(product.updatedAt).toISOString(),
  };
}
function productName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 100) throw new HttpError(400, "Name must be 1–100 characters");
  return name;
}
// The shared check suits operator config. Customer input also needs a plain hostname,
// because URL parsing accepts characters such as the wildcard in https://*.example.com.
function isCustomerOrigin(value: unknown): value is string {
  if (!isAllowedOrigin(value)) return false;
  const { hostname } = new URL(value);
  return hostname === "[::1]" || /^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(hostname);
}
function productOrigins(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_ORIGINS) {
    throw new HttpError(400, `Provide 1–${MAX_ORIGINS} exact origins`);
  }
  for (const origin of value) {
    if (!isCustomerOrigin(origin)) {
      throw new HttpError(
        400,
        "Each origin must be exact, such as https://www.example.com, with no path",
      );
    }
  }
  return [...new Set(value as string[])];
}
function domainView(claim: DomainClaim) {
  return {
    domain: claim.domain,
    status: claim.verifiedAt === null ? ("unverified" as const) : ("verified" as const),
    record: {
      type: "TXT",
      name: `${TXT_PREFIX}.${claim.domain}`,
      value: `${TXT_VALUE}=${claim.token}`,
    },
  };
}
/** Local and raw-address origins have no DNS name to verify. */
function verifiableHosts(origins: string[]): { domains: string[]; other: string[] } {
  const hosts = [...new Set(origins.map((origin) => new URL(origin).hostname))].sort();
  return {
    domains: hosts.filter((host) => DOMAIN.test(host) && host !== "localhost"),
    other: hosts.filter((host) => !DOMAIN.test(host) || host === "localhost"),
  };
}
function claimsFor(domains: string[]) {
  return domains.map((domain) => ({ domain, token: randomBytes(24).toString("base64url") }));
}

export async function handleOwnerRequest(
  request: Request,
  url: URL,
  options: {
    owners: OwnerApiOptions;
    store: CollectorStore;
    directory: SiteDirectory;
    now: number;
    respond: (payload: unknown, code?: number) => Response;
  },
): Promise<Response> {
  const { owners, store, directory, now, respond } = options;
  const route = ROUTE.exec(url.pathname);
  if (!route) throw new HttpError(404, "Not found");
  if (request.headers.get("origin") !== null) {
    throw new HttpError(403, "Owner requests must come from the dashboard server");
  }
  const ownerId = await owners.authenticate(request);
  if (!ownerId) throw new HttpError(401, "Invalid or expired sign-in");
  const [, productId, section] = route;
  if (productId !== undefined && !isUuid(productId)) throw new HttpError(404, "Not found");
  if (request.method !== "GET") {
    const key = hashToken(JSON.stringify(["agent-identification-owner", ownerId]));
    if (!(await store.consumeRate(key, 60, 60000, now))) {
      throw new HttpError(429, "Too many requests; try again later");
    }
  }

  if (productId === undefined) {
    if (request.method === "GET") {
      const products = await owners.products.listProducts(ownerId);
      return respond({ products: products.map((product) => view(product, now)) });
    }
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed");
    const data = await body(request, ["name", "origins"]);
    const name = productName(data.name);
    const origins = productOrigins(data.origins);
    if ((await owners.products.countProducts(ownerId)) >= MAX_PRODUCTS) {
      throw new HttpError(409, `An account can have up to ${MAX_PRODUCTS} products`);
    }
    const siteId = newSiteId();
    const serverSecret = newSiteSecret();
    const product: ProductRecord = {
      id: randomUUID(),
      ownerId,
      name,
      siteId,
      origins: [...origins].sort(),
      secretCiphertext: owners.cipher.seal(serverSecret, siteId),
      previousSecretCiphertext: null,
      previousSecretExpiresAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await owners.products.createProduct(product);
    directory.invalidate(siteId, origins);
    // The secret is returned here once and cannot be read back.
    return respond({ product: view(product, now), serverSecret }, 201);
  }

  const product = await owners.products.getProduct(ownerId, productId);
  // Another owner's product is reported as missing, so IDs cannot be probed.
  if (!product) throw new HttpError(404, "Not found");

  if (section === "events") {
    if (request.method !== "GET") throw new HttpError(405, "Method not allowed");
    return respond({ events: await store.listEvents(product.siteId, eventLimit(url)) });
  }
  if (section === "secret") {
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed");
    if ((product.previousSecretExpiresAt ?? 0) > now) {
      throw new HttpError(409, "Revoke the old secret before rotating again");
    }
    const serverSecret = newSiteSecret();
    const rotated = await owners.products.rotateSecret(ownerId, productId, {
      expectedCiphertext: product.secretCiphertext,
      secretCiphertext: owners.cipher.seal(serverSecret, product.siteId),
      previousSecretExpiresAt: now + OVERLAP_MS,
      now,
    });
    if (!rotated) throw new HttpError(409, "Revoke the old secret before rotating again");
    directory.invalidate(product.siteId);
    return respond({ product: view(rotated, now), serverSecret });
  }
  if (section === "secret/previous") {
    if (request.method !== "DELETE") throw new HttpError(405, "Method not allowed");
    const revoked = await owners.products.revokePreviousSecret(ownerId, productId, now);
    if (!revoked) throw new HttpError(404, "Not found");
    directory.invalidate(product.siteId);
    return respond({ product: view(revoked, now) });
  }
  if (section === "domains") {
    if (request.method !== "GET") throw new HttpError(405, "Method not allowed");
    const { domains, other } = verifiableHosts(product.origins);
    const claims = await owners.products.claimDomains(ownerId, claimsFor(domains), now);
    return respond({
      domains: [
        ...claims.map(domainView),
        ...other.map((domain) => ({ domain, status: "not_applicable", record: null })),
      ],
    });
  }
  if (section === "domains/verify") {
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed");
    const data = await body(request, ["domain"]);
    const { domains } = verifiableHosts(product.origins);
    if (typeof data.domain !== "string" || !domains.includes(data.domain)) {
      throw new HttpError(400, "That domain is not one of this product's origins");
    }
    const [claim] = await owners.products.claimDomains(ownerId, claimsFor([data.domain]), now);
    const expected = domainView(claim!).record;
    let values: string[] = [];
    try {
      values = (await (owners.resolveTxt ?? publicTxtLookup)(expected.name)).map((part) =>
        part.join(""),
      );
    } catch {
      // A missing record and a failed lookup need the same action from the customer.
    }
    if (!values.includes(expected.value)) {
      throw new HttpError(
        422,
        `No matching TXT record at ${expected.name} yet. DNS changes can take a while, so try again shortly.`,
      );
    }
    if (!(await owners.products.markDomainVerified(ownerId, data.domain, now))) {
      throw new HttpError(409, "Another account has already verified this domain");
    }
    return respond({ domain: domainView({ ...claim!, verifiedAt: now }) });
  }

  if (request.method === "GET") return respond({ product: view(product, now) });
  if (request.method !== "PATCH") throw new HttpError(405, "Method not allowed");
  const data = await body(request, ["name", "origins"]);
  if (data.name === undefined && data.origins === undefined) {
    throw new HttpError(400, "Provide a name or origins to change");
  }
  const updated = await owners.products.updateProduct(ownerId, productId, {
    ...(data.name !== undefined ? { name: productName(data.name) } : {}),
    ...(data.origins !== undefined ? { origins: productOrigins(data.origins) } : {}),
    now,
  });
  if (!updated) throw new HttpError(404, "Not found");
  directory.invalidate(product.siteId, [...product.origins, ...updated.origins]);
  return respond({ product: view(updated, now) });
}
