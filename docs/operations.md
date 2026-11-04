# Collector operations

## Provision

The reference deployment is a Vercel Node function backed by PostgreSQL. It
shares no Auth sessions, accounts, tickets or research tables with the research
app. A separate schema and restricted role let it use an existing database.

1. Apply everything in `supabase/migrations/` in order, using an administrator.
   This creates the private `agent_identification` schema, the customer product
   tables and a restricted `agent_id_app` role with no login/password.
2. Give that role a random password and enable `LOGIN` through your database
   operator tooling. Never save the password in a migration or Git.
3. Set `DATABASE_URL` to its transaction-pooler connection and provide your
   database's CA as `DATABASE_SSL_CA` when needed. TLS verification stays enabled.
4. Set `AGENT_ID_ENCRYPTION_KEY` to 32 random base64url bytes
   (`openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`). It encrypts site
   secrets at rest, so keep a private backup: losing it loses every site secret.
5. Set `SUPABASE_URL` to the project whose sign-ins own products. The collector
   only reads that project's public signing keys.
6. Customers create their own sites through the owner API. To add an operator
   site, which no customer owns, generate and import it:

   ```sh
   mkdir -p .local
   npm run site:create -- --id your-site-id \
     --origin https://your-website.example \
     --origin https://www.your-website.example \
     --out .local/your-site.json
   npm run sites:import -- --file .local/your-site.json
   ```

   Each site becomes the production environment of a product no customer owns. The
   import keeps site IDs and secrets, so existing installs keep working, and it
   skips sites that already exist. It also reads a JSON array from
   `AGENT_ID_SITES`. Keep these files and values private. Provide only the public
   site ID and collector URL to browser installations.

7. Set `PRUNE_SECRET` to a different random value, and `CRON_SECRET` to that same
   value for Vercel's authenticated cron request. Disable the local memory fixture
   with `AGENT_ID_DEMO=false`.
8. Deploy this repository. `vercel.json` builds the package, versioned script/CSS
   and npm tarball. Route `/v1/*`, `/internal/*` and `/health` to the function.

Set the production and preview environments separately. Do not reuse the known
local demo secret. The runtime refuses memory storage in production. Restrict
preview access while setting up.

Site changes reach running instances within about 30 seconds, because lookups are
cached briefly to keep public traffic away from the database. No wildcard origin or credentialed cross-origin cookie requests are used.
The public site ID and `Origin` checks are not proof that a request is legitimate:
non-browser clients can copy both. All declarations remain self-reported.

## Dashboard

The customer dashboard is a separate Vercel project with its root directory set to
`dashboard/`. It holds no database credentials; the collector's owner API enforces
ownership.

1. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `COLLECTOR_URL` and `SITE_URL` as listed in `dashboard/.env.example`. Deploy with
   `vercel deploy --prod` from `dashboard/`.
2. In the Supabase project, set the site URL to the dashboard's URL and allow
   `SITE_URL/auth/confirm` as a redirect, with and without `?next=/reset-password`.
3. Configure custom SMTP before external testing. Supabase's built-in email sender
   is heavily rate limited.

`vercel link` can connect the project to the Git repository. A push to `main` then
deploys the repository root, which breaks the dashboard, so run `vercel git disconnect`
afterwards unless the project's root directory is set to `dashboard`.

`supabase config push` applies its changes without asking when it isn't run in a
terminal, even if piped answers say no. It also reads `supabase/config.toml` from the
current folder, and this repository's copy holds local-only values. Never run it from
here against a hosted project.

## Logs and retention

The collector's stored event is the recording evidence. Export the newest events
from your server or terminal:

```sh
# Set AGENT_ID_SITE_SECRET through your secret manager/environment.
npm run events -- --api https://YOUR-COLLECTOR --site YOUR-SITE-ID --limit 100
```

The server-only event endpoint rejects browser `Origin` requests and requires
the site's secret. The browser's public ID cannot export events. Exports omit
receipt, token and binding hashes. Keep local exports outside Git.

`GET /health` checks storage and returns version/status without credentials.
Database errors return a generic service error; they never become a successful
recording. The widget exposes failures and offers retry.

The Vercel cron runs daily at 03:00 UTC. `/internal/prune` requires the prune
secret as bearer authentication and deletes sessions older than seven days,
activity events older than 30, and products deleted more than 30 days ago, with
everything their sites recorded.
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
and online verification. It is not a browser API key. Customers rotate it from
the dashboard: the new secret is shown once, the old one keeps working for 24
hours so their deployment can catch up, and revoking it ends it sooner. Both take
effect within about 30 seconds because of site caching. Rotating operator sites
has no dashboard path. Rotate the database login separately through your database
operator tooling.

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

Published v0.1.0 and v0.5.0 are archived in `releases/v0.1.0/` and
`releases/v0.5.0/`; versions 0.2.0 to 0.4.0 were never deployed. Builds validate
each archive's checksums and restore the exact published SDK, tarball and
manifests. Each archived tarball keeps its original README, including historical
installation instructions; the current public docs and source documentation
contain the updated instructions.
Do not edit the archive to update documentation. SDK source, compiled output or
package metadata changes under the frozen version fail the build/release; bump
the SDK version for those changes. Repository README and build/test script edits
can ship without replacing the published package. Package checks install the
preserved tarball that deployment actually serves.

Each archive also keeps the release's source in `releases/v<version>/src/`, matching
the hashes in `frozen.json`, so tests can rebuild the published bytes after the
working source has moved on. Freeze a new version the same way once it is
deployed: retrieve its published files, archive its source, record the hashes and
add the version to `frozenVersions` in `scripts/frozen-releases.mjs`.

Keep each frozen version in `scripts/frozen-releases.mjs` and retain its archive
when publishing a newer version. Missing or corrupt archives fail instead of
silently repacking. `/downloads/release.json` describes the current version, so
`vercel.json` caches it for five minutes, while the versioned tarballs and SDK
files are immutable for a year. A cache may still hold the 0.1.0 manifest it
stored under the old immutable policy. Install from the versioned tarball URL,
which never changes.
