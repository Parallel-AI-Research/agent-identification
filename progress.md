# Session Progress Log

This file is committed to a public repository. Keep credentials, tokens, raw evidence, customer names and private conversations out of it.

## Current State

**Last Updated:** 2026-11-01 (Africa/Lagos)
**Active Feature:** None. `feat-002` is next and waits on owner decisions.

The package is at version `0.1.0`: a declaration widget, session binding, server verification helpers and a PostgreSQL collector. No analytics MVP feature is implemented yet.

## Status

### What's Done

- [x] Agent harness added and verified (`feat-001`).

### What's In Progress

- Nothing.

### What's Next

1. Get the owner's decisions on customer auth and on the dashboard framework and location (`feat-002`).
2. Implement `feat-002`, then continue in `feature_list.json` order.

## Blockers / Risks

- [ ] **`feat-002` is blocked on owner decisions**: every later feature depends on it, and most of them have open decisions of their own. See `openDecisions` in `feature_list.json`.
- [ ] **No Firefox result**: local startup failed on 21 October before any behavioural result, so `./init.sh --full` runs Chromium and WebKit only. CI still installs and runs all three.
- [ ] **Silent-agent detection is unproven**: the MVP plan treats it as validation work (`feat-008`, `feat-009`), not as an existing capability.

## Decisions Made

- **`./init.sh` skips `npm ci` when dependencies are current**
  - Context: `npm ci` deletes `node_modules`, which would break anything running from it during a session restart.
  - Alternatives considered: always running `npm ci`, as CI does on a clean checkout.
- **`AGENTS.md` stays the single instruction file**
  - Context: `CLAUDE.md` imports it, so Codex and Claude Code read the same rules.
  - Alternatives considered: separate instruction files, which would drift apart.
- **Open product decisions block features instead of being assumed**
  - Context: the MVP plan says these must not be silently treated as requirements.
  - Alternatives considered: separate decision-only features, which added entries without adding any enforcement.

## Files Modified This Session

- `AGENTS.md` - added startup, working rules, definition of done, end of session and verification sections. Existing rules unchanged.
- `CLAUDE.md` - new, imports `AGENTS.md`.
- `feature_list.json` - new, ten features from the MVP plan.
- `init.sh` - new, verification entry point.
- `progress.md`, `session-handoff.md` - new, session state.

## Evidence of Completion

- [x] Tests pass: `./init.sh --full` exited 0 with 60/60 tests and 48/48 Chromium and WebKit browser tests.
- [x] Failure paths: a misformatted file and a wrong Node version each exited 1; an unknown argument exited 2.
- [x] Install skip: 33s with `npm ci`, 4s when dependencies are current.
- [x] Harness validator: 100/100. This is a structural score, not a measure of agent effectiveness.
- [x] Packaging: `npm pack --dry-run` listed 15 files, none of them harness files. `releases/` is unchanged.
- [ ] Not run: Firefox, hosted smoke checks, and any trial of an agent actually using this harness.

## Notes for Next Session

Nothing can start until the owner resolves the `feat-002` decisions, so ask about those first. Run `./init.sh` before and after any change; it takes seconds when dependencies are current.
