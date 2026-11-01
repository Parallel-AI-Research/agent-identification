# Session Progress Log

This file is committed to a public repository. Keep credentials, tokens, raw evidence, customer names and private conversations out of it.

## Current State

**Last Updated:** 2026-11-01 (Africa/Lagos)
**Active Feature:** None. `feat-002` is next and can start.

The package is at version `0.1.0`: a declaration widget, session binding, server verification helpers and a PostgreSQL collector. No analytics MVP feature is implemented yet.

## Status

### What's Done

- [x] Agent harness added and verified (`feat-001`).
- [x] Open product decisions resolved with the owner, except numeric pilot targets. See `decisions` in `feature_list.json`.
- [x] Dedicated Supabase project created for the customer product. It is empty, and the collector has not moved yet.

### What's In Progress

- Nothing.

### What's Next

1. Start `feat-002`: move sites into the database, add customer and product ownership, and move the collector schema to the new project.
2. Continue in `feature_list.json` order.

## Blockers / Risks

- [ ] **`feat-009` targets**: numeric targets need a small baseline run first, so that feature stays blocked until then.
- [ ] **Collector migration**: moving the schema must keep the demo, trial and ticket-app installs working.
- [ ] **Web Bot Auth coverage**: signing is voluntary and agents driving a local browser probably will not sign, so many sessions will stay unknown. This needs testing with real traffic.
- [ ] **Firefox locally**: local startup failed on 21 October, so `./init.sh --full` runs Chromium and WebKit only. CI runs all three.
- [ ] **Silent-agent detection is unproven**: the MVP plan treats it as validation work (`feat-008`, `feat-009`), not as an existing capability.

## Decisions Made

- **The product is for any software**
  - Context: each customer names their own actions, and the ticket app is only an integration fixture.
  - Alternatives considered: none. Check designs against non-Node and API-only products.
- **Server reporting is a plain HTTP endpoint with a Node helper on top**
  - Context: products on other languages must be able to report actions without our package.
  - Alternatives considered: Node helper only, Next.js middleware, Cloudflare Worker and Vercel BotID. SDKs in other languages are a likely later step, wrapping the same endpoint.
- **Domain verification does not block events**
  - Context: the first event should arrive quickly, so unverified domains are labelled instead.
  - Alternatives considered: requiring DNS first, an HTML file check that needs SSRF protection, and skipping verification.
- **Open product decisions block features instead of being assumed**
  - Context: the MVP plan says these must not be silently treated as requirements.
  - Alternatives considered: separate decision-only features, which added entries without adding any enforcement.
- **`./init.sh` skips `npm ci` when dependencies are current**
  - Context: `npm ci` deletes `node_modules`, which would break anything running from it during a session restart.
  - Alternatives considered: always running `npm ci`, as CI does on a clean checkout.
- **`AGENTS.md` stays the single instruction file**
  - Context: `CLAUDE.md` imports it, so Codex and Claude Code read the same rules.
  - Alternatives considered: separate instruction files, which would drift apart.

The remaining product decisions are recorded per feature under `decisions` in `feature_list.json`.

## Files Modified This Session

- `feature_list.json` - recorded decisions, added acceptance items and unblocked features.
- `progress.md`, `session-handoff.md` - updated session state.

## Evidence of Completion

- [x] Harness: `./init.sh --full` exited 0 with 60/60 tests and 48/48 Chromium and WebKit browser tests.
- [x] CI: 60/60 tests and 72/72 browser tests, including Firefox.
- [x] Harness validator: 100/100. This is a structural score, not a measure of agent effectiveness.
- [ ] Not run: hosted smoke checks, and any trial of an agent actually using this harness.

## Notes for Next Session

`feat-002` needs the new Supabase project's connection details from private configuration. Never copy them into this repository. Run `./init.sh` before and after any change; it takes seconds when dependencies are current.
