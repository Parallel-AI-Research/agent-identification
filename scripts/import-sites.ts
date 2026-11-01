import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { validateSite, type SiteConfig } from "../src/server/tokens.js";
import { PostgresStore, postgresExecutor } from "../collector/postgres-store.js";
import { SecretCipher, type ProductStore } from "../collector/products.js";
import { databaseClient } from "./runtime.js";

/** Adds operator sites as production environments, keeping their IDs and secrets. */
export async function importSites(
  sites: SiteConfig[],
  products: ProductStore,
  cipher: SecretCipher,
  now: number,
): Promise<{ imported: string[]; skipped: string[] }> {
  for (const site of sites) {
    validateSite(site);
    if (site.secret.startsWith("test-only")) throw new Error("Test secrets cannot be imported");
  }
  const imported: string[] = [];
  const skipped: string[] = [];
  for (const site of sites) {
    if (await products.getEnvironmentBySiteId(site.id)) {
      skipped.push(site.id);
      continue;
    }
    const id = randomUUID();
    await products.createProduct(
      { id, ownerId: null, name: site.id, createdAt: now, updatedAt: now },
      {
        id: randomUUID(),
        productId: id,
        type: "production",
        name: "Production",
        siteId: site.id,
        origins: [...new Set(site.origins)].sort(),
        secretCiphertext: cipher.seal(site.secret, site.id),
        previousSecretCiphertext: null,
        previousSecretExpiresAt: null,
        createdAt: now,
        updatedAt: now,
      },
    );
    imported.push(site.id);
  }
  return { imported, skipped };
}

if (process.argv[1]?.endsWith("import-sites.ts")) {
  const { values } = parseArgs({ options: { file: { type: "string" } } });
  const raw = values.file ? await readFile(values.file, "utf8") : process.env.AGENT_ID_SITES;
  if (!raw || !process.env.DATABASE_URL || !process.env.AGENT_ID_ENCRYPTION_KEY) {
    throw Error(
      "Set DATABASE_URL and AGENT_ID_ENCRYPTION_KEY, and provide AGENT_ID_SITES or --file",
    );
  }
  const parsed: unknown = JSON.parse(raw);
  const sites = (Array.isArray(parsed) ? parsed : [parsed]) as SiteConfig[];
  const sql = databaseClient(process.env.DATABASE_URL);
  try {
    const result = await importSites(
      sites,
      new PostgresStore(postgresExecutor(sql)),
      new SecretCipher(process.env.AGENT_ID_ENCRYPTION_KEY),
      Date.now(),
    );
    console.log(`Imported: ${result.imported.join(", ") || "none"}`);
    console.log(`Already present: ${result.skipped.join(", ") || "none"}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
