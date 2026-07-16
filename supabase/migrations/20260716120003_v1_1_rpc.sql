-- ============================================================================
-- Compass V1.1 — 03. RPCs
-- ----------------------------------------------------------------------------
-- visible_company_ids(): the canonical "your book" resolver used by the
--   ask-compass Edge Function to hard-filter every tool (security definer so it
--   resolves the caller's scope even when the function runs on a service client).
-- ds_*: RLS-respecting dataset functions powering the Dashboards widget layer
--   (D2). SECURITY INVOKER so RLS restricts rows to the caller's book. group_by
--   is whitelisted per function (never interpolated raw) to prevent injection.
-- ============================================================================

create or replace function public.visible_company_ids()
returns setof uuid
language sql stable security definer set search_path = public as $$
  select c.id from companies c
  where c.owner_id = auth.uid()
     or auth.uid() = any(c.collaborator_ids)
     or is_manager_of(c.owner_id)
     or is_admin();
$$;

-- ── shared helpers ───────────────────────────────────────────────────────────
-- Bucket a health score into a band label.
create or replace function public._band(score numeric)
returns text language sql immutable as $$
  select case when score is null then '(none)'
              when score < 40 then 'red'
              when score < 70 then 'amber'
              else 'green' end;
$$;

-- ds_companies(filter, group_by, measure) → (label, value)
create or replace function public.ds_companies(
  filter jsonb default '{}', group_by text default 'segment', measure text default 'count'
) returns table(label text, value numeric)
language plpgsql stable security invoker set search_path = public as $$
declare col text;
begin
  col := case group_by
    when 'segment' then 'coalesce(segment,''(none)'')'
    when 'healthBand' then 'coalesce(health_band,''(none)'')'
    when 'owner' then 'coalesce(owner_id::text,''(none)'')'
    when 'phase' then 'coalesce(phase,''(none)'')'
    when 'region' then 'coalesce(region,''(none)'')'
    when 'status' then 'coalesce(status,''(none)'')'
    else 'coalesce(segment,''(none)'')' end;
  return query execute format($q$
    select %s as label,
      case %L when 'sum_arr' then coalesce(sum(arr),0)
              when 'avg_health' then round(avg(health_score)::numeric,1)
              else count(*)::numeric end as value
    from companies
    where (%L::jsonb->>'segment' is null or segment = %L::jsonb->>'segment')
      and (%L::jsonb->>'healthBand' is null or health_band = %L::jsonb->>'healthBand')
      and (%L::jsonb->>'owner' is null or owner_id::text = %L::jsonb->>'owner')
    group by 1 order by 2 desc $q$,
    col, measure, filter, filter, filter, filter, filter, filter);
end $$;

-- ds_renewals(filter, group_by, measure) → (label, value)  [renewal deals]
create or replace function public.ds_renewals(
  filter jsonb default '{}', group_by text default 'stage', measure text default 'sum_arr'
) returns table(label text, value numeric)
language plpgsql stable security invoker set search_path = public as $$
declare col text;
begin
  col := case group_by
    when 'stage' then 'coalesce(d.stage,''(none)'')'
    when 'forecast' then 'coalesce(d.forecast_category,''(none)'')'
    when 'quarter' then 'to_char(d.close_date,''YYYY"Q"Q'')'
    else 'coalesce(d.stage,''(none)'')' end;
  return query execute format($q$
    select %s as label,
      case %L when 'sum_arr' then coalesce(sum(d.amount),0)
              when 'count' then count(*)::numeric
              else coalesce(sum(d.amount),0) end as value
    from deals d
    where d.pipeline = 'renewal' and d.status = 'open'
    group by 1 order by 2 desc $q$, col, measure);
end $$;

-- ds_activities(filter, group_by, measure) → (label, value)
create or replace function public.ds_activities(
  filter jsonb default '{}', group_by text default 'type', measure text default 'count'
) returns table(label text, value numeric)
language plpgsql stable security invoker set search_path = public as $$
declare col text;
begin
  col := case group_by
    when 'type' then 'coalesce(type,''(none)'')'
    when 'user' then 'coalesce(user_id::text,''(none)'')'
    when 'month' then 'to_char(occurred_at,''YYYY-MM'')'
    else 'coalesce(type,''(none)'')' end;
  return query execute format($q$
    select %s as label, count(*)::numeric as value
    from activities
    where occurred_at > now() - interval '180 days'
    group by 1 order by 2 desc $q$, col);
end $$;

-- ds_health_trend(filter) → (label=month, value=avg overall)
create or replace function public.ds_health_trend(
  filter jsonb default '{}', group_by text default 'month', measure text default 'avg_health'
) returns table(label text, value numeric)
language sql stable security invoker set search_path = public as $$
  select to_char(snapshot_date,'YYYY-MM') as label,
         round(avg(overall)::numeric,1) as value
  from health_snapshots
  where snapshot_date > (current_date - interval '365 days')
  group by 1 order by 1;
$$;

-- ds_nps(filter, group_by) → (label=bucket, value=count) or trend by month
create or replace function public.ds_nps(
  filter jsonb default '{}', group_by text default 'bucket', measure text default 'count'
) returns table(label text, value numeric)
language plpgsql stable security invoker set search_path = public as $$
begin
  if group_by = 'month' then
    return query
      select to_char(responded_at,'YYYY-MM'), round(avg(score)::numeric,1)
      from nps_responses group by 1 order by 1;
  else
    return query
      select case when score >= 50 then 'promoter' when score < 0 then 'detractor' else 'passive' end,
             count(*)::numeric
      from nps_responses group by 1 order by 2 desc;
  end if;
end $$;

-- ds_tasks(filter, group_by, measure) → (label, value)
create or replace function public.ds_tasks(
  filter jsonb default '{}', group_by text default 'status', measure text default 'count'
) returns table(label text, value numeric)
language plpgsql stable security invoker set search_path = public as $$
declare col text;
begin
  col := case group_by
    when 'status' then 'case when completed_at is null then ''open'' else ''completed'' end'
    when 'priority' then 'coalesce(priority,''(none)'')'
    when 'type' then 'coalesce(task_type,''todo'')'
    when 'assignee' then 'coalesce(assignee_id::text,''(none)'')'
    else 'coalesce(priority,''(none)'')' end;
  return query execute format($q$
    select %s as label, count(*)::numeric as value
    from tasks group by 1 order by 2 desc $q$, col);
end $$;
