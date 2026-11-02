-- Web Bot Auth: a request that named a signer joins its session's timeline. The collector
-- records whether it verified the signature itself, couldn't and why, or took the host
-- CDN's word for it.
alter table agent_identification.activity_events
  add column if not exists signer text check (char_length(signer) between 1 and 100),
  add column if not exists signature_agent text
    check (signature_agent ~ '^https?://' and char_length(signature_agent) <= 512),
  add column if not exists signature_result text check (signature_result in (
    'verified', 'unknown_signer', 'bad_signature', 'expired', 'replayed', 'wrong_authority',
    'malformed', 'key_unavailable'
  )),
  add column if not exists verifier text check (verifier in ('cloudflare', 'akamai', 'vercel'));

alter table agent_identification.activity_events
  drop constraint activity_events_type_check,
  add constraint activity_events_type_check
    check (type in ('declaration', 'page_view', 'action', 'signature')),
  drop constraint activity_events_evidence_check,
  add constraint activity_events_evidence_check check (evidence in (
    'self_reported', 'browser_reported', 'host_reported',
    'signature_verified', 'signature_claimed', 'cdn_reported'
  )),
  drop constraint activity_events_check,
  add constraint activity_events_check check (
    (type = 'signature' or (signer is null and signature_agent is null
      and signature_result is null and verifier is null))
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
        -- Only the collector's own check, or a CDN's verdict, can say verified.
        and ((evidence = 'signature_claimed') = (signature_result <> 'verified'))
        and (evidence <> 'signature_verified' or signer is not null)
        and ((evidence = 'cdn_reported') = (verifier is not null))
    end
  );
