-- ============================================================================
-- Compass V1.1 — 02. Row-Level Security for the new tables
-- ----------------------------------------------------------------------------
-- Consistent with V1: company-scoped tables gate on can_see_company(); config
-- tables read-authenticated / write-admin; per-user tables are owner-only.
-- ============================================================================

alter table public.products            enable row level security;
alter table public.company_products    enable row level security;
alter table public.notifications       enable row level security;
alter table public.library_items       enable row level security;
alter table public.dashboards          enable row level security;
alter table public.dashboard_widgets   enable row level security;
alter table public.import_runs         enable row level security;
alter table public.ask_compass_threads  enable row level security;
alter table public.ask_compass_messages enable row level security;
alter table public.changelog_entries   enable row level security;

-- ── products: catalogue — read authenticated, write admin ────────────────────
create policy products_read on public.products for select using (auth.uid() is not null);
create policy products_admin on public.products for all using (is_admin()) with check (is_admin());

-- ── company_products: company-scoped ─────────────────────────────────────────
create policy cp_select on public.company_products for select using (can_see_company(company_id));
create policy cp_insert on public.company_products for insert with check (can_see_company(company_id));
create policy cp_update on public.company_products for update using (can_see_company(company_id)) with check (can_see_company(company_id));
create policy cp_delete on public.company_products for delete using (can_see_company(company_id));

-- ── notifications: owner-only ────────────────────────────────────────────────
create policy notif_owner on public.notifications for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── library_items: read authenticated, write by uploader or admin/manager ────
create policy lib_read on public.library_items for select using (auth.uid() is not null);
create policy lib_insert on public.library_items for insert
  with check (uploaded_by = auth.uid() or is_admin());
create policy lib_update on public.library_items for update
  using (uploaded_by = auth.uid() or is_admin()) with check (uploaded_by = auth.uid() or is_admin());
create policy lib_delete on public.library_items for delete
  using (uploaded_by = auth.uid() or is_admin());

-- ── dashboards: owner, admin, or shared-to-owner's-manager ───────────────────
create policy dash_select on public.dashboards for select
  using (owner_id = auth.uid() or is_admin() or (shared and is_manager_of(owner_id)));
create policy dash_write on public.dashboards for all
  using (owner_id = auth.uid() or is_admin())
  with check (owner_id = auth.uid() or is_admin());

-- ── dashboard_widgets: via parent dashboard ──────────────────────────────────
create policy dw_select on public.dashboard_widgets for select
  using (exists (select 1 from dashboards d where d.id = dashboard_id
    and (d.owner_id = auth.uid() or is_admin() or (d.shared and is_manager_of(d.owner_id)))));
create policy dw_write on public.dashboard_widgets for all
  using (exists (select 1 from dashboards d where d.id = dashboard_id and (d.owner_id = auth.uid() or is_admin())))
  with check (exists (select 1 from dashboards d where d.id = dashboard_id and (d.owner_id = auth.uid() or is_admin())));

-- ── import_runs: admins + managers; you see your own runs ────────────────────
create policy imp_select on public.import_runs for select using (is_admin() or run_by = auth.uid());
create policy imp_insert on public.import_runs for insert with check (run_by = auth.uid() and auth.uid() is not null);

-- ── Ask Compass: owner-only ──────────────────────────────────────────────────
create policy act_owner on public.ask_compass_threads for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy acm_owner on public.ask_compass_messages for all
  using (exists (select 1 from ask_compass_threads t where t.id = thread_id and t.user_id = auth.uid()))
  with check (exists (select 1 from ask_compass_threads t where t.id = thread_id and t.user_id = auth.uid()));

-- ── changelog_entries: read authenticated, write admin ───────────────────────
create policy cl_read on public.changelog_entries for select using (auth.uid() is not null);
create policy cl_admin on public.changelog_entries for all using (is_admin()) with check (is_admin());

-- ── Realtime: notifications drive the bell (D6) ──────────────────────────────
alter publication supabase_realtime add table public.notifications;
