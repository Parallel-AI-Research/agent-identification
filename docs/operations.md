# Collector operations

## Provision

The reference deployment is a Vercel Node function backed by PostgreSQL. It
shares no Auth sessions, accounts, tickets or research tables with the research
app. A separate schema and restricted role let it use an existing database.

1. Apply `supabase/migrations/20261020093721_create_agent_identification_collector.sql`
   using an administrator. It creates the private `agent_identification` schema
   and a restricted `agent_id_app` role with no login/password.
2. Give that role a random password and enable `LOGIN` through your database
   operator tooling. Never save the password in a migration or Git.
3. Set `DATABASE_URL` to its transaction-pooler connection and provide your
   database's CA as `DATABASE_SSL_CA` when needed. TLS verification stays enabled.
4. Generate a site:

   ```sh
   mkdir -p .local
   npm run site:create -- --id parallel \
     --origin https://useparallel.com \
     --origin https://www.useparallel.com \
     --out .local/parallel-site.json
   ```

5. Set `AGENT_ID_SITES` to a JSON **array** of site objects. Keep the file and
   environment private. Provide only the public site ID and collector URL to
   browser installations.
6. Set `PRUNE_SECRET` to a different random value, and `CRON_SECRET` to that same
   value for Vercel's authenticated cron request. Disable the local memory fixture
   with `AGENT_ID_DEMO=false`.
7. Deploy this repository. `vercel.json` builds the package, versioned script/CSS
   and npm tarball. Route `/v1/*`, `/internal/*` and `/health` to the function.

Set the production and preview environments separately. Do not reuse the known
local demo secret. The runtime refuses memory storage in production. Restrict
preview access while setting up; a public demo needs its exact origin included
in a dedicated demo site's origins.

When adding another website, generate another site ID/secret and add its exact
origins. No wildcard origin or credentialed cross-origin cookie requests are used.
The public site ID and `Origin` checks are not proof that a request is legitimate:
non-browser clients can copy both. All declarations remain self-reported.

## Logs and retention

The collector's stored event is the recording evidence. Export the newest events
from your server or terminal:

```sh
# Set AGENT_ID_SITE_SECRET through your secret manager/environment.
npm run events -- --api https://YOUR-COLLECTOR --site parallel --limit 100
```

The server-only event endpoint rejects browser `Origin` requests and requires
the site's secret. The browser's public ID cannot export events. Exports omit
receipt, token and binding hashes. Keep local exports outside Git.

`GET /health` checks storage and returns version/status without credentials.
Database errors return a generic service error; they never become a successful
recording. The widget exposes failures and offers retry.

The Vercel cron runs daily at 03:00 UTC. `/internal/prune` requires the prune
secret as bearer authentication and deletes records older than seven days.
Requests also trigger bounded opportunistic pruning. A finite batch cannot erase
an arbitrary backlog in one pass; monitor/export as needed and run repeated
authenticated prune requests until the backlog is clear.

Rate limits use shared database buckets. The Vercel adapter trusts only Vercel's
own `x-vercel-forwarded-for` header. For another host, inject a key derived from
your trusted proxy, or accept the conservative shared site/origin bucket. Never
trust an arbitrary client-supplied forwarding header.

## Sessions and secrets

Unbound visitor sessions last up to 30 minutes; bound sessions expire no later
than their signed context (at most 15 minutes, five minutes by default).
Explicit reset revokes the previous session. Reset errors remain visible; do
not pretend a logout-related revocation succeeded if the service is unavailable.
Your own logout must invalidate the actual application session regardless.

Each site's secret signs its contexts/receipts and authenticates server exports
and online verification. It is not a browser API key. Rotating it invalidates
old signatures and export access. After rotation, start new widget sessions;
an already rendered choice is not an authorization decision. Rotate the database
login separately through your database operator tooling.

## Release

Run `npm run check` and `npm run test:e2e` before deployment. The package check
installs the actual tarball into an independent temporary consumer and verifies
ESM, TypeScript, optional React and SSR behavior.

The CI workflow repeats checks and all three browser engines. Keep the lockfile.
Bump both `package.json` version and `src/protocol.ts` VERSION for changes to
published assets; do not overwrite an already published version. SDK URLs are
versioned and cacheable. Preserve older version directories when upgrading a
collector that still serves them, or move immutable assets to durable object
storage/CDN before removing an older deployment.

`npm run build` prepares assets and declarations.
`node scripts/release.mjs` creates `public/downloads/*.tgz` plus a SHA-256/integrity
manifest. Installing that HTTPS URL uses normal npm package semantics; it does
not mean the package is published to npm's registry.
