# Session Handoff

## Current Objective

- Goal: Finish the first real signup, then build the analytics MVP in `feature_list.json` order.
- Current status: The hosted collector and dashboard are live. No real account has used them yet.
- Branch / commit: `docs/production-move`, based on `f9397a7`.

## Completed This Session

- [x] Moved the hosted collector to the dedicated Supabase project, keeping existing site IDs and secrets.
- [x] Deployed the dashboard and set Supabase redirects.
- [x] Fixed a production-only JSON parameter bug and added real-driver tests.

## Verification Evidence

| Check             | Command                | Result  | Notes                             |
| ----------------- | ---------------------- | ------- | --------------------------------- |
| Hosted collector  | `npm run smoke:hosted` | Pass    | 12 checks, 10/10 sessions revoked |
| Collector         | `npm test`             | Pass    | 108/108                           |
| Harness structure | `validate-harness.mjs` | 100/100 | Structural score only             |

## Files Changed

- `feature_list.json`, `progress.md`, `session-handoff.md`, `docs/operations.md`

## Decisions Made

- See `decisions` in `feature_list.json` and the list in `progress.md`.

## Blockers / Risks

- The old collector database is no longer pruned, and it stays in place for rollback until the owner decides.
- No real account has completed the hosted journey.

## Next Session Startup

1. Read `AGENTS.md`.
2. Read `feature_list.json` and `progress.md`.
3. Review this handoff.
4. Run `./init.sh` before editing.

## Recommended Next Step

- Ask how the owner's first hosted signup went. If it worked, mark `feat-002` and `feat-003` done and start `feat-004`.
