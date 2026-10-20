import { parseArgs } from "node:util";
const { values } = parseArgs({
  options: {
    api: { type: "string" },
    site: { type: "string" },
    limit: { type: "string", default: "100" },
  },
});
const secret = process.env.AGENT_ID_SITE_SECRET;
if (!values.api || !values.site || !secret)
  throw Error(
    "Usage: AGENT_ID_SITE_SECRET in environment; npm run events -- --api HTTPS_URL --site SITE_ID [--limit 100]",
  );
const base = new URL(values.api);
if (
  base.username ||
  base.password ||
  base.search ||
  base.hash ||
  (base.protocol !== "https:" &&
    !(base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname)))
)
  throw Error("HTTPS required, without credentials, query or fragment");
const url = new URL("/v1/events", base);
url.searchParams.set("siteId", values.site);
url.searchParams.set("limit", values.limit);
const r = await fetch(url, {
  headers: { Authorization: `Bearer ${secret}` },
  redirect: "error",
  signal: AbortSignal.timeout(15000),
});
if (!r.ok) throw Error(`Event export failed: HTTP ${r.status}`);
console.log(JSON.stringify(await r.json(), null, 2));
