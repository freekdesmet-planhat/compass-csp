-- ============================================================================
-- Compass — 03. Row-Level Security (Section 2)
-- ----------------------------------------------------------------------------
-- Helper functions are security definer. Edge Functions use the service-role
-- key and bypass RLS; they must scope every query by ids they resolve.
-- ============================================================================

create or replace function public.is_admin() returns bool
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.is_manager_of(target uuid) returns bool
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = target and manager_id = auth.uid());
$$;

create or replace function public.can_see_company(cid uuid) returns bool
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from companies c
    where c.id = cid and (
      c.owner_id = auth.uid()
      or auth.uid() = any(c.collaborator_ids)
      or is_manager_of(c.owner_id)
      or is_admin()
    ));
$$;

-- ── enable RLS on every table ─────────────────────────────────────────────────
do $$
declare t text;
begin
  for t in select table_name from information_schema.tables
           where table_schema='public' and table_type='BASE TABLE'
  loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- ── profiles ─────────────────────────────────────────────────────────────────
create policy profiles_read on public.profiles for select
  using (is_active or id = auth.uid() or is_admin());
create policy profiles_self_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid() and role = (select role from profiles where id = auth.uid()));
create policy profiles_admin_all on public.profiles for all
  using (is_admin()) with check (is_admin());
create policy profiles_insert_self on public.profiles for insert
  with check (id = auth.uid() or is_admin());

-- ── company-scoped tables: SELECT + write gated by can_see_company ────────────
do $$
declare t text;
begin
  foreach t in array array[
    'companies','contacts','activities','notes','emails','calendar_events',
    'meeting_preps','tasks','success_plans','success_plan_objectives','deals',
    'health_snapshots','usage_metrics','tickets','nps_responses','csat_responses',
    'alerts','playbook_runs','playbook_run_steps'
  ] loop
    if t = 'companies' then
      execute 'create policy companies_select on public.companies for select using (can_see_company(id))';
      execute 'create policy companies_write on public.companies for update using (can_see_company(id)) with check (can_see_company(id))';
      execute 'create policy companies_insert on public.companies for insert with check (auth.uid() is not null)';
    elsif t = 'playbook_run_steps' then
      -- scoped via parent run's company
      execute 'create policy prs_select on public.playbook_run_steps for select using (exists (select 1 from playbook_runs r where r.id = run_id and can_see_company(r.company_id)))';
      execute 'create policy prs_write on public.playbook_run_steps for all using (exists (select 1 from playbook_runs r where r.id = run_id and can_see_company(r.company_id))) with check (exists (select 1 from playbook_runs r where r.id = run_id and can_see_company(r.company_id)))';
    else
      execute format('create policy %I on public.%I for select using (can_see_company(company_id));', t||'_select', t);
      execute format('create policy %I on public.%I for insert with check (can_see_company(company_id));', t||'_insert', t);
      execute format('create policy %I on public.%I for update using (can_see_company(company_id)) with check (can_see_company(company_id));', t||'_update', t);
      execute format('create policy %I on public.%I for delete using (can_see_company(company_id));', t||'_delete', t);
    end if;
  end loop;
end $$;

-- ── config tables: read authenticated, write admin ───────────────────────────
do $$
declare t text;
begin
  foreach t in array array['health_configs','alert_rules','playbook_templates','playbook_template_steps'] loop
    execute format('create policy %I on public.%I for select using (auth.uid() is not null);', t||'_read', t);
    execute format('create policy %I on public.%I for all using (is_admin()) with check (is_admin());', t||'_admin', t);
  end loop;
end $$;

-- ── integration_connections: owner or admin ─────────────────────────────────
create policy ic_owner on public.integration_connections for all
  using (user_id = auth.uid() or is_admin())
  with check (user_id = auth.uid() or is_admin());

-- ── digests: owner only ──────────────────────────────────────────────────────
create policy digests_owner on public.digests for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── audit / ops tables: admin read (service role bypasses RLS for writes) ─────
create policy sync_runs_admin on public.sync_runs for select using (is_admin());
create policy ai_runs_admin on public.ai_runs for select using (is_admin() or (company_id is not null and can_see_company(company_id)));
create policy unmatched_admin on public.unmatched_recordings for all using (is_admin()) with check (is_admin());
