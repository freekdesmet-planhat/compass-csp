-- ============================================================================
-- Compass V2 — Playbooks Engine schema (iteration2.md Part A, §2–5).
-- ----------------------------------------------------------------------------
-- ADDITIVE & BACK-COMPATIBLE: extends the existing (dormant) playbook_* tables
-- rather than forking (§16, §30). Condition columns (entry/exit/group/step) are
-- added now but only WIRED in Phase 2. Legacy columns (trigger, segment,
-- relative_due_days, run_steps.status) are kept for back-compat during migration.
--   • playbook_runs      = playbook "instances"      (spec §7)
--   • playbook_run_steps = playbook "step instances" (spec §7), task_id→tasks
-- ============================================================================

-- ── role helper: manager or admin (template authoring, §17) ──────────────────
create or replace function public.is_manager_or_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('manager','admin'));
$$;

-- ── playbook_templates: Project/Sequence definition (§3–5) ───────────────────
alter table public.playbook_templates
  add column if not exists type text not null default 'project' check (type in ('project','sequence')),
  add column if not exists target_model text not null default 'company'
    check (target_model in ('company','contact','opportunity','success_plan','renewal')),
  add column if not exists status text not null default 'draft' check (status in ('draft','live','archived')),
  add column if not exists entry_criteria jsonb not null default '{}',      -- rule tree (§5)
  add column if not exists exit_criteria jsonb not null default '{}',       -- rule tree (§5)
  add column if not exists exit_archive_action text not null default 'keep_remaining'
    check (exit_archive_action in ('keep_remaining','cancel_remaining')),
  add column if not exists created_by uuid references public.profiles;

-- ── email_templates: reusable content library (§4) ───────────────────────────
create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text,
  body jsonb default '{}',                       -- Tiptap richtext JSON
  tags text[] default '{}',
  created_by uuid references public.profiles,
  created_at timestamptz default now(), updated_at timestamptz
);

-- ── playbook_groups: groups of steps within a template (§5) ──────────────────
create table if not exists public.playbook_groups (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references public.playbook_templates on delete cascade not null,
  name text,
  position int default 0,
  group_condition jsonb not null default '{}',   -- rule tree (§5) — wired Phase 2
  expire_behavior text not null default 'keep' check (expire_behavior in ('keep','expire')),
  created_at timestamptz default now(), updated_at timestamptz
);
create index on public.playbook_groups (template_id);

-- ── playbook_template_steps: task & email steps (§3–5) ───────────────────────
alter table public.playbook_template_steps
  add column if not exists group_id uuid references public.playbook_groups on delete set null,
  add column if not exists step_type text not null default 'task' check (step_type in ('task','email')),
  add column if not exists owner_ref jsonb not null default '{"kind":"role","value":"account_owner"}',
  add column if not exists conversation_type text,                 -- reuses tasks.task_type taxonomy
  add column if not exists checklist jsonb not null default '[]',
  add column if not exists attachments jsonb not null default '[]',
  add column if not exists customer_visible boolean not null default false,  -- stored, no UI yet (§20)
  add column if not exists start_after_days int default 0,
  add column if not exists duration_days int,
  add column if not exists workdays_only boolean not null default true,
  add column if not exists suggested_email_template_id uuid references public.email_templates,
  add column if not exists depends_on_step_id uuid references public.playbook_template_steps,
  add column if not exists dependency_trigger jsonb,               -- {kind:'done'|'ignored'|'not_completed_within', days?}
  add column if not exists step_condition jsonb,                   -- rule tree (§5) — wired Phase 2
  add column if not exists step_condition_display text default 'hidden' check (step_condition_display in ('hidden','muted')),
  -- email-step fields (§4)
  add column if not exists send_when text check (send_when in ('asap','after_approval','custom')),
  add column if not exists custom_delay_days int,
  add column if not exists send_time text,
  add column if not exists send_timezone text,
  add column if not exists email_template_id uuid references public.email_templates,
  add column if not exists from_ref jsonb,                         -- dynamic ref (e.g. account_owner)
  add column if not exists cc_refs jsonb not null default '[]',
  add column if not exists to_contact_filter_id uuid,
  add column if not exists cc_contact_filter_id uuid,
  add column if not exists subject text,
  add column if not exists body jsonb;                             -- Tiptap richtext JSON

-- ── playbook_runs: a template applied to a record (instances, §7) ────────────
alter table public.playbook_runs
  add column if not exists target_model text not null default 'company',
  add column if not exists target_record_id uuid,                  -- the specific target (=company_id for company-target)
  add column if not exists entry_snapshot jsonb not null default '{}',   -- record props at apply (for condition eval)
  add column if not exists archived_at timestamptz,
  add column if not exists archive_action text;

-- ── playbook_run_steps: per-instance step state (§7) ─────────────────────────
alter table public.playbook_run_steps
  add column if not exists group_id uuid,                          -- copied from template group at apply
  add column if not exists step_type text not null default 'task',
  add column if not exists position int default 0,
  add column if not exists activation_state text not null default 'active'
    check (activation_state in ('hidden','muted','active','done','ignored','skipped')),
  add column if not exists skip_reason text,
  add column if not exists start_date date,
  add column if not exists due_date date,
  add column if not exists scheduled_at timestamptz,               -- email step scheduling
  add column if not exists sent_at timestamptz,
  add column if not exists approval_status text;                   -- null|pending|approved|rejected

-- ── updated_at triggers on the two NEW tables (existing tables already have it) ─
create trigger set_updated_at before update on public.email_templates for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.playbook_groups for each row execute function public.set_updated_at();

-- ── RLS: new tables + manager authoring on template tables (§17) ─────────────
alter table public.email_templates enable row level security;
alter table public.playbook_groups enable row level security;

create policy et_read  on public.email_templates for select using (auth.uid() is not null);
create policy et_write on public.email_templates for all    using (is_manager_or_admin()) with check (is_manager_or_admin());
create policy pg_read  on public.playbook_groups for select using (auth.uid() is not null);
create policy pg_write on public.playbook_groups for all    using (is_manager_or_admin()) with check (is_manager_or_admin());

-- Base schema granted template writes to admins only; V2 lets managers author
-- too (§17). Add a manager-or-admin policy alongside the existing admin policy
-- (RLS policies are permissive/OR-ed, so admins keep access).
create policy pt_manager_write  on public.playbook_templates      for all using (is_manager_or_admin()) with check (is_manager_or_admin());
create policy pts_manager_write on public.playbook_template_steps for all using (is_manager_or_admin()) with check (is_manager_or_admin());

-- ── Back-compat: promote the 6 already-seeded templates to live Projects and
--    carry legacy relative_due_days into the new start_after_days timing (§16). ─
update public.playbook_templates set status = 'live' where status = 'draft';
update public.playbook_template_steps set start_after_days = coalesce(relative_due_days, 0)
  where (start_after_days is null or start_after_days = 0) and relative_due_days is not null;
