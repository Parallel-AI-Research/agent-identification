# Session Handoff

## Current Objective

- Goal: Finish the first real signup, then build the analytics MVP in `feature_list.json` order.
- Current status: Everything through the pilot release is merged and deployed, with SDK 0.5.0 published and frozen. ChatGPT Work's cloud browser verified on the hosted collector on 4 November, so it's the first supported signer. Activity collection (`feat-006`) is done after its ticket app integration check, and the owner dashboard (`feat-007`) after a test for its error state. The pilot's other hosted checks remain, and `feat-003` waits on a real site recording a declaration.
- Branch / commit: `docs/nextjs-signed-requests-dev`, which corrects the Next.js example in the Signed agents docs. Everything before it is merged into `main`, including ticket-management#4.

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

## Verification Evidence

| Check             | Command                           | Result  | Notes                                              |
| ----------------- | --------------------------------- | ------- | -------------------------------------------------- |
| Hosted collector  | `npm run smoke:hosted`            | Pass    | 10 checks, 7/7 sessions revoked on 3 November      |
| Real signer       | `GET /v1/activity?type=signature` | Pass    | ChatGPT agent, verified, on 4 November             |
| Ticket fixture    | `npm run test:package`            | Pass    | 15 scenarios, Chromium and WebKit, local collector |
| Hosted deploy     | `curl /health`                    | Pass    | 0.5.0 on Postgres, 0.1.0 files unchanged           |
| Collector         | `npm test`                        | Pass    | 132/132                                            |
| Dashboard journey | `npx playwright test`             | Pass    | 34/34 on 4 November, Chromium and WebKit           |
| Full local check  | `./init.sh --full`                | Pass    | 187/187, 5/5, 56/56 SDK browser, build             |
| Harness structure | `validate-harness.mjs`            | 100/100 | Structural score only                              |

## Files Changed

- `feature_list.json`, `progress.md`, `session-handoff.md`
- `dashboard/tests/e2e/onboarding.spec.ts`, `dashboard/next.config.mjs`, `dashboard/README.md`
- `dashboard/content/docs/signed-agents.mdx`, `dashboard/content/changelog/nextjs-signed-agents.mdx`

## Decisions Made

- See `decisions` in `feature_list.json` and the list in `progress.md`.

## Blockers / Risks

- The old collector database is no longer pruned, and it stays in place for rollback until the owner decides.
- The generated snippet has not recorded a declaration on a real customer site yet.
- The unused `public-demo` site is still in the hosted database, waiting for the owner's cleanup decision.

## Next Session Startup

1. Read `AGENTS.md`.
2. Read `feature_list.json` and `progress.md`.
3. Review this handoff.
4. Run `./init.sh` before editing.

## Recommended Next Step

- Run the remaining hosted checks in `docs/pilot.md`: delete, restore and Delete now on a test product, a second account kept out, and the new-account onboarding. Record them in `feat-010`.
- Verify a CDN's signed-agent verdict for `feat-012`.
- Give `/downloads/release.json` a short cache lifetime, as `progress.md` describes under risks.
