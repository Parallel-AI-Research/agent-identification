import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
const { values } = parseArgs({
  options: {
    id: { type: "string" },
    origin: { type: "string", multiple: true },
    out: { type: "string" },
  },
});
if (
  !values.id ||
  !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(values.id) ||
  !values.origin?.length ||
  !values.out
)
  throw Error(
    "Usage: npm run site:create -- --id parallel --origin https://example.com --out .local/site.json",
  );
for (const raw of values.origin) {
  const u = new URL(raw);
  if (
    u.origin !== raw ||
    (u.protocol !== "https:" &&
      !(u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname)))
  )
    throw Error("Provide exact HTTPS origins (localhost HTTP for development)");
}
await writeFile(
  values.out,
  JSON.stringify(
    {
      id: values.id,
      origins: [...new Set(values.origin)],
      secret: randomBytes(32).toString("base64url"),
    },
    null,
    2,
  ) + "\n",
  { mode: 0o600, flag: "wx" },
);
console.log(
  "Private site configuration written. Put only the id and collector URL in browser code.",
);
