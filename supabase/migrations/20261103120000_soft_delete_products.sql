-- Deleting a product hides it and stops its sites at once. The owner can restore it for 30
-- days; after that the collector's prune removes it, and everything its sites recorded, for good.
alter table agent_identification.products add column if not exists deleted_at bigint;
create index if not exists products_deleted on agent_identification.products (deleted_at)
  where deleted_at is not null;
grant update (deleted_at) on agent_identification.products to agent_id_app;
