-- An owner can delete a product: its environments and origins go with it, and the collector
-- removes everything its sites recorded in the same statement.
grant delete on agent_identification.products to agent_id_app;
grant delete on agent_identification.environments to agent_id_app;
