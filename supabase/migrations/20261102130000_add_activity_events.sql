-- One timeline of activity per session. Rows are appended and never rewritten, so signals
-- from different sources stay side by side even when they disagree. Rows outlive their
-- session, which is pruned sooner, so there is no foreign key to sessions.
create table if not exists agent_identification.activity_events (
  site_id text not null check (site_id ~ '^[a-zA-Z0-9_-]{1,100}$'),
  -- Chosen by the reporter, so a retry is recorded once.
  id uuid not null,
  session_id uuid,
  type text not null check (type in ('declaration', 'page_view', 'action')),
  source text not null check (source in ('browser', 'server')),
  evidence text not null check (evidence in ('self_reported', 'browser_reported', 'host_reported')),
  origin text check (char_length(origin) <= 200),
  occurred_at bigint not null,
  received_at bigint not null,
  -- Opaque IDs from the host's server, never names or email addresses.
  account_ref text check (account_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  choice text check (choice in ('ai_assistant', 'person', 'prefer_not_to_say')),
  agent_name text check (char_length(agent_name) between 1 and 100),
  agent_provider text check (char_length(agent_provider) between 1 and 100),
  agent_purpose text check (char_length(agent_purpose) between 1 and 100),
  path text check (path ~ '^/' and char_length(path) <= 512),
  route text check (route ~ '^/[A-Za-z0-9_.~:/{}*-]{0,255}$'),
  action text check (action ~ '^[a-z][a-z0-9_.:-]{0,63}$'),
  resource_ref text check (resource_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  outcome text check (outcome in ('attempted', 'rejected', 'confirmed')),
  primary key (site_id, id),
  check (case type
    when 'declaration' then source = 'browser' and evidence = 'self_reported'
      and origin is not null and choice is not null
      and path is null and route is null and action is null and resource_ref is null and outcome is null
    when 'page_view' then source = 'browser' and evidence = 'browser_reported'
      and origin is not null and path is not null and choice is null
      and agent_name is null and agent_provider is null and agent_purpose is null
      and action is null and resource_ref is null and outcome is null
    when 'action' then source = 'server' and evidence = 'host_reported'
      and origin is null and action is not null and outcome is not null and choice is null
      and agent_name is null and agent_provider is null and agent_purpose is null
      and path is null and route is null
  end)
);
create index if not exists activity_events_site_received
  on agent_identification.activity_events (site_id, received_at desc, id desc);
create index if not exists activity_events_session
  on agent_identification.activity_events (site_id, session_id, occurred_at)
  where session_id is not null;
create index if not exists activity_events_retention
  on agent_identification.activity_events (received_at);

alter table agent_identification.activity_events enable row level security;
alter table agent_identification.activity_events force row level security;
revoke all on agent_identification.activity_events from public;
grant select, insert, delete on agent_identification.activity_events to agent_id_app;
create policy collector_activity_events on agent_identification.activity_events
  for all to agent_id_app using (true) with check (true);

-- Declarations recorded before this table existed join the timeline. Safe to run again.
insert into agent_identification.activity_events
  (site_id, id, session_id, type, source, evidence, origin, occurred_at, received_at, choice)
select site_id, id, session_id, 'declaration', 'browser', 'self_reported', origin,
  created_at, created_at, choice
from agent_identification.events
on conflict (site_id, id) do nothing;
