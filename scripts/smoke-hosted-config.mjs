import { parseArgs } from "node:util";

export const usage =
  "Usage: npm run smoke:hosted -- https://collector.example --site YOUR-FIXTURE-SITE-ID --origin https://fixture.example [--origin https://alternate.fixture.example]";

function httpsOrigin(raw, label) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${label} must be an HTTPS origin.`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `${label} must be an HTTPS origin without credentials, a path, query, or fragment.`,
    );
  }
  return url.origin;
}

export function parseSmokeConfig(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      site: { type: "string" },
      origin: { type: "string", multiple: true },
    },
  });
  if (positionals.length !== 1 || !values.site || !values.origin?.length) {
    throw new Error(usage);
  }
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(values.site)) {
    throw new Error("Fixture site ID must contain 1–100 letters, numbers, underscores or hyphens.");
  }
  const baseUrl = httpsOrigin(positionals[0], "Collector URL");
  const origins = [
    ...new Set(values.origin.map((origin) => httpsOrigin(origin, "Fixture origin"))),
  ];
  if (origins[0] === baseUrl) {
    throw new Error(
      "The first fixture origin must differ from the collector for cross-origin checks.",
    );
  }
  return { baseUrl, siteId: values.site, origins };
}
