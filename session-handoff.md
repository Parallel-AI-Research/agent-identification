# Session Handoff

## Current Objective

- Goal: Finish the first real signup, then build the analytics MVP in `feature_list.json` order.
- Current status: The hosted collector, dashboard, public site, docs and changelog are live, and the first real account has created a product.
- Branch / commit: `docs/feat-011-done`, based on `4a9f31b`.

## Completed This Session

- [x] Moved the hosted collector to the dedicated Supabase project, keeping existing site IDs and secrets.
- [x] Deployed the dashboard and set Supabase redirects.
- [x] Fixed a production-only JSON parameter bug and added real-driver tests.

## Verification Evidence

| Check             | Command                | Result  | Notes                                        |
| ----------------- | ---------------------- | ------- | -------------------------------------------- |
| Hosted collector  | `npm run smoke:hosted` | Pass    | 9 checks, 7/7 sessions revoked on 2 November |
| Collector         | `npm test`             | Pass    | 108/108                                      |
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

- Confirm a declaration from a real site, mark `feat-003` done, then start `feat-004`.
