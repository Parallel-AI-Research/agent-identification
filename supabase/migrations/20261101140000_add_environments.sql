-- Credentials and origins belong to an environment, so production, beta, staging and
-- dev traffic never mix. An environment's type is fixed; its name can change.
create table if not exists agent_identification.environments (
  id uuid primary key,
  product_id uuid not null references agent_identification.products(id) on delete cascade,
  type text not null check (type in ('production', 'beta', 'staging', 'dev')),
  name text not null check (char_length(name) between 1 and 100),
  site_id text not null unique check (site_id ~ '^[a-zA-Z0-9_-]{1,100}$'),
  secret_ciphertext text not null,
  previous_secret_ciphertext text,
  previous_secret_expires_at bigint,
  created_at bigint not null,
  updated_at bigint not null,
  unique (product_id, type),
  check ((previous_secret_ciphertext is null) = (previous_secret_expires_at is null))
);

create table if not exists agent_identification.environment_origins (
  environment_id uuid not null references agent_identification.environments(id) on delete cascade,
  origin text not null,
  primary key (environment_id, origin)
);
create index if not exists environment_origins_origin
  on agent_identification.environment_origins (origin);

-- Each existing product becomes its own production environment. Site IDs and secrets
-- are unchanged, so existing installs keep working.
insert into agent_identification.environments
  (id, product_id, type, name, site_id, secret_ciphertext, previous_secret_ciphertext,
   previous_secret_expires_at, created_at, updated_at)
select gen_random_uuid(), id, 'production', 'Production', site_id, secret_ciphertext,
  previous_secret_ciphertext, previous_secret_expires_at, created_at, updated_at
from agent_identification.products;

insert into agent_identification.environment_origins (environment_id, origin)
select environments.id, origins.origin
from agent_identification.product_origins origins
join agent_identification.environments environments on environments.product_id = origins.product_id;

drop table agent_identification.product_origins;
alter table agent_identification.products
  drop column site_id,
  drop column secret_ciphertext,
  drop column previous_secret_ciphertext,
  drop column previous_secret_expires_at;

alter table agent_identification.environments enable row level security;
alter table agent_identification.environments force row level security;
alter table agent_identification.environment_origins enable row level security;
alter table agent_identification.environment_origins force row level security;
revoke all on agent_identification.environments from public;
revoke all on agent_identification.environment_origins from public;

grant select, insert on agent_identification.environments to agent_id_app;
grant update (name, secret_ciphertext, previous_secret_ciphertext, previous_secret_expires_at, updated_at)
  on agent_identification.environments to agent_id_app;
grant select, insert, delete on agent_identification.environment_origins to agent_id_app;

create policy collector_environments on agent_identification.environments
  for all to agent_id_app using (true) with check (true);
create policy collector_environment_origins on agent_identification.environment_origins
  for all to agent_id_app using (true) with check (true);
