# Session Progress Log

This file is committed to a public repository. Keep credentials, tokens, raw evidence, customer names and private conversations out of it.

## Current State

**Last Updated:** 2026-11-01 (Africa/Lagos)
**Active Feature:** `feat-002` and `feat-003`. Both are built and pass locally, and neither is deployed.

The package is still `0.1.0`, and `src/` is unchanged. Sites now load from the database, customers own products and environments through an owner API, and `dashboard/` covers signup, install instructions, origins, DNS verification and secret rotation for a product's production environment.

## Status

### What's Done

- [x] Agent harness added and verified (`feat-001`).
- [x] Open product decisions resolved with the owner, except numeric pilot targets. See `decisions` in `feature_list.json`.
- [x] Dedicated Supabase project created, with the first three customer migrations applied. It holds no customer data.
- [x] Products now have environments. Each environment holds its own site ID, secret and origins.
- [x] `feat-002` and `feat-003` built and passing locally.

### What's In Progress

- [ ] Moving the hosted collector to the dedicated project, which needs the owner's approval because it changes a live service.
- [ ] Deploying the dashboard.

### What's Next

1. Review and merge the branch.
2. Apply `20261101140000_add_environments.sql` to the dedicated project, give the collector role a login there, and generate the encryption key.
3. Import the existing operator sites with `npm run sites:import`.
4. Update the collector's hosted settings, deploy it, and run the hosted smoke checks.
5. Deploy the dashboard, configure Supabase redirects and email, then run the journey with a real account.
6. Mark both features done, then continue in the order that unblocks the first real customer install: `feat-004`, then activity collection, then a dashboard view of the data.

## Blockers / Risks

- [ ] **Collector migration**: moving must keep the demo, trial and ticket-app installs working. Sessions and events in the old database do not move; visitor sessions last at most 30 minutes and events are kept for 7 days.
- [ ] **Environments in the dashboard**: the API supports adding environments, but the dashboard shows production only until the switcher lands in `feat-007`.
- [ ] **Encryption key**: losing `AGENT_ID_ENCRYPTION_KEY` loses every site secret, so it needs a private backup.
- [ ] **Hosted email**: Supabase's built-in sender is heavily rate limited, so external testers need custom SMTP.
- [ ] **Dashboard e2e tests are local only**: CI runs its typecheck, lint, unit tests and build, but not the Playwright journey.
- [ ] **Offline receipt checks during rotation**: a server on the new secret can't check a receipt signed with the old one, and the reverse. Online verification from a bound session works throughout.
- [ ] **`feat-009` targets**: numeric targets need a small baseline run first, so that feature stays blocked until then.
- [ ] **Web Bot Auth coverage**: signing is voluntary and agents driving a local browser probably will not sign, so many sessions will stay unknown. This needs testing with real traffic.
- [ ] **Firefox locally**: local startup failed on 21 October, so `./init.sh --full` runs Chromium and WebKit only. CI runs all three.
- [ ] **Silent-agent detection is unproven**: the MVP plan treats it as validation work (`feat-008`, `feat-009`), not as an existing capability.

## Decisions Made

- **Credentials belong to environments, not products**
  - Context: one product needs separate production, beta, staging and dev analytics, so each environment has its own site ID, secret and origins.
  - Alternatives considered: tagging events with an environment under one site ID, which would let dev traffic use production's credentials.
- **A product has at most one environment of each type**
  - Context: production can then be a dependable default, and the rule is easy to relax later.
  - Alternatives considered: several environments of one type, which adds ambiguity with no current need.
- **The product is for any software**
  - Context: each customer names their own actions, and the ticket app is only an integration fixture.
  - Alternatives considered: none. Check designs against non-Node and API-only products.
- **Server reporting is a plain HTTP endpoint with a Node helper on top**
  - Context: products on other languages must be able to report actions without our package.
  - Alternatives considered: Node helper only, Next.js middleware, Cloudflare Worker and Vercel BotID. SDKs in other languages are a likely later step, wrapping the same endpoint.
- **Domain verification does not block events**
  - Context: the first event should arrive quickly, so unverified domains are labelled instead.
  - Alternatives considered: requiring DNS first, an HTML file check that needs SSRF protection, and skipping verification.
- **Open product decisions block features instead of being assumed**
  - Context: the MVP plan says these must not be silently treated as requirements.
  - Alternatives considered: separate decision-only features, which added entries without adding any enforcement.
- **`./init.sh` skips `npm ci` when dependencies are current**
  - Context: `npm ci` deletes `node_modules`, which would break anything running from it during a session restart.
  - Alternatives considered: always running `npm ci`, as CI does on a clean checkout.
- **`AGENTS.md` stays the single instruction file**
  - Context: `CLAUDE.md` imports it, so Codex and Claude Code read the same rules.
  - Alternatives considered: separate instruction files, which would drift apart.

The remaining product decisions are recorded per feature under `decisions` in `feature_list.json`.

## Files Modified This Session

- `collector/` - database-backed sites, owner API, token verification, rotation and DNS checks.
- `dashboard/` - new customer dashboard.
- `supabase/` - two migrations and local stack configuration.
- `scripts/`, `init.sh`, CI and docs - site import, dashboard checks and deployment steps.

## Evidence of Completion

- [x] `./init.sh --full`: 95/95 tests, 3/3 dashboard unit tests, 48/48 SDK browser tests and 6/6 dashboard browser tests.
- [x] Real database: the first three customer migrations applied, with forced row-level security on all tables. The environments migration has only run locally.
- [x] Real DNS: lookups through public resolvers return in about half a second, and a missing record in under 200ms.
- [x] Harness validator: 100/100. This is a structural score, not a measure of agent effectiveness.
- [ ] Not run: hosted smoke checks, any hosted signup, a real domain verified end to end, and any trial of an agent using this harness.

## Notes for Next Session

Production steps need the owner's approval. The Supabase CLI link in this repository points at the research project, so always pass `--db-url` for the customer project. Connection details stay in private configuration and are never copied into this repository.
