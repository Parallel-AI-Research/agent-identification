# Session Progress Log

This file is committed to a public repository. Keep credentials, tokens, raw evidence, customer names and private conversations out of it.

## Current State

**Last Updated:** 2026-11-04 (Africa/Lagos)
**Active Feature:** `feat-010`, the pilot release, merged and deployed on 3 November with `feat-005` to `feat-008` and `feat-012`. On 4 November ChatGPT Work's cloud browser became the first signer verified on the hosted collector, and activity collection (`feat-006`) was verified through the ticket app. The owner dashboard (`feat-007`) is done after its error state got a test. The other hosted checks and a new-account onboarding remain. `feat-009` is blocked on defining the 90–100% target, and `feat-003` still needs one real declaration from a customer site. `feat-002`, `feat-004`, `feat-005`, `feat-006`, `feat-007` and `feat-011` are done.

SDK `0.5.0` is published and frozen in `releases/v0.5.0/`, and published `0.1.0` assets are unchanged. Versions 0.2.0 to 0.4.0 were never deployed. The hosted collector loads sites from the dedicated Supabase project, customers own products and environments through an owner API, and the dashboard covers signup, install instructions, environments, activity, signed agents, origins, DNS verification, secret rotation and soft deletion.

## Status

### What's Done

- [x] Agent harness added and verified (`feat-001`).
- [x] Open product decisions resolved with the owner, except numeric pilot targets. See `decisions` in `feature_list.json`.
- [x] Dedicated Supabase project migrated, with the existing sites imported unchanged.
- [x] Hosted collector moved to the new code and database, and hosted smoke checks passed.
- [x] Dashboard deployed at https://parallel-agent-dashboard.vercel.app, with Supabase redirects set.
- [x] Removed the collector's demo page, its React copy and the local `public-demo` site, and deployed the change on 2 November. The live collector's root URL now returns 404.
- [x] Install status (`feat-004`) and the dashboard's Dashboard tab deployed on 2 November, after the `install_activity` migration reached the production database.
- [x] Activity contract and collection, the owner dashboard, automation signals, Web Bot Auth and soft deletion deployed on 3 November, after six migrations reached the production database. SDK 0.5.0 is published and frozen, and the activity event contract (`feat-005`) is done.
- [x] Activity collection (`feat-006`) verified with the ticket app as its integration fixture on 4 November. Page views and the app's reported ticket saves, rejected and confirmed, share one collector session for both unanswered and declared runs, in Chromium and WebKit.
- [x] Owner dashboard (`feat-007`) done on 4 November, once a browser test covered its error state. It was deployed on 3 November, and the test changes no product behaviour.
- [x] Corrected the Next.js example in the Signed agents docs on 4 November. It now uses `proxy.ts` and passes the visitor's URL, and it verified a signed request on Next.js 16 and 15.5.
- [x] `/downloads/release.json` is cached for five minutes instead of a year, because it names the current version. Versioned tarballs and SDK files stay immutable. It went live with the collector redeploy on 4 November, and a cache may still hold the 0.1.0 manifest it stored earlier.
- [x] CI runs the dashboard journeys against a local Supabase stack, in Chromium and WebKit. Browser jobs run in Playwright's image, because installing browser system packages from Ubuntu's mirror took 21 to 35 minutes when it was slow. CI runs once per pull request push, cancels superseded runs and has job timeouts.

### What's In Progress

- [ ] Confirming the generated snippet on a real customer site (`feat-003`).
- [ ] Pilot release (`feat-010`): deployed. `npm run smoke:hosted` passed 10 checks on 3 November, and a real Web Bot Auth signer verified on 4 November. Its other hosted checks remain: delete, restore and Delete now on a test product, a second account kept out, and a new-account onboarding that the owner runs.
- [ ] Heuristic automation signals (`feat-008`): deployed. What each signal contributes with real traffic is validation work for `feat-009`.
- [ ] Web Bot Auth verification (`feat-012`): deployed. ChatGPT Work's cloud browser is supported, after a real request verified on the hosted collector on 4 November. No CDN verdict has been verified yet.

### What's Next

1. Confirm a declaration from a real site and mark `feat-003` done.
2. Decide when to clear the old collector data and retire its settings, as listed under risks. This now includes the unused hosted `public-demo` site.
3. Run the pilot's hosted checks, including a new-account onboarding, and record them in `feat-010`.
4. Verify a CDN verdict for `feat-012`.
5. Define what the 90–100% target is measured against, so validation (`feat-009`) can start.

## Blockers / Risks

- [ ] **Old collector data is no longer pruned**: the daily cleanup now runs against the new database, so records in the old one stay until they are removed by hand. Removing them also ends the option of rolling back to the old deployment.
- [ ] **Unused settings remain**: `AGENT_ID_SITES` on Vercel and the old database login stay in place until the rollback option is no longer needed.
- [ ] **Encryption key**: losing `AGENT_ID_ENCRYPTION_KEY` loses every site secret, so it needs a private backup.
- [ ] **Hosted email**: Supabase's built-in sender is heavily rate limited and may only reach organisation members, so external testers need custom SMTP.
- [ ] **Offline receipt checks during rotation**: a server on the new secret can't check a receipt signed with the old one, and the reverse. Online verification from a bound session works throughout.
- [ ] **The live widget shows to every visitor**: 0.1.0 puts a visible prompt in front of people, which conflicts with the agents-only goal. The install prompt and docs still describe that version, so it should not go on a real product. The owner shelved the invisible widget for Web Bot Auth (`feat-012`), which puts nothing on the page.
- [ ] **`feat-009` targets**: the owner's goal is 90–100% identification. No website-only method can promise that share of every agent, because an agent that only reads screenshots sees exactly what a person sees. The target needs a defined population and a baseline run before it is frozen or shown to a customer.
- [ ] **Web Bot Auth coverage**: signing is voluntary. The confirmed signers are cloud browsers such as ChatGPT Work's, and we found no sign that agents acting through a person's own browser sign, so their sessions stay unverified. Even ChatGPT signs only from its cloud browser: two of its three visits on 4 November arrived unsigned. See `docs/web-bot-auth.md`. The share of agent traffic that signs needs measuring with real traffic.
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

- `feature_list.json`, `progress.md`, `session-handoff.md` - `feat-006` done after the ticket app integration check.
- `dashboard/tests/e2e/onboarding.spec.ts`, `dashboard/next.config.mjs`, `dashboard/README.md` - a browser test for the Activity page's error state, using Next's test mode in `next dev` only. `feat-007` done.
- `dashboard/content/docs/signed-agents.mdx`, `dashboard/content/changelog/nextjs-signed-agents.mdx` - the corrected Next.js example and its changelog post.
- `vercel.json`, `docs/operations.md` - a five-minute cache for `/downloads/release.json`.
- `feature_list.json`, `progress.md`, `session-handoff.md` - the 4 November collector redeploy recorded in `feat-010`.
- `.github/workflows/check.yml`, `dashboard/playwright.config.ts`, `docs/operations.md` - faster CI, and the dashboard journeys in CI.

## Evidence of Completion

- [x] Hosted smoke checks: 12 checks passed against the live address, with 10/10 sessions revoked.
- [x] After the demo removal on 2 November, hosted smoke checks passed 9 checks, with 7/7 sessions revoked. The cross-origin fixture check still covers the widget's reset.
- [x] Moved sites: each secret and origin matched the previous live collector, and stored secrets are encrypted.
- [x] A forged token was rejected with 401, which shows the collector reaches Supabase's signing keys.
- [x] Published SDK files match the frozen `0.1.0` release.
- [x] On 3 November, after the deploy, hosted smoke checks passed 10 checks with 7/7 sessions revoked.
- [x] On 3 November, after the deploy, `/health` reported 0.5.0 on Postgres, the 0.1.0 files still matched `frozen.json`, and the published 0.5.0 files matched a local build byte for byte.
- [x] `./init.sh`: 108/108 tests and 3/3 dashboard unit tests. The last `--full` run had 48/48 SDK browser tests and 24/24 dashboard journey tests.
- [x] First real account: signed up, confirmed its email, signed in and created a product on the hosted service.
- [x] On 4 November, ChatGPT Work's cloud browser loaded the ticket app's `/login` page, and the hosted collector recorded it as ChatGPT agent, verified. Two earlier ChatGPT visits arrived unsigned and recorded nothing.
- [x] On 4 November, the ticket app's package smoke check passed 15 scenarios in Chromium and WebKit against the local collector, including two that read the collector's activity export for page views, the declaration and reported saves.
- [x] On 4 November, `./init.sh --full` passed with 187/187 tests, 5/5 dashboard unit, 56/56 SDK browser tests, the dashboard build and 34/34 dashboard journey tests in Chromium and WebKit, including the new error-state journey.
- [x] On 4 November, the corrected Next.js example verified a request signed by the local test signer through the local collector: on Next.js 16 under `next dev` and `next start`, and on Next.js 15.5 under `next start`. The old example failed every request on Next.js 16, and `proxy.ts` without `url` recorded `wrong_authority` under both commands.
- [x] On 4 November, after the collector redeploy, `/health` reported 0.5.0 on Postgres, `release.json` answered with `public, max-age=300`, and the 0.1.0 and 0.5.0 SDK files, tarballs and manifests hashed the same as before the deploy and as their archives in `releases/`.
- [ ] Not run: a declaration from a real customer site, a real domain verified end to end, and any trial of an agent using this harness.

## Notes for Next Session

Vercel marks collector settings as sensitive, so they can't be read back. The Supabase CLI link in this repository points at the research project, so always pass `--db-url` for the customer project. Connection details stay in private configuration and are never copied into this repository.
