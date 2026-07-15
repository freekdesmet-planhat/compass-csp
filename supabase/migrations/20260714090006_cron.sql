-- ============================================================================
-- Compass — 06. pg_cron schedule (Section 6 sync schedule)
-- ----------------------------------------------------------------------------
-- pg_cron → pg_net → Edge Functions. OPERATOR SETUP (once):
--   1. Store the functions base URL + service-role key in Vault:
--        select vault.create_secret('https://<PROJECT_REF>.supabase.co/functions/v1', 'functions_base_url');
--        select vault.create_secret('<SERVICE_ROLE_KEY>', 'edge_service_key');
--   2. The helper below reads them and POSTs to a function by name.
-- Replace <PROJECT_REF> if you prefer to hard-code instead of using Vault.
-- ============================================================================

create or replace function public.invoke_edge(fn text, body jsonb default '{}')
returns bigint
language plpgsql security definer set search_path = public, vault as $$
declare base text; key text; req_id bigint;
begin
  select decrypted_secret into base from vault.decrypted_secrets where name = 'functions_base_url';
  select decrypted_secret into key  from vault.decrypted_secrets where name = 'edge_service_key';
  select net.http_post(
    url := base || '/' || fn,
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||key),
    body := body
  ) into req_id;
  return req_id;
end $$;

-- Per Section 6 sync schedule. (sync-gmail / sync-outreach iterate connected
-- users inside the function; cron just triggers a pass.)
select cron.schedule('compass-sync-gmail',            '*/10 * * * *', $$select public.invoke_edge('sync-gmail')$$);
select cron.schedule('compass-sync-calendar',         '*/15 * * * *', $$select public.invoke_edge('sync-calendar')$$);
select cron.schedule('compass-sync-hubspot',          '*/15 * * * *', $$select public.invoke_edge('sync-hubspot')$$);
select cron.schedule('compass-sync-outreach',         '*/30 * * * *', $$select public.invoke_edge('sync-outreach')$$);
select cron.schedule('compass-fathom-backfill',       '0 * * * *',    $$select public.invoke_edge('webhook-fathom', '{"mode":"backfill"}')$$);
select cron.schedule('compass-meeting-prep',          '0 * * * *',    $$select public.invoke_edge('generate-meeting-prep')$$);
select cron.schedule('compass-compute-health-nightly','0 2 * * *',    $$select public.invoke_edge('compute-health', '{"mode":"nightly"}')$$);
select cron.schedule('compass-compute-health-weekly', '0 23 * * 0',   $$select public.invoke_edge('compute-health', '{"mode":"weekly"}')$$);
select cron.schedule('compass-generate-digests',      '0 * * * *',    $$select public.invoke_edge('generate-digests')$$);
select cron.schedule('compass-alert-evaluator',       '*/30 * * * *', $$select public.invoke_edge('alert-evaluator')$$);
