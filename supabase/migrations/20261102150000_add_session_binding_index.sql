-- Server-reported actions find their session through the host's own session binding.
create index if not exists sessions_binding
  on agent_identification.sessions (site_id, binding_hash, created_at desc)
  where binding_hash is not null;
