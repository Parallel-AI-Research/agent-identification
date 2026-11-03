# Session Handoff

## Current Objective

- Goal: Finish the first real signup, then build the analytics MVP in `feature_list.json` order.
- Current status: The hosted collector, dashboard, public site, docs and changelog are live, including the install status (`feat-004`). The activity event contract (`feat-005`) and SDK 0.2.0 are built and tested locally, not deployed. `feat-003` waits on a real site recording a declaration.
- Branch / commit: `feat/activity-collection`, based on `feat/web-bot-auth`, which is merged.

## Completed This Session

- [x] Moved the hosted collector to the dedicated Supabase project, keeping existing site IDs and secrets.
- [x] Deployed the dashboard and set Supabase redirects.
- [x] Fixed a production-only JSON parameter bug and added real-driver tests.
- [x] Applied the `install_activity` migration to production and deployed the install status and the Dashboard tab.

## Verification Evidence

| Check             | Command                | Result  | Notes                                        |
| ----------------- | ---------------------- | ------- | -------------------------------------------- |
| Hosted collector  | `npm run smoke:hosted` | Pass    | 9 checks, 7/7 sessions revoked on 2 November |
| Collector         | `npm test`             | Pass    | 132/132                                      |
| Dashboard journey | `npx playwright test`  | Pass    | 28/28 on merged main, Chromium and WebKit    |
| Harness structure | `validate-harness.mjs` | 100/100 | Structural score only                        |

## Files Changed

- `feature_list.json`, `progress.md`, `session-handoff.md`, `docs/operations.md`

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

- Mark `feat-003` done once a real site records a declaration. Then start the activity event contract (`feat-005`), or earlier if the owner approves, followed by Web Bot Auth verification (`feat-012`). `docs/web-bot-auth.md` has the research behind it.
