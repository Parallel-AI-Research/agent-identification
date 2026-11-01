# Session Progress Log

This file is committed to a public repository. Keep credentials, tokens, raw evidence, customer names and private conversations out of it.

## Current State

**Last Updated:** 2026-11-01 (Africa/Lagos)
**Active Feature:** `feat-003`. `feat-002` is done. The first real signup worked and found two dashboard bugs, whose fixes need deploying.

The package is still `0.1.0`, and `src/` is unchanged. The hosted collector now loads sites from the dedicated Supabase project, customers own products and environments through an owner API, and the dashboard is live for signup, install instructions, origins, DNS verification and secret rotation on a product's production environment.

## Status

### What's Done

- [x] Agent harness added and verified (`feat-001`).
- [x] Open product decisions resolved with the owner, except numeric pilot targets. See `decisions` in `feature_list.json`.
- [x] Dedicated Supabase project migrated, with the existing sites imported unchanged.
- [x] Hosted collector moved to the new code and database, and hosted smoke checks passed.
- [x] Dashboard deployed at https://parallel-agent-dashboard.vercel.app, with Supabase redirects set.

### What's In Progress

- [ ] Deploying the two dashboard fixes, then confirming the generated snippet on a real customer site.

### What's Next

1. Merge and deploy the dashboard fixes, confirm a declaration from a real site, then mark `feat-003` done.
2. Decide when to clear the old collector data and retire its settings, as listed under risks.
3. Continue in the order that unblocks the first real customer install: `feat-004`, then activity collection, then a dashboard view of the data.

## Blockers / Risks

- [ ] **Old collector data is no longer pruned**: the daily cleanup now runs against the new database, so records in the old one stay until they are removed by hand. Removing them also ends the option of rolling back to the old deployment.
- [ ] **Unused settings remain**: `AGENT_ID_SITES` on Vercel and the old database login stay in place until the rollback option is no longer needed.
- [ ] **Encryption key**: losing `AGENT_ID_ENCRYPTION_KEY` loses every site secret, so it needs a private backup.
- [ ] **Hosted email**: Supabase's built-in sender is heavily rate limited and may only reach organisation members, so external testers need custom SMTP.
- [ ] **Environments in the dashboard**: the API supports adding environments, but the dashboard shows production only until the switcher lands in `feat-007`.
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

- `feature_list.json`, `progress.md`, `session-handoff.md` - hosted evidence and next steps.
- `docs/operations.md` - deployment traps found during the move.

## Evidence of Completion

- [x] Hosted smoke checks: 12 checks passed against the live address, with 10/10 sessions revoked.
- [x] Moved sites: each secret and origin matched the previous live collector, and stored secrets are encrypted.
- [x] A forged token was rejected with 401, which shows the collector reaches Supabase's signing keys.
- [x] Published SDK files match the frozen `0.1.0` release.
- [x] `./init.sh`: 108/108 tests and 3/3 dashboard unit tests. The last `--full` run had 48/48 SDK browser tests and 10/10 dashboard journey tests.
- [x] First real account: signed up, confirmed its email, signed in and created a product on the hosted service.
- [ ] Not run: a declaration from a real customer site, a real domain verified end to end, and any trial of an agent using this harness.

## Notes for Next Session

Vercel marks collector settings as sensitive, so they can't be read back. The Supabase CLI link in this repository points at the research project, so always pass `--db-url` for the customer project. Connection details stay in private configuration and are never copied into this repository.
