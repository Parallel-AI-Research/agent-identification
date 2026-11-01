import { randomUUID } from "node:crypto";
import { hashToken, isAllowedOrigin, isUuid } from "../src/server/tokens.js";
import { body, eventLimit, HttpError } from "./http.js";
import {
  newSiteId,
  newSiteSecret,
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
}
const PRODUCTS = /^\/v1\/owner\/products(?:\/([^/]+)(\/events)?)?$/;
const MAX_ORIGINS = 20;
const MAX_PRODUCTS = 25;

function view(product: ProductRecord) {
  return {
    id: product.id,
    name: product.name,
    siteId: product.siteId,
    origins: product.origins,
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
  const route = PRODUCTS.exec(url.pathname);
  if (!route) throw new HttpError(404, "Not found");
  if (request.headers.get("origin") !== null) {
    throw new HttpError(403, "Owner requests must come from the dashboard server");
  }
  const ownerId = await owners.authenticate(request);
  if (!ownerId) throw new HttpError(401, "Invalid or expired sign-in");
  const [, productId, events] = route;
  if (productId !== undefined && !isUuid(productId)) throw new HttpError(404, "Not found");
  if (["POST", "PATCH"].includes(request.method)) {
    const key = hashToken(JSON.stringify(["agent-identification-owner", ownerId]));
    if (!(await store.consumeRate(key, 60, 60000, now))) {
      throw new HttpError(429, "Too many requests; try again later");
    }
  }

  if (productId === undefined) {
    if (request.method === "GET") {
      const products = await owners.products.listProducts(ownerId);
      return respond({ products: products.map(view) });
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
    return respond({ product: view(product), serverSecret }, 201);
  }

  const product = await owners.products.getProduct(ownerId, productId);
  // Another owner's product is reported as missing, so IDs cannot be probed.
  if (!product) throw new HttpError(404, "Not found");
  if (events) {
    if (request.method !== "GET") throw new HttpError(405, "Method not allowed");
    return respond({ events: await store.listEvents(product.siteId, eventLimit(url)) });
  }
  if (request.method === "GET") return respond({ product: view(product) });
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
  return respond({ product: view(updated) });
}
