-- ============================================================================
-- Compass — 02. Schema (Section 3 data model)
-- ----------------------------------------------------------------------------
-- Every table: id uuid pk default gen_random_uuid(), created_at, updated_at.
-- Company-scoped tables carry company_id + index. Synced/migrated tables carry
-- (source, source_id) with a unique index for idempotency. Tables are created
-- in FK-dependency order (profiles -> companies -> the rest).
-- ============================================================================

-- ── updated_at trigger ──────────────────────────────────────────────────────
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

-- ── profiles (1:1 with auth.users) ──────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text unique not null,
  full_name text,
  avatar_url text,
  role text not null default 'csm' check (role in ('csm','manager','admin')),
  segment text check (segment in ('scaled','mid_touch','enterprise')),
  manager_id uuid references public.profiles,
  timezone text default 'Europe/Amsterdam',
  digest_hour int default 7,
  is_active bool default true,
  created_at timestamptz default now(),
  updated_at timestamptz
);
create index on public.profiles (manager_id);

-- ── companies ────────────────────────────────────────────────────────────────
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domains text[] default '{}',
  website text, country text, city text,
  owner_id uuid references public.profiles,
  collaborator_ids uuid[] default '{}',
  segment text check (segment in ('scaled','mid_touch','enterprise')),
  phase text,
  status text default 'customer',
  tier text, region text, tags text[],
  mrr numeric, arr numeric,
  renewal_date date, renewal_arr numeric,
  hubspot_company_id text unique,
  health_score numeric, health_band text, health_delta_wow numeric, health_updated_at timestamptz,
  value_score numeric, value_comment text,
  sentiment_assessment numeric,
  exec_relationship_flag boolean default false,
  red_flags text, green_flags text,
  next_step text, path_to_green text, handover_notes text,
  ai_account_summary text, ai_risk_summary text, ai_renewal_summary text,
  last_touch_at timestamptz, last_touch_type text, next_touch_at timestamptz,
  source text, source_id text,
  search_vector tsvector generated always as (to_tsvector('simple', coalesce(name,''))) stored,
  created_at timestamptz default now(),
  updated_at timestamptz
);
create index on public.companies (owner_id);
create unique index companies_source_uidx on public.companies (source, source_id) where source_id is not null;
create index companies_search_idx on public.companies using gin (search_vector);

-- ── contacts ───────────────────────────────────────────────────────────────
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies not null,
  first_name text, last_name text,
  email text, other_emails text[], phone text,
  title text, department text, seniority text, linkedin_url text,
  contact_role text check (contact_role in ('exec_sponsor','decision_maker','main_user','tech_ops','end_user')),
  relationship_strength numeric,
  is_primary bool, is_champion bool, has_influence bool, is_advocate bool, advocate_type text,
  reports_to_contact_id uuid references public.contacts,
  nps_latest int, nps_latest_at timestamptz, sentiment_30d text,
  engagement_score numeric,
  last_active_at timestamptz, last_touch_at timestamptz, archived bool default false,
  source text, source_id text,
  search_vector tsvector generated always as (
    to_tsvector('simple', coalesce(first_name,'') || ' ' || coalesce(last_name,'') || ' ' || coalesce(email,''))
  ) stored,
  created_at timestamptz default now(),
  updated_at timestamptz
);
create index on public.contacts (company_id);
create unique index contacts_source_uidx on public.contacts (source, source_id) where source_id is not null;
create index contacts_search_idx on public.contacts using gin (search_vector);

-- ── activities (unified 360 timeline) ────────────────────────────────────────
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies not null,
  contact_ids uuid[] default '{}',
  user_id uuid references public.profiles,
  type text not null check (type in ('email','meeting','call','note','nps','task','system','ticket')),
  direction text,
  title text, snippet text, body_ref uuid,
  occurred_at timestamptz not null,
  meta jsonb default '{}',
  source text, source_id text,
  search_vector tsvector generated always as (
    to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(snippet,''))
  ) stored,
  created_at timestamptz default now(),
  updated_at timestamptz
);
create index activities_company_time_idx on public.activities (company_id, occurred_at desc);
create unique index activities_source_uidx on public.activities (source, source_id) where source_id is not null;
create index activities_search_idx on public.activities using gin (search_vector);

-- ── notes ────────────────────────────────────────────────────────────────────
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies not null,
  contact_id uuid references public.contacts,
  author_id uuid references public.profiles,
  title text, content jsonb, content_text text, pinned bool default false,
  source text, source_id text,
  search_vector tsvector generated always as (to_tsvector('simple', coalesce(content_text,''))) stored,
  created_at timestamptz default now(),
  updated_at timestamptz
);
create index on public.notes (company_id);
create index notes_search_idx on public.notes using gin (search_vector);

-- ── emails ───────────────────────────────────────────────────────────────────
create table public.emails (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies not null,
  contact_ids uuid[] default '{}',
  connection_id uuid,
  gmail_message_id text, gmail_thread_id text,
  direction text, from_email text, to_emails text[], cc_emails text[],
  subject text, snippet text, body_html text, sent_at timestamptz,
  source text default 'gmail', source_id text,
  created_at timestamptz default now(),
  updated_at timestamptz
);
create index on public.emails (company_id);
create unique index emails_gmail_uidx on public.emails (gmail_message_id) where gmail_message_id is not null;

-- ── calendar_events ──────────────────────────────────────────────────────────
create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies,
  connection_id uuid,
  gcal_event_id text, ical_uid text, title text,
  starts_at timestamptz, ends_at timestamptz,
  attendee_emails text[], organizer_email text, meet_link text, status text,
  matched_contact_ids uuid[], logged_activity_id uuid, fathom_recording_id uuid,
  source text default 'gcal', source_id text,
  created_at timestamptz default now(),
  updated_at timestamptz
);
create index on public.calendar_events (company_id);
create unique index calendar_events_gcal_uidx on public.calendar_events (gcal_event_id) where gcal_event_id is not null;

-- ── meeting_preps ──────────────────────────────────────────────────────────
create table public.meeting_preps (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies not null,
  calendar_event_id uuid unique references public.calendar_events,
  content jsonb, narrative text, generated_at timestamptz, stale bool default false,
  created_at timestamptz default now(),
  updated_at timestamptz
);
create index on public.meeting_preps (company_id);

-- ── tasks ────────────────────────────────────────────────────────────────────
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies not null,
  assignee_id uuid references public.profiles,
  creator_id uuid references public.profiles,
  title text not null, description text, due_date date, completed_at timestamptz,
  priority text default 'normal' check (priority in ('low','normal','high')),
  origin text default 'manual' check (origin in ('manual','playbook','ai_call','ai_recommendation','alert')),
  playbook_run_step_id uuid, source_activity_id uuid, success_plan_objective_id uuid,
  source text, source_id text,
  created_at timestamptz default now(),
  updated_at timestamptz
);
create index on public.tasks (company_id);
create index on public.tasks (assignee_id);
create unique index tasks_source_uidx on public.tasks (source, source_id) where source_id is not null;

-- ── playbooks ────────────────────────────────────────────────────────────────
create table public.playbook_templates (
  id uuid primary key default gen_random_uuid(),
  name text, description text, segment text[],
  trigger text check (trigger in ('manual','phase_change','renewal_t_minus','health_drop','new_customer')),
  trigger_config jsonb default '{}',
  created_at timestamptz default now(), updated_at timestamptz
);
create table public.playbook_template_steps (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references public.playbook_templates on delete cascade,
  position int, title text, description text, relative_due_days int, default_priority text,
  created_at timestamptz default now(), updated_at timestamptz
);
create table public.playbook_runs (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references public.playbook_templates,
  company_id uuid references public.companies not null,
  started_by uuid references public.profiles, started_at timestamptz default now(),
  status text default 'active', completed_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz
);
create index on public.playbook_runs (company_id);
create table public.playbook_run_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.playbook_runs on delete cascade,
  template_step_id uuid references public.playbook_template_steps,
  task_id uuid references public.tasks, status text default 'pending',
  created_at timestamptz default now(), updated_at timestamptz
);

-- ── success plans ──────────────────────────────────────────────────────────
create table public.success_plans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies not null,
  name text, owner_id uuid references public.profiles,
  status text default 'active', target_date date, progress_pct numeric,
  source text, source_id text,
  created_at timestamptz default now(), updated_at timestamptz
);
create index on public.success_plans (company_id);
create table public.success_plan_objectives (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid references public.success_plans on delete cascade,
  company_id uuid references public.companies not null,
  title text not null, business_outcome text, metric text, target_date date,
  status text default 'not_started' check (status in ('not_started','on_track','at_risk','achieved','missed')),
  position int, notes text,
  source text, source_id text,
  created_at timestamptz default now(), updated_at timestamptz
);
create index on public.success_plan_objectives (company_id);

-- ── deals ────────────────────────────────────────────────────────────────────
create table public.deals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies not null,
  hubspot_deal_id text unique, pipeline text,
  stage text, stage_probability numeric, forecast_category text,
  name text, amount numeric, currency text default 'USD',
  close_date date, owner_id uuid references public.profiles,
  status text default 'open' check (status in ('open','won','lost')),
  next_steps text, ai_summary text, confidence numeric,
  qualification jsonb default '{}',
  suggested_stage text, suggested_stage_reason text,
  contact_ids uuid[], last_synced_at timestamptz,
  source text, source_id text,
  created_at timestamptz default now(), updated_at timestamptz
);
create index on public.deals (company_id);
create unique index deals_source_uidx on public.deals (source, source_id) where source_id is not null;

-- ── health ───────────────────────────────────────────────────────────────────
create table public.health_configs (
  id uuid primary key default gen_random_uuid(),
  segment text unique not null,
  weights jsonb not null,
  thresholds jsonb not null default '{"red":40,"amber":70}',
  input_config jsonb not null default '{}',
  created_at timestamptz default now(), updated_at timestamptz
);
create table public.health_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies not null,
  snapshot_date date not null, is_weekly bool default false,
  overall numeric, band text, delta_wow numeric,
  dimensions jsonb not null default '{}',
  explanation text, recommendations jsonb,
  source text,
  created_at timestamptz default now(), updated_at timestamptz,
  unique (company_id, snapshot_date)
);
create index on public.health_snapshots (company_id);

-- ── usage / tickets / surveys ────────────────────────────────────────────────
create table public.usage_metrics (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies not null,
  metric_key text, metric_date date, value numeric,
  created_at timestamptz default now(), updated_at timestamptz,
  unique (company_id, metric_key, metric_date)
);
create index on public.usage_metrics (company_id);
create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies not null,
  external_ref text, priority text check (priority in ('p1','p2','p3','p4')),
  status text default 'open', opened_at timestamptz, resolved_at timestamptz,
  subject text, source text default 'manual', source_id text,
  created_at timestamptz default now(), updated_at timestamptz
);
create index on public.tickets (company_id);
create table public.nps_responses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies not null,
  contact_id uuid references public.contacts, score int, comment text, responded_at timestamptz,
  source text, source_id text,
  created_at timestamptz default now(), updated_at timestamptz
);
create index on public.nps_responses (company_id);
create table public.csat_responses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies not null,
  contact_id uuid references public.contacts, score int, comment text, responded_at timestamptz, context text,
  source text, source_id text,
  created_at timestamptz default now(), updated_at timestamptz
);
create index on public.csat_responses (company_id);

-- ── alerts ───────────────────────────────────────────────────────────────────
create table public.alert_rules (
  id uuid primary key default gen_random_uuid(),
  name text, description text, rule_type text, config jsonb default '{}',
  segment text[], enabled bool default true, severity text default 'warning',
  created_at timestamptz default now(), updated_at timestamptz
);
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid references public.alert_rules,
  company_id uuid references public.companies not null,
  owner_id uuid references public.profiles,
  title text, detail text, severity text,
  status text default 'open' check (status in ('open','acknowledged','resolved','snoozed')),
  snoozed_until timestamptz, dedupe_key text,
  created_at timestamptz default now(), updated_at timestamptz,
  unique (rule_id, company_id, dedupe_key)
);
create index on public.alerts (company_id);
create index on public.alerts (owner_id);

-- ── digests ──────────────────────────────────────────────────────────────────
create table public.digests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles not null,
  digest_type text check (digest_type in ('daily','weekly_exec')),
  digest_date date, content jsonb, narrative text,
  created_at timestamptz default now(), updated_at timestamptz,
  unique (user_id, digest_type, digest_date)
);

-- ── integrations / audit ──────────────────────────────────────────────────────
create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles,
  provider text check (provider in ('google','outreach','hubspot','fathom','aircall','planhat')),
  access_token text, refresh_token text, token_expires_at timestamptz,
  scopes text[], external_account_email text, status text default 'active',
  last_sync_at timestamptz, sync_cursor jsonb default '{}',
  created_at timestamptz default now(), updated_at timestamptz,
  unique (user_id, provider)
);
create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  provider text, connection_id uuid,
  started_at timestamptz default now(), finished_at timestamptz,
  ok bool, stats jsonb, error text,
  created_at timestamptz default now(), updated_at timestamptz
);
create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  kind text, company_id uuid, deal_id uuid, model text,
  input_summary text, output jsonb, applied_changes jsonb, created_by text default 'system',
  created_at timestamptz default now(), updated_at timestamptz
);
create index on public.ai_runs (company_id);

-- ── unmatched recording/call queue (admin queues, Section 5.4 / 6.6) ─────────
create table public.unmatched_recordings (
  id uuid primary key default gen_random_uuid(),
  provider text, external_id text, title text, payload jsonb,
  attendee_emails text[], phone text, status text default 'pending',
  linked_company_id uuid references public.companies,
  created_at timestamptz default now(), updated_at timestamptz,
  unique (provider, external_id)
);

-- ── updated_at triggers on every table ────────────────────────────────────────
do $$
declare t text;
begin
  for t in
    select table_name from information_schema.tables
    where table_schema='public' and table_type='BASE TABLE'
  loop
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at();', t
    );
  end loop;
end $$;
