-- ============================================================================
-- Compass V1.1 — 04. Seed (products catalogue, changelog, storage bucket)
-- ============================================================================

-- ── products catalogue (C5) ──────────────────────────────────────────────────
insert into public.products (name, category, position) values
  ('Core Licence',          'license',  1),
  ('SEO Intelligence',      'product',  2),
  ('Traffic Monitor',       'product',  3),
  ('Conversion Optimiser',  'product',  4),
  ('Consulting Services',   'services', 5),
  ('SEO Consulting',        'services', 6)
on conflict (name) do update set category = excluded.category, position = excluded.position;

-- ── changelog seed (D7) — mirrors CHANGELOG.md; changelog:sync keeps it fresh ─
insert into public.changelog_entries (version, released_on, category, title, body, position) values
  ('1.0.0','2026-07-14','new','Compass V1 launch','Portfolio review, 360s, health engine, renewals, playbooks, digests, ⌘K, integrations (Gmail/Calendar/Fathom/Aircall/HubSpot/Outreach), Planhat migration.',0),
  ('1.1.0','2026-07-16','fixed','360 quick actions wired','Log note / Task / Email / Meeting now open the right composer or modal; graceful disconnected-Gmail state.',1),
  ('1.1.0','2026-07-16','fixed','NPS page populated','Root-caused the empty NPS page, added manual "Log NPS response" and a proper empty state.',2),
  ('1.1.0','2026-07-16','improved','Collapsible sidebar','No more truncation; collapse toggle + "[" shortcut, persisted per user.',3),
  ('1.1.0','2026-07-16','improved','Everything is clickable','Portfolio KPI cards, report charts and dashboard widgets drill through to filtered views.',4),
  ('1.1.0','2026-07-16','new','Ask Compass','Chat with an agent about your book — renewals, usage, activity, all scoped to what you can see.',5),
  ('1.1.0','2026-07-16','new','Dashboards','Build, arrange and share widget dashboards from a safe dataset layer.',6),
  ('1.1.0','2026-07-16','new','CSV import','Import companies, contacts and usage metrics with mapping, validation and dedupe modes.',7),
  ('1.1.0','2026-07-16','new','Library','A shelf for QBR decks, one-pagers, templates and links.',8),
  ('1.1.0','2026-07-16','new','Whitespace map','Products × accounts heatmap to spot cross-sell plays; create expansion deals in a click.',9),
  ('1.1.0','2026-07-16','new','Contact 360','Every contact name links to a full record with activity, emails, meetings, NPS and tasks.',10),
  ('1.1.0','2026-07-16','new','Latest news','AI web-search news card on the 360, auto-refreshed weekly for enterprise accounts.',11),
  ('1.1.0','2026-07-16','new','Usage tab','Utilisation, per-metric charts and adoption grid driven by usage_metrics.',12),
  ('1.1.0','2026-07-16','new','@mentions & notifications','Mention teammates in notes; in-app bell + optional Slack DM.',13),
  ('1.1.0','2026-07-16','improved','Editable everywhere','MEDDIC toggles, contact fields, success-plan statuses and deal qualification are all hand-editable.',14)
on conflict (version, title) do update set body = excluded.body, category = excluded.category, position = excluded.position;

-- ── storage bucket for the Library (D4), 50MB cap ────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('library','library', false, 52428800)
on conflict (id) do nothing;

-- Library bucket policies: authenticated users read; uploader/admin write.
create policy "library read" on storage.objects for select
  using (bucket_id = 'library' and auth.uid() is not null);
create policy "library insert" on storage.objects for insert
  with check (bucket_id = 'library' and auth.uid() is not null);
create policy "library update" on storage.objects for update
  using (bucket_id = 'library' and (owner = auth.uid() or public.is_admin()));
create policy "library delete" on storage.objects for delete
  using (bucket_id = 'library' and (owner = auth.uid() or public.is_admin()));
