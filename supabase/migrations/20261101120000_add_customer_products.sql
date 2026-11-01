-- Customers own products. owner_id is null for operator-provisioned sites such as
-- the public demo, the agent trials and the research fixture.
create table if not exists agent_identification.products (
  id uuid primary key,
  owner_id uuid,
  name text not null check (char_length(name) between 1 and 100),
  site_id text not null unique check (site_id ~ '^[a-zA-Z0-9_-]{1,100}$'),
  secret_ciphertext text not null,
  previous_secret_ciphertext text,
  previous_secret_expires_at bigint,
  created_at bigint not null,
  updated_at bigint not null,
  check ((previous_secret_ciphertext is null) = (previous_secret_expires_at is null))
);
create index if not exists products_owner on agent_identification.products (owner_id, created_at desc);

create table if not exists agent_identification.product_origins (
  product_id uuid not null references agent_identification.products(id) on delete cascade,
  origin text not null,
  primary key (product_id, origin)
);
create index if not exists product_origins_origin on agent_identification.product_origins (origin);

-- Records which site secret signed a bound session, so its receipt can use the same
-- one while a customer's deployment catches up with a rotation.
alter table agent_identification.sessions
  add column if not exists signing_secret_hash text
  check (signing_secret_hash is null or signing_secret_hash ~ '^[a-f0-9]{64}$');

-- Deleting a customer's account removes their products. auth.users exists on
-- Supabase, not in the plain Postgres used by tests.
do $$
begin
  if to_regclass('auth.users') is not null
     and not exists (select 1 from pg_constraint where conname = 'products_owner_fk') then
    alter table agent_identification.products
      add constraint products_owner_fk foreign key (owner_id)
      references auth.users(id) on delete cascade;
  end if;
end
$$;

alter table agent_identification.products enable row level security;
alter table agent_identification.products force row level security;
alter table agent_identification.product_origins enable row level security;
alter table agent_identification.product_origins force row level security;
revoke all on agent_identification.products from public;
revoke all on agent_identification.product_origins from public;

grant select, insert on agent_identification.products to agent_id_app;
grant update (name, secret_ciphertext, previous_secret_ciphertext, previous_secret_expires_at, updated_at)
  on agent_identification.products to agent_id_app;
grant select, insert, delete on agent_identification.product_origins to agent_id_app;

create policy collector_products on agent_identification.products
  for all to agent_id_app using (true) with check (true);
create policy collector_product_origins on agent_identification.product_origins
  for all to agent_id_app using (true) with check (true);
