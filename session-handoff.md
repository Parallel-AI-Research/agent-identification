# Session Handoff

## Current Objective

- Goal: Finish the first real signup, then build the analytics MVP in `feature_list.json` order.
- Current status: The hosted collector and dashboard are live, and the first real account has created a product. The agent setup panel is not deployed yet.
- Branch / commit: `feat/agent-setup-instructions`, based on `b124aa8`.

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
- The generated snippet has not recorded a declaration on a real customer site yet.

## Next Session Startup

1. Read `AGENTS.md`.
2. Read `feature_list.json` and `progress.md`.
3. Review this handoff.
4. Run `./init.sh` before editing.

## Recommended Next Step

- Deploy the agent setup panel, confirm a declaration from a real site, then mark `feat-003` done and start `feat-011`.
