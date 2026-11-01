# Session Handoff

## Current Objective

- Goal: Build the analytics MVP in `feature_list.json` order.
- Current status: `feat-002` and `feat-003` pass locally. Nothing is deployed.
- Branch / commit: `feat/customer-ownership`, based on `dc3e780`.

## Completed This Session

- [x] Built database-backed sites, the owner API, rotation and DNS verification.
- [x] Built the customer dashboard.
- [x] Applied all migrations to the dedicated Supabase project.

## Verification Evidence

| Check             | Command                            | Result  | Notes                      |
| ----------------- | ---------------------------------- | ------- | -------------------------- |
| Collector         | `npm test`                         | Pass    | 86/86                      |
| SDK browsers      | `npm run test:e2e`                 | Pass    | 48/48, Chromium and WebKit |
| Dashboard journey | `npm run test:e2e` in `dashboard/` | Pass    | 6/6, local Supabase        |
| Harness structure | `validate-harness.mjs`             | 100/100 | Structural score only      |

## Files Changed

- `collector/`, `dashboard/`, `supabase/`, `scripts/`, `docs/`, `init.sh`, CI, `AGENTS.md` and state files.

## Decisions Made

- See `decisions` in `feature_list.json` and the list in `progress.md`.

## Blockers / Risks

- The hosted collector still runs the old code and database.
- Supabase production auth settings and custom SMTP are not configured.

## Next Session Startup

1. Read `AGENTS.md`.
2. Read `feature_list.json` and `progress.md`.
3. Review this handoff.
4. Run `./init.sh` before editing.

## Recommended Next Step

- After review and merge, get the owner's approval to move the hosted collector, following the steps in `progress.md`.
