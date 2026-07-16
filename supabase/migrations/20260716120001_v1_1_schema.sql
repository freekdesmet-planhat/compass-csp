-- ============================================================================
-- Compass V1.1 — 01. Schema additions
-- ----------------------------------------------------------------------------
-- New tables + column alters for V1.1. Shipped migrations are never edited; all
-- V1.1 schema lives in these v1_1_ files. Every new table carries the standard
-- id / created_at / updated_at shape and gets the set_updated_at trigger.
-- Filenames keep a timestamp prefix (CLI ordering) plus the v1_1_ tag.
-- ============================================================================

-- ── products (catalogue) + company_products (whitespace map, C5) ─────────────
create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  category text,
  position int,
  created_at timestamptz default now(), updated_at timestamptz
);

create table public.company_products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies not null,
  product_id uuid references public.products not null,
  status text not null default 'none'
    check (status in ('current','active_opp','need_to_discuss','rejected','none')),
  arr numeric,
  note text,
  updated_by uuid references public.profiles,
  created_at timestamptz default now(), updated_at timestamptz,
  unique (company_id, product_id)
);
create index on public.company_products (company_id);
create index on public.company_products (product_id);

-- ── notifications (D6) ───────────────────────────────────────────────────────
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles not null,
  kind text not null check (kind in ('mention','task_assigned','system')),
  title text, body text, link text,
  read_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz
);
create index on public.notifications (user_id, read_at);

-- ── library_items (D4) ───────────────────────────────────────────────────────
create table public.library_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  item_type text not null check (item_type in ('deck','doc','template','link')),
  url text,
  storage_path text,
  tags text[] default '{}',
  segments text[] default '{}',
  uploaded_by uuid references public.profiles,
  download_count int default 0,
  created_at timestamptz default now(), updated_at timestamptz
);

-- ── dashboards + widgets (D2) ────────────────────────────────────────────────
create table public.dashboards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid references public.profiles,
  shared bool default false,
  layout jsonb default '[]',
  created_at timestamptz default now(), updated_at timestamptz
);
create index on public.dashboards (owner_id);

create table public.dashboard_widgets (
  id uuid primary key default gen_random_uuid(),
  dashboard_id uuid references public.dashboards on delete cascade not null,
  position jsonb default '{}',
  kind text check (kind in ('metric','bar','line','donut','table')),
  dataset text,
  group_by text,
  measure text,
  filter jsonb default '{}',
  title text,
  created_at timestamptz default now(), updated_at timestamptz
);
create index on public.dashboard_widgets (dashboard_id);

-- ── import_runs (D3) ─────────────────────────────────────────────────────────
create table public.import_runs (
  id uuid primary key default gen_random_uuid(),
  entity text,
  mode text,
  stats jsonb default '{}',
  report_path text,
  run_by uuid references public.profiles,
  created_at timestamptz default now(), updated_at timestamptz
);

-- ── Ask Compass threads + messages (D1) ──────────────────────────────────────
create table public.ask_compass_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles not null,
  title text,
  created_at timestamptz default now(), updated_at timestamptz
);
create index on public.ask_compass_threads (user_id);

create table public.ask_compass_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references public.ask_compass_threads on delete cascade not null,
  role text not null check (role in ('user','assistant','tool')),
  content text,
  tool_calls jsonb,
  created_at timestamptz default now(), updated_at timestamptz
);
create index on public.ask_compass_messages (thread_id);

-- ── changelog_entries (D7) ───────────────────────────────────────────────────
create table public.changelog_entries (
  id uuid primary key default gen_random_uuid(),
  version text not null,
  released_on date,
  category text not null check (category in ('new','improved','fixed')),
  title text not null,
  body text,
  position int default 0,
  created_at timestamptz default now(), updated_at timestamptz,
  unique (version, title)
);

-- ── Column alters ────────────────────────────────────────────────────────────
alter table public.tasks
  add column task_type text default 'todo'
    check (task_type in ('todo','email','call','check_in','meeting'));
alter table public.tasks add column contact_id uuid references public.contacts;
create index on public.tasks (contact_id);

alter table public.companies add column latest_news text;
alter table public.companies add column latest_news_at timestamptz;
alter table public.companies add column latest_news_sources jsonb;

alter table public.profiles add column sidebar_collapsed bool default false;
alter table public.profiles add column last_seen_version text;

-- ── set_updated_at trigger on every new table ────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'products','company_products','notifications','library_items',
    'dashboards','dashboard_widgets','import_runs',
    'ask_compass_threads','ask_compass_messages','changelog_entries'
  ] loop
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at();', t
    );
  end loop;
end $$;
