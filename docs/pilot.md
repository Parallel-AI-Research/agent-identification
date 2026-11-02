# Pilot release

The checklist for putting the MVP in front of external testers (`feat-010`). A pilot is a documented trial with named testers, not a general release.

## Deploy

1. Apply every migration in `supabase/migrations/` that the production database doesn't have, in order, with a dry run first and `--db-url` for the customer project (see `AGENTS.md`). The activity work adds `20261102130000` to `20261102170000`.
2. Deploy the collector from the repository root, then the dashboard from `dashboard/`. The collector's health check reads the new tables, so it must not deploy before the migrations.
3. Check `/health` reports the new SDK version and `postgres`, and that `/sdk/v0.1.0/` still serves the frozen files.
4. Freeze each newly published SDK version as `docs/operations.md` describes, so it can never change.

## Hosted checks

These need the deployed target; local runs don't count.

- `npm run smoke:hosted` against the collector, with the fixture site configured.
- A new account signs up, confirms its email, adds a product, installs the snippet on a real page, and sees **Receiving events**, a page view and its own session in **Activity**. The owner runs this: agents don't create accounts on the hosted app.
- A second account can't reach the first account's product, through the dashboard or the owner API.
- A signed request from a real Web Bot Auth signer is verified, before any signer is described as supported.
- Deleting the test product removes it, and its site stops accepting sessions.

Record the commands, dates and results in `feat-010`'s evidence, failures included.

## What the pilot may claim

- Visitors and agents can **declare** what they are. A declaration is self-reported.
- Agents that **sign** their requests with Web Bot Auth can be verified as their operator, once that signer has been verified on the hosted collector.
- Page views, server-reported actions and automation signals are recorded per session, with who vouches for each.

## What it must not claim

- Detecting every AI agent, or any share of all agents. The 90–100% goal needs a defined population and a baseline (`feat-009`).
- Verifying who an agent acts for. A signature names the operator; `accountRef` names the account used.
- Bot protection, authorization or fraud prevention. Nothing here blocks or admits a visitor.
- Compliance, certification or enterprise readiness.

## Retention and deletion

- Sessions are deleted after seven days and activity after 30, by the daily prune and on requests.
- Deleting a product removes its environments, secrets and everything its sites recorded in one statement, and installs stop within 30 seconds.
- Raw IP addresses, page titles, page text and form contents are never stored.
