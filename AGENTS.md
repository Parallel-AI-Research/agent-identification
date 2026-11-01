# Agent Identification

Standalone website-owner SDK. Do not couple it to the ticket-management research app.

- A declaration is self-reported, never verified identity, bot detection or authorization.
- Keep browser code framework independent; React is an optional peer export.
- No credentials, raw visitor tokens, private evidence or local configuration in Git, logs or package tarballs.
- Required UI mode accepts all three choices. Customer servers must separately enforce protected actions against their own active session binding.
- All HTTP clients fail visibly on errors; never report acceptance without a validated response.
- Make small commits after relevant tests pass. Before release run npm run check and the cross-origin browser/package integration suite.
- Shared contracts: src/protocol.ts and docs/protocol.md. Coordinate changes before altering them.
- `src/` is frozen at the published 0.1.0 release, so changing it needs a version bump. Collector and dashboard code live in `collector/` and `dashboard/`.
- Public docs and changelog posts live in `dashboard/content/`. Add a changelog post for every change customers can see, and keep the docs honest about what's built.
- The Supabase CLI link in this repository points at the research project. Pass `--db-url` for the customer project, and never run `supabase db push` without checking the target.

## Startup Workflow

Before writing code:

1. Run `./init.sh`. If it fails, repair the baseline before anything else.
2. Read `feature_list.json`, then `progress.md` and `session-handoff.md`.
3. Review recent commits with `git log --oneline -5`.
4. Read the docs the feature touches: `docs/protocol.md`, `docs/operations.md` or `docs/trials.md`.

`MVP-PLAN.md`, `RESEARCH-HISTORY.md` and `SETUP-AND-TESTING.md` sit one directory up in the local workspace and are not in this repository. `feature_list.json` carries the acceptance criteria, so work can proceed from a fresh clone without them.

## Working Rules

- **One feature at a time**: Work on the `in-progress` feature, or else the first `not-started` feature whose `dependencies` are all `done`.
- **Stay in scope**: Change only what that feature's `acceptance` needs. Note anything else in `progress.md` instead of doing it.
- **Open decisions belong to the owner**: A feature with `openDecisions` stays `blocked`. Ask; do not pick an answer and carry on.
- **State files are public**: This repository is public, so `feature_list.json`, `progress.md` and `session-handoff.md` follow the same no-secrets rule as code. Keep customer names, raw evidence and private conversations out of them.
- **Keep evidence honest**: Implementation tests do not measure spontaneous agent behaviour. Keep failed, interrupted and unknown results, and never describe a self-report as verified.

## Definition of Done

A feature is done only when all of these are true:

- [ ] Every `acceptance` item in `feature_list.json` is met.
- [ ] `./init.sh` passes, and `./init.sh --full` passes if browser, widget, collector HTTP or packaging behaviour changed.
- [ ] The commands and results are recorded in the feature's `evidence`.
- [ ] Docs match the behaviour, including `docs/protocol.md` for any contract change.

## End of Session

Before ending a session:

1. Update `status` and `evidence` in `feature_list.json`.
2. Update `progress.md`. If work continues later, rewrite `session-handoff.md` too.
3. Run `npx prettier --write feature_list.json progress.md session-handoff.md`; `npm run check` enforces their formatting.
4. Commit once the work is in a safe state, so the next session can run `./init.sh` immediately.

## Verification Commands

```bash
./init.sh         # npm ci if needed, npm run check, dashboard checks
./init.sh --full  # also browser suites, the dashboard build and its e2e tests
```

`npm run check` covers build, type checks, lint, formatting, unit/database/HTTP tests and a packed-package consumer. Dashboard e2e tests need the local stack (`supabase start`), and `--full` says plainly when it skips them. They use local accounts only, so never point them at a hosted project.

Firefox is configured but excluded from `--full`: local startup failed on 21 October before any behavioural result. Never report Chromium/WebKit results as Firefox coverage, and do not keep relaunching a browser that fails to start. Hosted smoke checks need explicit configuration; see `docs/operations.md`.
