-- A claim belongs to an owner, so one customer can use a domain on several products
-- while two customers can never both verify it.
create table if not exists agent_identification.domain_claims (
  owner_id uuid not null,
  domain text not null check (domain ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$'),
  token text not null check (token ~ '^[A-Za-z0-9_-]{32,}$'),
  created_at bigint not null,
  verified_at bigint,
  primary key (owner_id, domain)
);
create unique index if not exists domain_claims_one_verified
  on agent_identification.domain_claims (domain) where verified_at is not null;

do $$
begin
  if to_regclass('auth.users') is not null
     and not exists (select 1 from pg_constraint where conname = 'domain_claims_owner_fk') then
    alter table agent_identification.domain_claims
      add constraint domain_claims_owner_fk foreign key (owner_id)
      references auth.users(id) on delete cascade;
  end if;
end
$$;

alter table agent_identification.domain_claims enable row level security;
alter table agent_identification.domain_claims force row level security;
revoke all on agent_identification.domain_claims from public;
grant select, insert on agent_identification.domain_claims to agent_id_app;
grant update (verified_at) on agent_identification.domain_claims to agent_id_app;
create policy collector_domain_claims on agent_identification.domain_claims
  for all to agent_id_app using (true) with check (true);
