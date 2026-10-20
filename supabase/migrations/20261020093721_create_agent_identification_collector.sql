-- Private schema: never add it to PostgREST's exposed schemas.
create schema if not exists agent_identification;
revoke all on schema agent_identification from public;

create table if not exists agent_identification.sessions (
  id uuid primary key,
  site_id text not null,
  origin text not null,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  binding_hash text check (binding_hash is null or binding_hash ~ '^[a-f0-9]{64}$'),
  created_at bigint not null,
  expires_at bigint not null check (expires_at > created_at),
  revoked_at bigint,
  choice text check (choice in ('ai_assistant', 'person', 'prefer_not_to_say')),
  receipt text,
  event_id uuid,
  request_id uuid,
  check (
    (choice is null and receipt is null and event_id is null and request_id is null)
    or
    (choice is not null and receipt is not null and event_id is not null and request_id is not null)
  )
);
create index if not exists sessions_retention on agent_identification.sessions (created_at);

create table if not exists agent_identification.events (
  id uuid primary key,
  site_id text not null,
  origin text not null,
  session_id uuid not null unique references agent_identification.sessions(id) on delete cascade,
  choice text not null check (choice in ('ai_assistant', 'person', 'prefer_not_to_say')),
  created_at bigint not null
);
create index if not exists events_site_created on agent_identification.events (site_id, created_at desc);

create table if not exists agent_identification.rate_buckets (
  key_hash text primary key check (key_hash ~ '^[a-f0-9]{64}$'),
  count bigint not null,
  expires_at bigint not null
);
create index if not exists rate_buckets_expiry on agent_identification.rate_buckets (expires_at);

alter table agent_identification.sessions enable row level security;
alter table agent_identification.sessions force row level security;
alter table agent_identification.events enable row level security;
alter table agent_identification.events force row level security;
alter table agent_identification.rate_buckets enable row level security;
alter table agent_identification.rate_buckets force row level security;
revoke all on all tables in schema agent_identification from public;
-- Grant the collector's dedicated runtime role access and scoped policies in the
-- deployment migration. Do not grant browser anon/authenticated roles access.

-- Runtime login credentials are provisioned out of band, never in migrations.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'agent_id_app') then
    create role agent_id_app nologin nosuperuser nocreatedb nocreaterole
      noinherit noreplication nobypassrls;
  end if;
end
$$;

grant usage on schema agent_identification to agent_id_app;
grant select, insert, delete on agent_identification.sessions to agent_id_app;
grant update (choice, request_id, event_id, receipt, revoked_at)
  on agent_identification.sessions to agent_id_app;
grant select, insert on agent_identification.events to agent_id_app;
grant select, insert, update, delete on agent_identification.rate_buckets to agent_id_app;

create policy collector_sessions on agent_identification.sessions
  for all to agent_id_app using (true) with check (true);
create policy collector_events on agent_identification.events
  for all to agent_id_app using (true) with check (true);
create policy collector_rates on agent_identification.rate_buckets
  for all to agent_id_app using (true) with check (true);
