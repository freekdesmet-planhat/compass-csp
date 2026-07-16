-- ============================================================================
-- Compass V1.1 — 05. cron: weekly Latest-News refresh (C2)
-- ----------------------------------------------------------------------------
-- Cost control: auto-refresh runs only for accounts in the configured segment
-- set (default: enterprise). The set is editable in Admin → Health/AI settings;
-- change the segment array below (or drive it from a settings row) to widen it.
-- Uses invoke_edge() from the V1 cron migration.
-- ============================================================================

create or replace function public.refresh_enterprise_news()
returns int
language plpgsql security definer set search_path = public as $$
declare c record; n int := 0;
begin
  for c in
    select id from companies
    where segment = any (array['enterprise'])   -- configurable segment set
      and status = 'customer'
  loop
    perform public.invoke_edge('news-refresh', jsonb_build_object('companyId', c.id));
    n := n + 1;
  end loop;
  return n;
end $$;

-- Every Monday 06:00 UTC.
select cron.schedule('compass-news-refresh-weekly', '0 6 * * 1',
  $$select public.refresh_enterprise_news()$$);
