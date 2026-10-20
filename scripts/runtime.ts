import postgres from "postgres";
import { createCollector } from "../collector/index.js";
import { MemoryStore } from "../collector/store.js";
import { PostgresStore, postgresExecutor } from "../collector/postgres-store.js";

export const DEMO_SECRET = "test-only-secret-not-for-production-00000001";
export function createRuntime(options: { demo?: boolean; vercel?: boolean } = {}) {
  const demo = options.demo === true;
  if (demo && (process.env.VERCEL || process.env.NODE_ENV === "production"))
    throw Error("Memory demo is local-only");
  const sites = demo
    ? [
        {
          id: "demo-site",
          origins: ["http://127.0.0.1:4311", "http://127.0.0.1:4312"],
          secret: DEMO_SECRET,
        },
        {
          id: "public-demo",
          origins: ["http://127.0.0.1:4310"],
          secret: DEMO_SECRET,
        },
        {
          id: "agent-trials",
          origins: ["http://127.0.0.1:4310"],
          secret: DEMO_SECRET,
        },
      ]
    : JSON.parse(process.env.AGENT_ID_SITES ?? "null");
  if (!Array.isArray(sites) || sites.length === 0) throw Error("Configure AGENT_ID_SITES");
  if (!demo && (!process.env.DATABASE_URL || !process.env.PRUNE_SECRET))
    throw Error("Configure DATABASE_URL and PRUNE_SECRET");
  if (!demo && sites.some((s: { secret?: string }) => s.secret?.startsWith("test-only")))
    throw Error("Test secrets cannot be deployed");
  const sql = demo
    ? null
    : postgres(process.env.DATABASE_URL!, {
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
  const handler = createCollector({
    sites,
    store: sql ? new PostgresStore(postgresExecutor(sql)) : new MemoryStore(),
    production: !demo,
    pruneSecret: demo ? DEMO_SECRET : process.env.PRUNE_SECRET,
    // This header is trusted only inside the Vercel deployment. Do not enable for generic hosting.
    ...(options.vercel
      ? {
          trustedClientKey: (request: Request) =>
            request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() || "unknown",
        }
      : {}),
    ...(demo ? { rateLimit: { windowSeconds: 60, maxSessions: 2000, maxDeclarations: 2000 } } : {}),
  });
  return {
    handler,
    close: async () => {
      await sql?.end({ timeout: 5 });
    },
  };
}
