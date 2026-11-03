-- Heuristic automation signals join the timeline as evidence, never as identity: a page or a
-- server reports what it saw, such as a webdriver flag or a user agent naming an AI agent.
alter table agent_identification.activity_events
  add column if not exists signal text
    check (signal in ('webdriver', 'headless_browser', 'agent_user_agent')),
  add column if not exists signal_detail text check (signal_detail ~ '^[\x20-\x7e]{1,100}$');

alter table agent_identification.activity_events
  drop constraint activity_events_type_check,
  add constraint activity_events_type_check
    check (type in ('declaration', 'page_view', 'action', 'signature', 'signal')),
  drop constraint activity_events_check,
  add constraint activity_events_check check (
    (type = 'signature' or (signer is null and signature_agent is null
      and signature_result is null and verifier is null))
    and (type = 'signal' or (signal is null and signal_detail is null))
    and case type
      when 'declaration' then source = 'browser' and evidence = 'self_reported'
        and origin is not null and choice is not null
        and path is null and route is null and action is null and resource_ref is null
        and outcome is null
      when 'page_view' then source = 'browser' and evidence = 'browser_reported'
        and origin is not null and path is not null and choice is null
        and agent_name is null and agent_provider is null and agent_purpose is null
        and action is null and resource_ref is null and outcome is null
      when 'action' then source = 'server' and evidence = 'host_reported'
        and origin is null and action is not null and outcome is not null and choice is null
        and agent_name is null and agent_provider is null and agent_purpose is null
        and path is null and route is null
      when 'signature' then source = 'server'
        and evidence in ('signature_verified', 'signature_claimed', 'cdn_reported')
        and origin is null and signature_result is not null and choice is null
        and agent_name is null and agent_provider is null and agent_purpose is null
        and route is null and action is null and resource_ref is null and outcome is null
        and ((evidence = 'signature_claimed') = (signature_result <> 'verified'))
        and (evidence <> 'signature_verified' or signer is not null)
        and ((evidence = 'cdn_reported') = (verifier is not null))
      -- A page reports only what it can see, with its origin; a server reports without one.
      when 'signal' then signal is not null
        and ((source = 'browser' and evidence = 'browser_reported' and origin is not null
              and signal in ('webdriver', 'headless_browser'))
          or (source = 'server' and evidence = 'host_reported' and origin is null))
        and choice is null and agent_name is null and agent_provider is null
        and agent_purpose is null and path is null and route is null and action is null
        and resource_ref is null and outcome is null
    end
  );
