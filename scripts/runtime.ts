import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { createCollector } from "../collector/index.js";
import { MemoryStore } from "../collector/store.js";
import { PostgresStore, postgresExecutor } from "../collector/postgres-store.js";
import { supabaseOwnerAuth } from "../collector/owner-auth.js";
import { ProductDirectory, SecretCipher } from "../collector/products.js";
import { DEFAULT_SIGNERS } from "../collector/web-bot-auth.js";

export const DEMO_SECRET = "test-only-secret-not-for-production-00000001";
const DEMO_ENCRYPTION_KEY = "dGVzdC1vbmx5LWVuY3J5cHRpb24ta2V5LTAwMDAwMDE";
const DEMO_SITES = [
  { id: "demo-site", origins: ["http://127.0.0.1:4311", "http://127.0.0.1:4312"] },
  { id: "agent-trials", origins: ["http://127.0.0.1:4310"] },
];
/** A Web Bot Auth signer that tests run locally. The memory demo never runs in production. */
export const LOCAL_TEST_SIGNER = { agent: "http://127.0.0.1:4557", name: "Local test signer" };

export function databaseClient(url: string) {
  return postgres(url, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
    ssl: {
      rejectUnauthorized: true,
      ...(process.env.DATABASE_SSL_CA
        ? { ca: process.env.DATABASE_SSL_CA.replaceAll("\\n", "\n") }
        : {}),
    },
  });
}

function demoStore(cipher: SecretCipher): MemoryStore {
  const store = new MemoryStore();
  for (const site of DEMO_SITES) {
    const id = randomUUID();
    store.seedProduct(
      { id, ownerId: null, name: site.id, createdAt: 0, updatedAt: 0 },
      {
        id: randomUUID(),
        productId: id,
        type: "production",
        name: "Production",
        siteId: site.id,
        origins: site.origins,
        secretCiphertext: cipher.seal(DEMO_SECRET, site.id),
        previousSecretCiphertext: null,
        previousSecretExpiresAt: null,
        createdAt: 0,
        updatedAt: 0,
      },
    );
  }
  return store;
}

export function createRuntime(options: { demo?: boolean; vercel?: boolean } = {}) {
  const demo = options.demo === true;
  if (demo && (process.env.VERCEL || process.env.NODE_ENV === "production"))
    throw Error("Memory demo is local-only");
  if (
    !demo &&
    (!process.env.DATABASE_URL ||
      !process.env.PRUNE_SECRET ||
      !process.env.AGENT_ID_ENCRYPTION_KEY ||
      !process.env.SUPABASE_URL)
  )
    throw Error("Configure DATABASE_URL, PRUNE_SECRET, AGENT_ID_ENCRYPTION_KEY and SUPABASE_URL");
  const cipher = new SecretCipher(
    demo ? DEMO_ENCRYPTION_KEY : process.env.AGENT_ID_ENCRYPTION_KEY!,
  );
  const sql = demo ? null : databaseClient(process.env.DATABASE_URL!);
  const store = sql ? new PostgresStore(postgresExecutor(sql)) : demoStore(cipher);
  const handler = createCollector({
    directory: new ProductDirectory(store, cipher, demo ? { ttlMs: 0 } : {}),
    store,
    production: !demo,
    pruneSecret: demo ? DEMO_SECRET : process.env.PRUNE_SECRET,
    // The local fixture only has a customer API when pointed at a local Supabase stack.
    ...(process.env.SUPABASE_URL
      ? {
          owners: {
            authenticate: supabaseOwnerAuth({ url: process.env.SUPABASE_URL }),
            products: store,
            cipher,
          },
        }
      : {}),
    // This header is trusted only inside the Vercel deployment. Do not enable for generic hosting.
    ...(options.vercel
      ? {
          trustedClientKey: (request: Request) =>
            request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() || "unknown",
        }
      : {}),
    ...(demo
      ? {
          rateLimit: { windowSeconds: 60, maxSessions: 2000, maxDeclarations: 2000 },
          signers: [...DEFAULT_SIGNERS, LOCAL_TEST_SIGNER],
        }
      : {}),
  });
  return {
    handler,
    close: async () => {
      await sql?.end({ timeout: 5 });
    },
  };
}
