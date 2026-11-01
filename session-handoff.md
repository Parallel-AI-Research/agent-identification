# Session Handoff

## Current Objective

- Goal: Build the analytics MVP in `feature_list.json` order.
- Current status: Product decisions recorded. No MVP feature has started.
- Branch / commit: based on `185e4d0`.

## Completed This Session

- [x] Resolved the open product decisions with the owner, except numeric pilot targets.
- [x] Created a dedicated Supabase project for the customer product.

## Verification Evidence

| Check             | Command                | Result  | Notes                                  |
| ----------------- | ---------------------- | ------- | -------------------------------------- |
| Repository checks | `./init.sh`            | Pass    | 60/60 tests                            |
| Harness structure | `validate-harness.mjs` | 100/100 | Structural score only                  |
| Supabase project  | `supabase projects`    | Healthy | Empty; the collector has not moved yet |

## Files Changed

- `feature_list.json`, `progress.md`, `session-handoff.md`

## Decisions Made

- See `decisions` in `feature_list.json` and the list in `progress.md`.

## Blockers / Risks

- `feat-009` stays blocked until a baseline run gives it numeric targets.
- Moving the collector schema must keep the demo, trial and ticket-app installs working.

## Next Session Startup

1. Read `AGENTS.md`.
2. Read `feature_list.json` and `progress.md`.
3. Review this handoff.
4. Run `./init.sh` before editing.

## Recommended Next Step

- Start `feat-002`, beginning with moving sites from the `AGENT_ID_SITES` environment variable into the database.
