# Session Handoff

## Current Objective

- Goal: Finish the first real signup, then build the analytics MVP in `feature_list.json` order.
- Current status: Everything through the pilot release is merged and deployed, with SDK 0.5.0 published and frozen. ChatGPT Work's cloud browser verified on the hosted collector on 4 November, so it's the first supported signer. Activity collection (`feat-006`) is done after its ticket app integration check, and the owner dashboard (`feat-007`) after a test for its error state. The pilot's other hosted checks remain. On 5 November the owner chose an install that shows visitors nothing, and defined the 90–100% target against agents we run ourselves. That server-first install went live on 6 November: its migration, the collector and the dashboard.
- Branch / commit: `sdk/page-script`, SDK 0.6.0's page script. Everything before it is merged into `main` and deployed.

## Completed This Session

- [x] Moved the hosted collector to the dedicated Supabase project, keeping existing site IDs and secrets.
- [x] Deployed the dashboard and set Supabase redirects.
- [x] Fixed a production-only JSON parameter bug and added real-driver tests.
- [x] Applied the `install_activity` migration to production and deployed the install status and the Dashboard tab.
- [x] Applied six more migrations on 3 November and deployed the activity, signed-agent, automation-signal and soft-deletion work, then froze SDK 0.5.0.
- [x] Moved the ticket app to SDK 0.5.0 on 4 November, with its proxy forwarding signed requests, and verified a real ChatGPT cloud browser request through it on the hosted collector.
- [x] Made the ticket app report its package-run saves as actions, and checked page views, declarations and saves in one collector session through its browser smoke check.
- [x] Covered the Activity page's error state with a browser test, using Next's test mode to make the collector fail for that test's requests only.
- [x] Corrected the Signed agents docs' Next.js example and checked it with a signed request on Next.js 16 and 15.5.
- [x] Made CI faster and ran the dashboard journeys in it.
- [x] Made server reporting the default install, with Status counting the server's reports, and moved the widget behind a warning.
- [x] Applied its migration to the customer project's database and deployed the collector, then the dashboard, on 6 November.
- [x] Built SDK 0.6.0's page script, which draws nothing, with its install step, Status lines, docs and journeys, and checked the generated snippets in real Next.js and Express apps.
- [x] Made the dashboard's CI job check `dashboard/` on its own, after the dashboard deploy failed on a test's import from outside it.

## Verification Evidence

| Check             | Command                           | Result  | Notes                                              |
| ----------------- | --------------------------------- | ------- | -------------------------------------------------- |
| Hosted collector  | `npm run smoke:hosted`            | Pass    | 10 checks, 7/7 sessions revoked on 3 November      |
| Real signer       | `GET /v1/activity?type=signature` | Pass    | ChatGPT agent, verified, on 4 November             |
| Ticket fixture    | `npm run test:package`            | Pass    | 15 scenarios, Chromium and WebKit, local collector |
| Hosted deploy     | `curl /health`, public pages      | Pass    | 6 November: 0.5.0 on Postgres, SDK files unchanged |
| Dashboard journey | `npx playwright test`             | Pass    | 34/34 on 6 November, Chromium and WebKit           |
| Full local check  | `./init.sh --full`                | Pass    | 199/199, 9/9, 64/64 SDK browser, build             |
| Harness structure | `validate-harness.mjs`            | 100/100 | Structural score only                              |

## Files Changed

- `src/browser/shared.ts`, `src/browser/track.ts`, `src/browser/track-script.ts`, `src/browser/index.ts`, `src/protocol.ts`
- `package.json`, `package-lock.json`, `scripts/build.mjs`, `scripts/example-server.ts`, `examples/track/`
- `tests/track.test.ts`, `tests/e2e/track.spec.ts`, `dashboard/tests/`
- `dashboard/lib/snippets.ts`, `dashboard/app/dashboard/products/[id]/`, `dashboard/app/(home)/page.tsx`
- `dashboard/content/docs/`, `dashboard/content/changelog/page-script.mdx`, `README.md`, `docs/protocol.md`
- `feature_list.json`, `progress.md`, `session-handoff.md`

## Decisions Made

- See `decisions` in `feature_list.json` and the list in `progress.md`.

## Blockers / Risks

- The old collector database is no longer pruned, and it stays in place for rollback until the owner decides.
- Server reports don't join the page script's sessions yet. The owner chose to link them through the page's response, with no cookie.
- No real customer site runs the install yet.
- The unused `public-demo` site is still in the hosted database, waiting for the owner's cleanup decision.

## Next Session Startup

1. Read `AGENTS.md`.
2. Read `feature_list.json` and `progress.md`.
3. Review this handoff.
4. Run `./init.sh` before editing.

## Recommended Next Step

- Once `sdk/page-script` merges, deploy the collector, then the dashboard, check the published 0.1.0 and 0.5.0 files, and freeze 0.6.0 in `releases/`.
- Then link server reports to the page script's sessions through the page's response, checking first that Chromium, WebKit and Firefox expose it.
- Plan `feat-009`'s test matrix and baseline run.
- The owner's hosted checks in `docs/pilot.md` and a CDN verdict for `feat-012` still need their accounts.
