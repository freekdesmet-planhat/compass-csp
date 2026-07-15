-- ============================================================================
-- Compass — 04. search_all RPC (powers the ⌘K palette, Section 3)
-- ----------------------------------------------------------------------------
-- security invoker so RLS applies: a user only sees rows they can see.
-- ============================================================================

create or replace function public.search_all(q text)
returns table (kind text, id uuid, company_id uuid, title text, subtitle text)
language sql stable security invoker set search_path = public as $$
  with tsq as (select websearch_to_tsquery('simple', q) as query)
  select 'company'::text, c.id, c.id, c.name, coalesce(c.segment,'')
    from companies c, tsq where c.search_vector @@ tsq.query
  union all
  select 'contact', ct.id, ct.company_id, coalesce(ct.first_name,'')||' '||coalesce(ct.last_name,''), coalesce(ct.email,'')
    from contacts ct, tsq where ct.search_vector @@ tsq.query
  union all
  select 'deal', d.id, d.company_id, coalesce(d.name,''), coalesce(d.stage,'')
    from deals d, tsq where to_tsvector('simple', coalesce(d.name,'')) @@ tsq.query
  union all
  select 'note', n.id, n.company_id, coalesce(n.title,'Note'), left(coalesce(n.content_text,''), 80)
    from notes n, tsq where n.search_vector @@ tsq.query
  limit 30;
$$;
