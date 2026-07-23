-- ============================================================================
-- Compass V2 — Automations schema (iteration2.md Part B, §8–9).
-- ----------------------------------------------------------------------------
-- Automations are a separate module from Playbooks: "when X happens, do Y".
--   • automations       — templated + custom definitions (trigger + config)
--   • automation_steps   — steps of a Custom Automation flowchart (tree via
--                          parent_step_id + branch); templated automations use
--                          a small linear set of the same steps
--   • automation_runs    — one row per trigger firing, with a per-step trace
-- trigger_filter reuses the {match, rules[]} rule format (shared evaluateRules).
-- ============================================================================

create table public.automations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  kind text not null default 'templated' check (kind in ('templated','custom')),
  trigger_type text not null default 'record_created_or_updated'
    check (trigger_type in ('record_created','record_updated','record_created_or_updated','schedule','webhook','manual')),
  trigger_model text,                    -- company | contact | deal | nps | task | ...
  trigger_filter jsonb not null default '{}',   -- RuleGroup (§5) — shared evaluator
  trigger_config jsonb not null default '{}',   -- schedule cron / webhook token / etc.
  enabled boolean not null default false,
  created_by uuid references public.profiles,
  created_at timestamptz default now(), updated_at timestamptz
);

create table public.automation_steps (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid references public.automations on delete cascade not null,
  position int default 0,
  parent_step_id uuid references public.automation_steps on delete cascade,  -- flowchart tree
  branch text check (branch in ('true','false')),                            -- which side of a parent condition
  kind text not null check (kind in ('condition','wait','get','create_update','webhook','execute_function','use_ai','hitl','notify')),
  config jsonb not null default '{}',    -- kind-specific (rule tree / duration / prompt / url / fn name / message …)
  created_at timestamptz default now(), updated_at timestamptz
);
create index on public.automation_steps (automation_id);

create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid references public.automations on delete cascade not null,
  trigger_source text,                   -- e.g. 'cron', 'webhook', 'manual', 'record_updated'
  company_id uuid references public.companies,   -- context record (nullable)
  status text not null default 'running' check (status in ('running','success','error','waiting','cancelled')),
  trace jsonb not null default '[]',     -- [{stepId, kind, status, output?, error?}]
  context jsonb not null default '{}',   -- run variables (get-step results, etc.)
  waiting_task_id uuid references public.tasks,  -- HITL: the approval task it's paused on
  error text,
  started_at timestamptz default now(), finished_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz
);
create index on public.automation_runs (automation_id);
create index on public.automation_runs (company_id);

-- Automation-created tasks (incl. HITL approval tasks) get origin='automation'.
alter table public.tasks drop constraint if exists tasks_origin_check;
alter table public.tasks add constraint tasks_origin_check
  check (origin in ('manual','playbook','ai_call','ai_recommendation','alert','automation'));

-- updated_at triggers
create trigger set_updated_at before update on public.automations for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.automation_steps for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.automation_runs for each row execute function public.set_updated_at();

-- ── RLS (§17): the Automations builder is admin-only (incl. Execute Function =
--    arbitrary code). Runs/logs are readable by any authenticated user. ───────
alter table public.automations enable row level security;
alter table public.automation_steps enable row level security;
alter table public.automation_runs enable row level security;

create policy auto_read  on public.automations      for select using (auth.uid() is not null);
create policy auto_admin on public.automations      for all    using (is_admin()) with check (is_admin());
create policy astep_read  on public.automation_steps for select using (auth.uid() is not null);
create policy astep_admin on public.automation_steps for all    using (is_admin()) with check (is_admin());
create policy arun_read  on public.automation_runs  for select using (auth.uid() is not null);
create policy arun_admin on public.automation_runs  for all    using (is_admin()) with check (is_admin());
