# Session Progress Log

This file is committed to a public repository. Keep credentials, tokens, raw evidence, customer names and private conversations out of it.

## Current State

**Last Updated:** 2026-11-02 (Africa/Lagos)
**Active Feature:** `feat-006`, activity collection, built on `feat-012` in a stack of branches at the owner's request. `feat-005` and `feat-012` are merged but not deployed. `feat-003` still needs one real declaration from a customer site. `feat-002`, `feat-004` and `feat-011` are done.

The package is `0.4.0` on the `feat-006` branch; `main` has `0.3.0`, which isn't deployed, and published `0.1.0` assets are unchanged. The hosted collector now loads sites from the dedicated Supabase project, customers own products and environments through an owner API, and the dashboard is live for signup, install instructions, origins, DNS verification and secret rotation on a product's production environment.

## Status

### What's Done

- [x] Agent harness added and verified (`feat-001`).
- [x] Open product decisions resolved with the owner, except numeric pilot targets. See `decisions` in `feature_list.json`.
- [x] Dedicated Supabase project migrated, with the existing sites imported unchanged.
- [x] Hosted collector moved to the new code and database, and hosted smoke checks passed.
- [x] Dashboard deployed at https://parallel-agent-dashboard.vercel.app, with Supabase redirects set.
- [x] Removed the collector's demo page, its React copy and the local `public-demo` site, and deployed the change on 2 November. The live collector's root URL now returns 404.
- [x] Install status (`feat-004`) and the dashboard's Dashboard tab deployed on 2 November, after the `install_activity` migration reached the production database.

### What's In Progress

- [ ] Confirming the generated snippet on a real customer site (`feat-003`).
- [ ] Activity event contract (`feat-005`): built and tested locally, not yet deployed. It adds the `activity_events` migration, which must reach the production database before the collector deploys.
- [ ] Activity collection (`feat-006`): built and tested locally, not deployed. The ticket app still runs SDK 0.1.0 from the hosted tarball, so its integration waits for 0.4.0 to be published.
- [ ] Web Bot Auth verification (`feat-012`): built and tested locally, not yet deployed. Its `add_signature_events` migration follows feat-005's. No signer or CDN is supported until a real request through it is verified on the hosted collector.

### What's Next

1. Confirm a declaration from a real site and mark `feat-003` done.
2. Decide when to clear the old collector data and retire its settings, as listed under risks. This now includes the unused hosted `public-demo` site.
3. Start the activity event contract (`feat-005`), then Web Bot Auth verification (`feat-012`), activity collection and a dashboard view of the data.

## Blockers / Risks

- [ ] **Old collector data is no longer pruned**: the daily cleanup now runs against the new database, so records in the old one stay until they are removed by hand. Removing them also ends the option of rolling back to the old deployment.
- [ ] **Unused settings remain**: `AGENT_ID_SITES` on Vercel and the old database login stay in place until the rollback option is no longer needed.
- [ ] **Encryption key**: losing `AGENT_ID_ENCRYPTION_KEY` loses every site secret, so it needs a private backup.
- [ ] **Hosted email**: Supabase's built-in sender is heavily rate limited and may only reach organisation members, so external testers need custom SMTP.
- [ ] **Environments in the dashboard**: the API supports adding environments, but the dashboard shows production only until the switcher lands in `feat-007`.
- [ ] **Dashboard e2e tests are local only**: CI runs its typecheck, lint, unit tests and build, but not the Playwright journey.
- [ ] **Offline receipt checks during rotation**: a server on the new secret can't check a receipt signed with the old one, and the reverse. Online verification from a bound session works throughout.
- [ ] **The live widget shows to every visitor**: 0.1.0 puts a visible prompt in front of people, which conflicts with the agents-only goal. The install prompt and docs still describe that version, so it should not go on a real product. The owner shelved the invisible widget for Web Bot Auth (`feat-012`), which puts nothing on the page.
- [ ] **`feat-009` targets**: the owner's goal is 90–100% identification. No website-only method can promise that share of every agent, because an agent that only reads screenshots sees exactly what a person sees. The target needs a defined population and a baseline run before it is frozen or shown to a customer.
- [ ] **Web Bot Auth coverage**: signing is voluntary. The confirmed signers are cloud browsers such as ChatGPT agent's, and we found no sign that agents acting through a person's own browser sign, so their sessions stay unverified. See `docs/web-bot-auth.md`. The share of agent traffic that signs needs measuring with real traffic.
- [ ] **Firefox locally**: local startup failed on 21 October, so `./init.sh --full` runs Chromium and WebKit only. CI runs all three.
- [ ] **Silent-agent detection is unproven**: the MVP plan treats it as validation work (`feat-008`, `feat-009`), not as an existing capability.

## Decisions Made

- **Web Bot Auth instead of an invisible widget**
  - Context: the owner wants agents identified without showing people anything. Web Bot Auth checks agents that sign their requests, with nothing on the page, and payment networks build on it. `feat-012` now covers it, including a CDN's signed-agent verdict, and comes straight after the event contract (`feat-005`). The collector checks signatures, because browser code can't read request headers and one implementation should serve every backend. Heuristics for unsigned traffic stay in `feat-008`.
  - Alternatives considered: the invisible widget, which agents may still ignore and screen readers would hear; checking signatures in each customer's server, which needs a library per language; one feature for signatures and heuristics, which would hold Web Bot Auth back until activity collection is built.
- **The widget is for agents, never people**
  - Context: the owner wants every agent to meet it and no person to see it. The visible prompt in 0.1.0 is a research limitation: agents ignored the hidden version in the 7 October trials. The owner later shelved an invisible widget in favour of Web Bot Auth.
  - Alternatives considered: keeping one visible prompt for every visitor, which the owner rejected.
- **The collector's demo page is gone**
  - Context: the public site and docs replaced it, so the owner asked to remove it. The collector now serves the API, the SDK and `/trial/`, and its root URL returns 404.
  - Alternatives considered: redirecting the root URL to the public site, which nothing needs yet.
- **Install status comes only from what the collector received**
  - Context: an owner needs to know whether an install works. Copying a snippet proves nothing, so status changes only on a widget load from an allowed origin, a declaration, or a refusal. Session preflights from any HTTPS or local origin are answered, so a page on an unlisted origin can be traced to its site. The session itself is still refused.
  - Alternatives considered: matching refused origins to owners by domain, which would show one customer's traffic to anyone who lists the same domain.
- **One navbar across the public site, docs and dashboard**
  - Context: every page shares the same navigation, with Docs and Changelog on the left, a light and dark toggle, and a Dashboard button or account menu at the far right.
  - Alternatives considered: a separate dashboard header, which hid the docs and needed its own toggle.
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
- [x] After the demo removal on 2 November, hosted smoke checks passed 9 checks, with 7/7 sessions revoked. The cross-origin fixture check still covers the widget's reset.
- [x] Moved sites: each secret and origin matched the previous live collector, and stored secrets are encrypted.
- [x] A forged token was rejected with 401, which shows the collector reaches Supabase's signing keys.
- [x] Published SDK files match the frozen `0.1.0` release.
- [x] `./init.sh`: 108/108 tests and 3/3 dashboard unit tests. The last `--full` run had 48/48 SDK browser tests and 24/24 dashboard journey tests.
- [x] First real account: signed up, confirmed its email, signed in and created a product on the hosted service.
- [ ] Not run: a declaration from a real customer site, a real domain verified end to end, and any trial of an agent using this harness.

## Notes for Next Session

Vercel marks collector settings as sensitive, so they can't be read back. The Supabase CLI link in this repository points at the research project, so always pass `--db-url` for the customer project. Connection details stay in private configuration and are never copied into this repository.
