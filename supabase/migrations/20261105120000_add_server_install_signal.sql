-- A report the collector accepted from the customer's server, so an install with nothing on
-- the page can show its owner that it works. Like the other notes, it keeps a time and no
-- detail about the request.
alter table agent_identification.install_activity
  drop constraint install_activity_signal_check,
  add constraint install_activity_signal_check check (
    signal in (
      'loaded', 'declared', 'server_reported', 'origin_refused', 'secret_refused', 'binding_refused'
    )
  );
