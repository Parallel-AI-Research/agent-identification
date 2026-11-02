-- What each site's install has done, so its owner can tell an install that works from one
-- that hasn't loaded or is being refused. It holds signals, origins and times, never
-- anything about a visitor.
create table if not exists agent_identification.install_activity (
  site_id text not null check (site_id ~ '^[a-zA-Z0-9_-]{1,100}$'),
  signal text not null check (
    signal in ('loaded', 'declared', 'origin_refused', 'secret_refused', 'binding_refused')
  ),
  -- Empty for server requests, which have no origin.
  origin text not null check (char_length(origin) <= 200),
  first_seen_at bigint not null,
  last_seen_at bigint not null check (last_seen_at >= first_seen_at),
  primary key (site_id, signal, origin)
);

alter table agent_identification.install_activity enable row level security;
alter table agent_identification.install_activity force row level security;
revoke all on agent_identification.install_activity from public;

grant select, insert, delete on agent_identification.install_activity to agent_id_app;
grant update (last_seen_at) on agent_identification.install_activity to agent_id_app;

create policy collector_install_activity on agent_identification.install_activity
  for all to agent_id_app using (true) with check (true);
