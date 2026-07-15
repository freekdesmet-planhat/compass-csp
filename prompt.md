# COMPASS — Internal Customer Success Platform (Single-Shot Build Prompt)

> **How to use this file:** Paste the entire contents into Claude Code (or Lovable) as your first message. It contains the full product spec, data model, real integration endpoints, migration mapping from our live Planhat tenant, AI feature specs, design system, and acceptance criteria. Build exactly what is specified; where something is genuinely ambiguous, make the pragmatic choice and note it in the README rather than stopping to ask.

---

## 0. Mission & context

You are building **Compass**, an internal Customer Success platform that replaces a combination of **Planhat, ChurnZero and Gainsight** for a 30–50 person CS organisation. Planhat is the current system of record and its historical data will be migrated in (Section 6.1). HubSpot remains the upstream CRM and the source of truth for renewal and expansion deals. The platform must feel like **Attio**: fast, dense, keyboard-driven, quiet visual design.

The one workflow that must be flawless from day one: **the morning portfolio review**. Every CSM opens Compass at 8am and sees exactly what to do today, what changed in their book of business this week, and — on every account — not just a health score but *why* it is that score, how it moved since last week, and 3 concrete recommendations to improve it.

**Users and segments.** Three CS motions with very different economics, each needing its own views, KPIs and cadences:

| Segment | Accounts / CSM | Contacts / account | Motion |
|---|---|---|---|
| `scaled` | ~150 | 1–2 | Automation-heavy, usage-driven, one-to-many |
| `mid_touch` | ~70 | 4–6 | Cadence-driven, renewal-focused |
| `enterprise` | ~15 | 10+ | Success-plan-driven, stakeholder-heavy, exec engagement |

Every new user is assigned a **role** (`csm`, `manager`, `admin`) and — for CSMs — a **segment**. The segment determines their default portfolio view, KPI cards, health-score weights, touch-cadence norms and alert thresholds. Managers see roll-ups across their team; admins see everything and configure the system.

**V1 feature priority (build in this order of importance):** customer 360 timeline → success plans → health scores → tasks + playbooks → renewals → portfolio dashboard → alerts/triggers → NPS/CSAT.

**Integrations in V1, with real OAuth/keys (no mocks):** Planhat (one-time migration), HubSpot (accounts + renewal/expansion deals, polling sync), Gmail (domain-matched auto-logging + send from the platform), Google Calendar (upcoming meetings + AI meeting prep + auto-log past meetings), Fathom (webhook: summaries, action items, AI risk/ask extraction, automatic deal-field updates), Aircall (webhook: calls + transcripts into the same AI pipeline), Outreach (read-only sequence/email/call activity per contact).

---

## 1. Tech stack & project setup

Chosen to work identically on **Netlify** (static SPA + Supabase backend) and **Lovable** (this is Lovable's native stack):

- **Frontend:** Vite + React 18 + TypeScript (strict) + Tailwind CSS + shadcn/ui components + React Router v6 + TanStack Query. Rich text: **Tiptap**. Charts: **Recharts**. Icons: **lucide-react**. Command palette: **cmdk**.
- **Backend:** **Supabase** — Postgres (with RLS on every table), Supabase Auth (Google provider), Edge Functions (Deno) for all integration syncs, webhooks and AI calls, `pg_cron` + `pg_net` for scheduling, Supabase Realtime for live alert/timeline updates.
- **AI:** Anthropic API called **only from Edge Functions** (never client-side). Default models: `claude-sonnet-4-6` for reasoning tasks (digests, meeting prep, health narratives, deal updates), `claude-haiku-4-5` for high-volume extraction/classification. Put model ids in env so they can be upgraded without code changes.
- **Deploy:** `netlify.toml` with SPA redirect (`/* -> /index.html 200`). All secrets live in Supabase Edge Function secrets, never in the frontend bundle. The only client-side env vars are `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

**Auth flow:** Sign in with Google via Supabase Auth. On first sign-in create a `profiles` row (default role `csm`, no segment) — an admin then assigns role/segment in Admin → Users. Request Google scopes incrementally: base sign-in is plain OpenID; a separate "Connect Gmail & Calendar" button in Settings re-runs `signInWithOAuth` with the extended scopes below and `access_type=offline`, `prompt=consent`, then stores the `provider_refresh_token` server-side (Section 6.3).

**Repository layout:**

```
/src                    # Vite React app
  /components/ui        # shadcn
  /components/app       # tables, timeline, health widgets, composer, cmd-k
  /pages                # route components (Section 7 screen list)
  /lib                  # supabase client, query hooks, formatting, segment presets
/supabase
  /migrations           # SQL (Section 3) — schema, RLS, pg_cron jobs, seed alert rules & playbooks
  /functions            # Edge Functions:
    sync-gmail          #   per-user Gmail poll
    sync-calendar       #   per-user Calendar poll
    sync-hubspot        #   org-level deal/company poll
    sync-outreach       #   org-level Outreach poll
    webhook-fathom      #   Fathom webhook receiver
    webhook-aircall     #   Aircall webhook receiver
    process-recording   #   shared AI pipeline for Fathom/Aircall transcripts
    compute-health      #   nightly compute + Sunday snapshot
    generate-digests    #   morning review + Monday week-recap + Friday exec summary
    generate-meeting-prep
    ai-generate         #   thin authenticated wrapper for on-demand AI (regenerate buttons)
    send-gmail          #   compose & send
/scripts
  migrate-planhat.ts    # Node script, run locally (Section 6.1)
  seed-demo.ts          # fallback demo data if no credentials present
netlify.toml
README.md               # full setup guide incl. Google Cloud steps (Section 10)
```

---

## 2. Roles, segments & permissions

**`profiles`** (1:1 with `auth.users`): `id uuid pk references auth.users`, `email`, `full_name`, `avatar_url`, `role text check in ('csm','manager','admin') default 'csm'`, `segment text check in ('scaled','mid_touch','enterprise') null`, `manager_id uuid references profiles`, `timezone text default 'Europe/Amsterdam'`, `digest_hour int default 7`, `is_active bool default true`, timestamps.

**Ownership model:** `companies.owner_id` (the CSM) plus `companies.collaborator_ids uuid[]`. A company's segment is stored on the company itself (`companies.segment`) — set from the owner's segment at assignment but editable, because books get rebalanced.

**RLS (implement exactly, on every table):**

```sql
-- helper functions (security definer)
create function is_admin() returns bool ...            -- role = 'admin'
create function is_manager_of(target uuid) returns bool -- exists profile where id=target and manager_id=auth.uid()
create function can_see_company(cid uuid) returns bool as $$
  select exists (
    select 1 from companies c
    where c.id = cid and (
      c.owner_id = auth.uid()
      or auth.uid() = any(c.collaborator_ids)
      or is_manager_of(c.owner_id)
      or is_admin()
    ));
$$;
```

- `companies` and every company-scoped table (`contacts`, `activities`, `notes`, `tasks`, `deals`, `health_snapshots`, `success_plans`, `alerts`, `emails`, `calendar_events`, `meeting_preps`, `nps_responses`, `tickets`, `usage_metrics`, …): SELECT gated by `can_see_company(company_id)`; INSERT/UPDATE gated by the same minus collaborators-read-only where noted.
- `profiles`: everyone can read basic fields of active profiles (needed for owner pickers); only admins update role/segment/manager.
- `health_configs`, `alert_rules`, `playbook_templates`: read all authenticated; write admin only.
- `integration_connections`: row owner or admin only. `digests`: owner only (managers' exec digests are their own rows).
- Edge Functions use the service-role key and bypass RLS; they must therefore scope every query explicitly by ids they resolved themselves.

**Segment presets** live in one typed constant `src/lib/segments.ts` and drive defaults everywhere:

```ts
export const SEGMENT_PRESETS = {
  scaled:     { touchSlaDays: 90, expectedActiveContacts: 1,  meetingNormPerQuarter: 0,
                kpis: ['health_distribution','at_risk_count','no_touch_60d','usage_adoption_pct','nps_response_rate','playbook_completion','renewal_rate_count'] },
  mid_touch:  { touchSlaDays: 45, expectedActiveContacts: 3,  meetingNormPerQuarter: 2,
                kpis: ['health_weighted_arr','renewals_90d_arr','at_risk_arr','meetings_this_week','expansion_pipeline','nps_trend'] },
  enterprise: { touchSlaDays: 21, expectedActiveContacts: 6,  meetingNormPerQuarter: 6,
                kpis: ['success_plan_progress','stakeholder_coverage','exec_engagement_recency','nrr','at_risk_arr','qbr_compliance'] },
} as const;
```

Managers get a segment filter on every roll-up view instead of a single-segment lens.

---

## 3. Data model (Postgres / Supabase migrations)

All tables: `id uuid pk default gen_random_uuid()`, `created_at timestamptz default now()`, `updated_at timestamptz` (trigger). Company-scoped tables carry `company_id uuid references companies not null` and an index on it. Anything migrated or synced carries `source text` (`planhat|hubspot|gmail|gcal|fathom|aircall|outreach|app`) and `source_id text` with a unique index on `(source, source_id)` for idempotency.

```sql
companies (
  name text not null, domains text[] default '{}', website text, country text, city text,
  owner_id uuid references profiles, collaborator_ids uuid[] default '{}',
  segment text check (segment in ('scaled','mid_touch','enterprise')),
  phase text,                                  -- lifecycle: onboarding|adoption|renewal|...
  status text default 'customer',              -- prospect|customer|churned
  tier text, region text, tags text[],
  mrr numeric, arr numeric,
  renewal_date date, renewal_arr numeric,      -- kept in sync from HubSpot renewal deal
  hubspot_company_id text unique,
  -- health (latest cached; history in health_snapshots)
  health_score numeric, health_band text, health_delta_wow numeric, health_updated_at timestamptz,
  -- CSM-authored fields (migrated from Planhat, editable in UI)
  value_score numeric,                         -- manual 1–10 "value to client"
  value_comment text,                          -- CSM comment on value dimension
  sentiment_assessment numeric,                -- manual 1–10 CSM sentiment
  exec_relationship_flag boolean default false,
  red_flags text, green_flags text,
  next_step text, path_to_green text,
  handover_notes text,
  ai_account_summary text, ai_risk_summary text, ai_renewal_summary text,
  last_touch_at timestamptz, last_touch_type text, next_touch_at timestamptz
)

contacts (
  company_id, first_name, last_name, email text, other_emails text[], phone text,
  title text, department text, seniority text, linkedin_url text,
  contact_role text check (contact_role in ('exec_sponsor','decision_maker','main_user','tech_ops','end_user')),
  relationship_strength numeric,               -- 1–10
  is_primary bool, is_champion bool, has_influence bool, is_advocate bool, advocate_type text,
  reports_to_contact_id uuid references contacts,
  nps_latest int, nps_latest_at timestamptz, sentiment_30d text,
  engagement_score numeric,                    -- migrated Planhat relevance/beats, then recomputed
  last_active_at timestamptz, last_touch_at timestamptz, archived bool default false
)

activities (                                    -- the unified 360 timeline
  company_id, contact_ids uuid[], user_id uuid references profiles,
  type text check (type in ('email','meeting','call','note','nps','task','system','ticket')),
  direction text,                               -- inbound|outbound where meaningful
  title text, snippet text, body_ref uuid,      -- body stored on the source table, not duplicated
  occurred_at timestamptz not null,
  meta jsonb default '{}'                       -- e.g. {fathom_url, action_items:[...], risks:[...], asks:[...], sentiment}
)  -- index (company_id, occurred_at desc)

notes    ( company_id, contact_id, author_id, title text, content jsonb, content_text text, pinned bool )  -- Tiptap JSON + plain text for search
emails   ( company_id, contact_ids uuid[], connection_id uuid, gmail_message_id text, gmail_thread_id text,
           direction text, from_email text, to_emails text[], cc_emails text[], subject text, snippet text,
           body_html text,                       -- only populated when STORE_EMAIL_BODIES=true; else fetched on demand
           sent_at timestamptz )
calendar_events ( company_id, connection_id uuid, gcal_event_id text, ical_uid text, title text,
           starts_at timestamptz, ends_at timestamptz, attendee_emails text[], organizer_email text,
           meet_link text, status text, matched_contact_ids uuid[], logged_activity_id uuid, fathom_recording_id uuid )
meeting_preps ( company_id, calendar_event_id uuid unique, content jsonb, narrative text, generated_at timestamptz, stale bool )

tasks (
  company_id, assignee_id uuid references profiles, creator_id uuid,
  title text not null, description text, due_date date, completed_at timestamptz,
  priority text check (priority in ('low','normal','high')) default 'normal',
  origin text check (origin in ('manual','playbook','ai_call','ai_recommendation','alert')) default 'manual',
  playbook_run_step_id uuid, source_activity_id uuid
)

playbook_templates ( name, description, segment text[],          -- which segments it applies to
  trigger text check (trigger in ('manual','phase_change','renewal_t_minus','health_drop','new_customer')),
  trigger_config jsonb )                                          -- e.g. {"days_before_renewal":120} or {"to_phase":"onboarding"}
playbook_template_steps ( template_id, position int, title, description, relative_due_days int, default_priority text )
playbook_runs ( template_id, company_id, started_by uuid, started_at, status text default 'active', completed_at )
playbook_run_steps ( run_id, template_step_id, task_id uuid, status text default 'pending' )

success_plans ( company_id, name text, owner_id uuid, status text default 'active', target_date date, progress_pct numeric )
success_plan_objectives ( plan_id, company_id, title text not null, business_outcome text, metric text,
  target_date date, status text check (status in ('not_started','on_track','at_risk','achieved','missed')) default 'not_started',
  position int, notes text )
-- objectives link tasks via tasks.meta? No: add success_plan_objective_id uuid null on tasks.

deals (                                          -- HubSpot is source of truth; Planhat opps seed history
  company_id, hubspot_deal_id text unique, pipeline text,         -- 'renewal' | 'expansion' | 'new_business'
  stage text, stage_probability numeric, forecast_category text,  -- pipeline|best_case|commit|closed|omitted
  name text, amount numeric, currency text default 'USD',
  close_date date, owner_id uuid, status text check (status in ('open','won','lost')) default 'open',
  next_steps text, ai_summary text, confidence numeric,           -- AI-maintained (Section 5.4)
  qualification jsonb default '{}',                               -- MEDDIC/BANT flags migrated from Planhat
  suggested_stage text, suggested_stage_reason text,              -- AI suggestion awaiting one-click approval
  contact_ids uuid[], last_synced_at timestamptz
)

health_configs (                                 -- one row per segment, admin-editable
  segment text unique not null,
  weights jsonb not null,      -- {"value":20,"engagement":20,"support":25,"sentiment":20,"usage":15} must sum to 100
  thresholds jsonb not null default '{"red":40,"amber":70}',
  input_config jsonb not null  -- per-dimension tunables, see Section 4
)
health_snapshots (
  company_id, snapshot_date date, is_weekly bool default false,
  overall numeric, band text, delta_wow numeric,
  dimensions jsonb not null,   -- {"value":{"score":62,"inputs":{...},"contribution":12.4}, "engagement":{...}, ...}
  explanation text,            -- AI "why" narrative
  recommendations jsonb,       -- [{"title","why","suggested_task":{"title","due_in_days"}} x3]
  unique (company_id, snapshot_date)
)
usage_metrics ( company_id, metric_key text, metric_date date, value numeric, unique(company_id, metric_key, metric_date) )
tickets ( company_id, external_ref text, priority text check (priority in ('p1','p2','p3','p4')),
          status text default 'open', opened_at timestamptz, resolved_at timestamptz, subject text, source text default 'manual' )
nps_responses ( company_id, contact_id, score int, comment text, responded_at timestamptz )
csat_responses ( company_id, contact_id, score int, comment text, responded_at timestamptz, context text )

alert_rules ( name, description, rule_type text, config jsonb, segment text[], enabled bool default true, severity text default 'warning' )
alerts ( rule_id, company_id, owner_id uuid, title text, detail text, severity text,
         status text check (status in ('open','acknowledged','resolved','snoozed')) default 'open',
         snoozed_until timestamptz, dedupe_key text, unique (rule_id, company_id, dedupe_key) )

digests ( user_id, digest_type text check (digest_type in ('daily','weekly_exec')), digest_date date,
          content jsonb, narrative text, unique (user_id, digest_type, digest_date) )

integration_connections (                        -- per-user Google/Outreach; org-level rows have user_id null
  user_id uuid references profiles, provider text check (provider in ('google','outreach','hubspot','fathom','aircall','planhat')),
  access_token text, refresh_token text, token_expires_at timestamptz,
  scopes text[], external_account_email text, status text default 'active',
  last_sync_at timestamptz, sync_cursor jsonb default '{}',       -- gmail historyId, gcal syncToken, hubspot lastmodified, outreach page cursors
  unique (user_id, provider)
)
sync_runs ( provider text, connection_id uuid, started_at, finished_at, ok bool, stats jsonb, error text )
ai_runs   ( kind text, company_id uuid, deal_id uuid, model text, input_summary text,
            output jsonb, applied_changes jsonb, created_by text default 'system' )   -- full audit of every AI write
```

Tokens in `integration_connections` are encrypted at rest with `pgsodium` (Supabase Vault); never expose this table through the client — access only via Edge Functions.

Add `search_vector tsvector` (generated) on `companies(name)`, `contacts(name,email)`, `notes(content_text)`, `activities(title,snippet)` and one `search_all` RPC powering the ⌘K palette.

---

## 4. Health score engine (per-segment, configurable, explainable)

Five dimensions, each normalised to 0–100, combined as a weighted average using the owning segment's `health_configs.weights`. This extends our current Planhat scorecard (Value to client / Engagement / Support & performance / Sentiment) with a fifth computed **Usage** dimension.

**Default weights (seed `health_configs`; admin-adjustable with sliders that must sum to 100):**

| Dimension | enterprise | mid_touch | scaled | Notes |
|---|---|---|---|---|
| Value to client | 20 | 10 | 0 | Manual CSM 1–10 doesn't scale to 150 accounts |
| Engagement | 20 | 20 | 20 | |
| Support / performance | 25 | 25 | 20 | Kept high — platform-performance issues flagged in current scorecard |
| Sentiment | 20 | 20 | 15 | |
| Usage | 15 | 25 | 45 | Scaled motion is usage-led |

**Dimension inputs (compute in `compute-health`; store raw inputs in the snapshot for explainability):**

1. **Value to client** — `companies.value_score` (manual 1–10 → ×10). Missing = excluded and weight redistributed pro-rata (never punish an unset manual field). `value_comment` shown alongside.
2. **Engagement** — (a) inbound-email recency & reply rate over 30d from `emails`; (b) meetings last 90d vs `meetingNormPerQuarter` for the segment; (c) **stakeholder breadth**: distinct contacts with any touch in 90d vs `expectedActiveContacts`. Equal thirds, each capped at 100.
3. **Support / performance** — open P1 (−40 each) and P2 (−15 each) from `tickets`, average resolution days last 90d vs a 5-day target, incident count. Start at 100 and subtract; floor 0. No ticket data at all → neutral 75 (we have no ticketing integration in V1; tickets arrive from the Planhat migration and manual entry — Zendesk/Jira sync is v1.1, so make the input source pluggable).
4. **Sentiment** — blend of `sentiment_assessment` (manual 1–10), latest company NPS (−100..100 → 0..100), average `relationship_strength` of exec_sponsor/decision_maker contacts, rolling call-sentiment from Fathom/Aircall extractions, and `exec_relationship_flag` (+10 bonus). Weighted 30/25/20/15/10.
5. **Usage** — from `usage_metrics`, keys configured per segment in `input_config`, e.g. `{"usage": {"wau_metric":"weekly_active_users","seats_metric":"licensed_seats","adoption_metrics":["feature_x_users"],"trend_weeks":4}}`. Score = 50% utilisation (WAU/seats), 30% adoption breadth, 20% four-week trend slope (positive slope 100 / flat 50 / declining 0, linear in between).

**Cadence:** nightly recompute updates the cached fields on `companies`; every **Sunday 23:00** write an `is_weekly` snapshot per company — `delta_wow` compares weekly snapshots. Recompute a company immediately when: weights change (admin), value/sentiment manual fields change, an NPS lands, or a recording is processed.

**Explainability (this is the heart of requirement #7):** after each weekly snapshot (and on demand via the Health tab's regenerate button), call the AI with the current + previous snapshot's dimension inputs and the last 14 days of timeline titles. It must return: (a) a ≤120-word **"Why this score"** paragraph citing the actual driving inputs ("Support dragged −18: two P1s open 11 days…"); (b) exactly **3 recommendations**, each with a one-line rationale tied to a real datapoint and a `suggested_task` the UI renders with a **"Create task"** one-click button (origin `ai_recommendation`). Deterministic per-dimension contribution math (weight × score) is computed in code and displayed as bars — the AI only narrates, it never invents numbers. Store both in the snapshot.

The Health tab also renders a **12-month history sparkline** — seeded on day one by the migrated Planhat health metrics (Section 6.1 maps `usage.Health Yesterday/7/14/30/60 days ago` plus the legacy `h` field into backfilled `health_snapshots` with `source='planhat'`).

---

## 5. AI layer (all via Edge Functions; log every run + every applied change to `ai_runs`)

### 5.1 Morning portfolio review (`generate-digests`, daily)
Runs hourly; generates for users whose local time (profile timezone) just passed `digest_hour`. Assemble deterministically, then have `claude-sonnet-4-6` write a ≤150-word narrative "Top 3 priorities today" that references the assembled facts only. Store in `digests`; render as the **Home** screen (not an email) with a "regenerate" button. Contents:
- Today's meetings with links to their **meeting prep** briefs
- Tasks due/overdue; unprocessed action items from yesterday's calls
- New alerts since yesterday, grouped by severity
- Health movers: accounts whose cached score moved ≥5 pts overnight
- Renewal checkpoints: accounts crossing T-120/90/60/30 today
- **Monday edition** prepends a "Last week in your book" recap: WoW health movers, meetings held, emails exchanged, NPS received, renewal stage changes, tasks completed vs created.

### 5.2 Weekly exec summary (managers, Fridays 16:00 local)
Per manager: roll up their team — portfolio health distribution and WoW movement per segment, renewal forecast (Section 7 Renewals math) and its change vs last week, top 5 risk accounts with one-line reasons, activity stats per CSM, wins (health recoveries, closed renewals, NPS promoters). Sonnet writes an exec-readable ≤250-word summary; the deterministic tables render below it. Stored as `digests.digest_type='weekly_exec'`.

### 5.3 Meeting prep (`generate-meeting-prep`, hourly)
For every `calendar_events` row starting in the next 24h matched to a company and not yet prepped (or `stale=true`): build a brief with (a) account snapshot — ARR, phase, renewal countdown, health + WoW delta + top drag dimension; (b) open items — overdue tasks, unresolved risks/asks extracted from the last 3 calls; (c) last 3 touchpoints, one line each; (d) deal status incl. `next_steps` if an open deal exists; (e) attendee cards — role, relationship strength, last contact, one personal note if present; (f) a suggested agenda (3–5 bullets) aligned to the success plan objectives. Mark preps `stale` when a new activity lands on the company before the meeting. Surface: Home digest, the calendar card on the 360, and a slide-over from the meeting itself.

### 5.4 Post-call pipeline (`process-recording` — shared by Fathom & Aircall)
Input: transcript + summary + metadata. Steps:
1. Match company (attendee email → contacts → company; fallback attendee domain → `companies.domains`; if no match, park in an "Unmatched recordings" admin queue with a link-to-company picker).
2. Create the timeline activity (`type='meeting'` or `'call'`) with the summary and action items in `meta`.
3. `claude-sonnet-4-6` extraction pass → strict JSON: `{risks[], asks[], decisions[], sentiment(-1..1), next_steps, renewal_signals[], expansion_signals[]}`.
4. Create one task per action item (assignee = account owner, due = mentioned date or +3 business days, origin `ai_call`).
5. **If the company has an open deal:** rewrite `deals.next_steps` (imperative, ≤3 bullets) and refresh `deals.ai_summary` (≤80 words, state + momentum + blockers), update `confidence`; if the transcript clearly implies a stage change, write `suggested_stage` + reason — **never move the stage automatically**; the deal card shows an approve/dismiss chip. When `HUBSPOT_WRITEBACK=true`, PATCH the HubSpot deal's next-step/description properties (Section 6.2).
6. Feed `sentiment` into the rolling call-sentiment input and trigger a health recompute.
The rep should have to do **nothing** after a call except glance at the result.

### 5.5 On-demand (`ai-generate`)
Authenticated wrapper (verify the caller can see the company) for: regenerate health narrative, regenerate prep, summarise a long note to a timeline snippet, draft an email reply in the composer given the thread + account context. Rate-limit per user; temperature 0.2; every prompt instructs: cite only provided data, no invented numbers, return the exact JSON schema requested.

---

## 6. Integrations — real endpoints, auth, sync design

> Endpoint references below are correct as of mid-2026; verify field-level details against each vendor's current docs during the build (Planhat: docs.planhat.com · HubSpot: developers.hubspot.com · Google: developers.google.com/gmail + /calendar · Fathom: developers.fathom.ai · Aircall: developer.aircall.io · Outreach: developers.outreach.io). Every sync must be **idempotent** (upsert on `(source, source_id)`), **cursor-based** (persist cursors in `integration_connections.sync_cursor`), logged to `sync_runs`, and resilient (retry 429/5xx with exponential backoff; on repeated failure mark the connection `status='error'` and raise an admin alert).

### 6.1 Planhat — one-time historical migration (`scripts/migrate-planhat.ts`)

Local Node script (not an Edge Function — it will run for a while). Re-runnable and idempotent via `source='planhat', source_id=<planhat _id>`. **Base URL `https://api.planhat.com`, header `Authorization: Bearer $PLANHAT_API_TOKEN`.** Paginate everything with `limit=2000&offset=N`; throttle ~5 req/s. Migration order and endpoints:

| Step | Endpoint | → Compass |
|---|---|---|
| 1 | `GET /users` | map Planhat user `_id`/email → `profiles` by email (report unmatched) |
| 2 | `GET /companies` | `companies` (mapping below) |
| 3 | `GET /endusers` | `contacts` (mapping below) |
| 4 | `GET /licenses` | seed `companies.mrr/arr`; keep a raw copy in `usage_metrics` (`metric_key='license_mrr'`) for history |
| 5 | `GET /opportunities` | `deals` (mapping below) |
| 6 | `GET /conversations` | `activities` — map Planhat `type` email→email, call→call, chat/ticket→ticket, note/custom→note; `date`→`occurred_at`; `subject`/`snip`→title/snippet; resolve `users`/`endUsers` refs |
| 7 | `GET /tasks` | `tasks` (open + completed in last 12 months) |
| 8 | `GET /nps` | `nps_responses` |
| 9 | `GET /objectives` | `success_plans` (one "Migrated success plan" per company that has objectives) + `success_plan_objectives` |
| 10 | `GET /churn` | tag churned companies `status='churned'` + a `system` activity with the churn reason |
| 11 | `GET /customfields?parent=Company` (and `parent=EndUser`) | verify the custom-field mapping below still matches; warn on drift |
| 12 | `GET /dimensiondata?cId={companyId}&dimid={dimensionId}&from={days}&to={days}` (from/to are **days since epoch**) | `usage_metrics` for the usage-dimension metric ids listed in `MIGRATE_DIMENSION_IDS` env |

**Company field mapping — these are our tenant's real field keys (verified via API on 2026-07-14):**

| Planhat field | Compass |
|---|---|
| `name`, `domains`, `web`, `country`, `city`, `phase`, `status`, `tags` | same-named columns |
| `owner` (fallback `custom.CSM`) | `owner_id`; `coOwner` + `collaborators` → `collaborator_ids` |
| `custom.Customer Tier` (Enterprise\|Mid-Market\|SMB) | `tier`, and `segment`: Enterprise→`enterprise`, Mid-Market→`mid_touch`, SMB→`scaled`; **override:** `custom.Customer Type` = Scaled or Pooled → `scaled` |
| `custom.Region` | `region` |
| `mrr`, `arr` | `mrr`, `arr` |
| `renewalDate`, `renewalArr` | `renewal_date`, `renewal_arr` (seed values; HubSpot sync owns them afterwards) |
| `csmScore` (1–5) | `value_score` ×2 → 1–10 scale; note the conversion in README |
| `custom.CSM Score Notes` | `value_comment` |
| `sentimentScore` | seed `sentiment_assessment` (normalise to 1–10) |
| `custom.Red Flags` / `custom.Green Flags` | `red_flags` / `green_flags` |
| `custom.Next Step` | `next_step` |
| `custom.Action Plan` | `path_to_green` |
| `custom.Sales to CS - Handover` | `handover_notes` |
| `custom.(AI) Account Summary` / `(AI) Risk Summary` / `(AI) Renewal Summary` | `ai_account_summary` / `ai_risk_summary` / `ai_renewal_summary` (day-one content until Compass regenerates) |
| `h` (0–10) + `usage.Health Yesterday` / `…7 days ago` / `…14…` / `…30…` / `…60 days ago` | backfilled `health_snapshots` (×10 to 0–100), giving the sparkline history from day one |
| `lastTouch`, `lastTouchByType.*`, `nextTouch` | `last_touch_at`, `last_touch_type`, `next_touch_at` |
| `nps` | ignore (recomputed from `nps_responses`) |

**EndUser mapping (real keys):** `firstName/lastName/email/otherEmails/phone/position/linkedInUrl` → same; `primary`→`is_primary`; `featured`→`is_champion`; `archived`; `custom.User Type` → `contact_role` (Exec Sponsor→exec_sponsor, Decision Maker→decision_maker, Main User→main_user, Tech / Ops→tech_ops, End User→end_user); `custom.Relationship`→`relationship_strength`; `custom.Has Influence?`→`has_influence`; `custom.Advocate?`/`custom.Advocate Type`→`is_advocate`/`advocate_type`; `custom.Department`→`department`; `custom.Seniority`→`seniority`; `custom.Reporting To`→`reports_to_contact_id` (second pass after all contacts exist); `custom.Sentiment Last 30 Days`→`sentiment_30d`; `nps`+`npsComment`+`npsDate`→ a `nps_responses` row; `relevance`/`beats`/`beatTrend`→`engagement_score` seed; `lastActive`→`last_active_at`.

**Opportunity mapping (real keys):** `title`→`name`; `companyId`; `ownerId`; `salesStage`→`stage`; `status` active→open/won/lost; `arr` (fallback `mrr`×12)→`amount`; `dealDate`→`close_date` (forecast) with `closeDate` overriding when won/lost; `custom.Pipeline` (New Business\|Expansion)→`pipeline` lowercase; `custom.Forecast Category`→`forecast_category` snake_case; `custom.Next Steps`→`next_steps`; `custom.Summary`→`ai_summary` seed; `custom.(AI) Confidence Score`→`confidence`; MEDDIC/BANT fields (`custom.Champion`, `custom.Economic Buyer`, `custom.Decision Criteria`, `custom.Identify Pain`, `custom.Budget/Need/Timeline/Authority`, …)→`qualification` jsonb; `custom.Decision Maker`+`custom.Involved Contacts`→`contact_ids`. Renewal-pipeline deals come from HubSpot, not Planhat.

The script ends with a **reconciliation report**: counts per model in Planhat vs Compass, unmatched owners, companies without domains (breaks email matching — list them), and custom-field drift warnings.

### 6.2 HubSpot — accounts + renewal/expansion deals (poll every 15 min, `sync-hubspot`)

Org-level **private app token**: `Authorization: Bearer $HUBSPOT_PRIVATE_APP_TOKEN` against `https://api.hubapi.com`.
- Pipelines metadata once per sync: `GET /crm/v3/pipelines/deals` → map stage ids → labels + `probability`. Env `HUBSPOT_RENEWAL_PIPELINE_ID` and `HUBSPOT_EXPANSION_PIPELINE_ID` select which pipelines sync.
- Companies: `POST /crm/v3/objects/companies/search` filtered on `hs_lastmodifieddate GT {cursor}`, properties `name,domain,annualrevenue`; match to Compass by `hubspot_company_id`, else by domain, else create (`source='hubspot'`).
- Deals: `POST /crm/v3/objects/deals/search` same cursor pattern, properties `dealname,pipeline,dealstage,amount,closedate,hubspot_owner_id,hs_deal_stage_probability,description`; associations via `GET /crm/v4/objects/deals/{dealId}/associations/companies`. Upsert into `deals`; when a **renewal** deal changes, refresh `companies.renewal_date/renewal_arr` from it.
- **Write-back (flag `HUBSPOT_WRITEBACK`):** when the post-call pipeline updates `next_steps`/`ai_summary` on a HubSpot-sourced deal, `PATCH /crm/v3/objects/deals/{dealId}` with the mapped properties (default `hs_next_step` and `description`; property names configurable). Never write stages.

### 6.3 Google OAuth + Gmail (per-user; poll every 10 min, `sync-gmail`)

**OAuth:** Google Cloud project → OAuth consent screen (**Internal**) → Web client. Authorized redirect URI = `https://<supabase-project>.supabase.co/auth/v1/callback`. Enable **Gmail API** and **Google Calendar API**. In Supabase Auth → Google provider, set client id/secret. The Settings "Connect Gmail & Calendar" button calls:

```ts
supabase.auth.signInWithOAuth({ provider: 'google', options: {
  scopes: 'openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar.readonly',
  queryParams: { access_type: 'offline', prompt: 'consent' },
}})
```

On callback, persist `provider_refresh_token` into `integration_connections (provider='google')`. Edge functions refresh access tokens via `POST https://oauth2.googleapis.com/token` (`grant_type=refresh_token`).

**Sync (base `https://gmail.googleapis.com/gmail/v1`):** first run `GET /users/me/messages?q=newer_than:30d -in:chats&maxResults=100` (page through), thereafter incremental `GET /users/me/history?startHistoryId={cursor}&historyTypes=messageAdded`; store the new `historyId` as cursor. For each message `GET /users/me/messages/{id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date`.
**Matching:** participant emails → `contacts.email/other_emails` → company; else **domain match** on `companies.domains` — excluding `$ORG_EMAIL_DOMAIN` and a built-in freemail list (gmail.com, outlook.com, …). Ambiguous domain (multiple companies) → attach to all matches' timelines but flag `meta.ambiguous=true`. Store metadata + snippet only; fetch body on demand in the UI with `format=full` unless `STORE_EMAIL_BODIES=true`. Create the `emails` row + an `activities` row.
**Send from the platform (`send-gmail`):** composer on the 360 (and reply from a thread) → build RFC 2822, base64url-encode → `POST /users/me/messages/send` with `{"raw": ...}` (include `threadId` for replies). Log the activity immediately; the next poll dedupes by `gmail_message_id`.

### 6.4 Google Calendar (per-user; poll every 15 min, `sync-calendar`)

Base `https://www.googleapis.com/calendar/v3`. Initial: `GET /calendars/primary/events?timeMin={now-7d}&timeMax={now+30d}&singleEvents=true&orderBy=startTime`, then incremental with `syncToken` (handle 410 GONE → full resync). Match attendees exactly like Gmail. Upcoming events render on the 360 and Home; each gets **meeting prep** (5.3). When an event's end time passes: auto-create a `meeting` activity — **unless** a Fathom recording already matched this meeting (same `ical_uid`, or overlapping time + ≥1 shared attendee), in which case link them (`calendar_events.fathom_recording_id`) instead of duplicating.

### 6.5 Fathom (webhook-first; API key)

Base `https://api.fathom.ai/external/v1`, header `X-Api-Key: $FATHOM_API_KEY`.
- Register on boot (idempotent): `POST /webhooks` `{ "destination_url": "https://<project>.supabase.co/functions/v1/webhook-fathom", "include_transcript": true, "include_summary": true, "include_action_items": true }`; manage with `GET /webhooks`, `DELETE /webhooks/{id}`.
- Backfill / safety-net poll (hourly): `GET /meetings?created_after={cursor}&include_transcript=true&include_summary=true&include_action_items=true`.
- Webhook payload → store recording (title, url, attendees, transcript, summary, action items) → **`process-recording` pipeline (5.4)**. Verify the webhook secret header; respond 200 fast and process async.

### 6.6 Aircall (webhook + REST; Basic auth)

Base `https://api.aircall.io/v1`, `Authorization: Basic base64($AIRCALL_API_ID:$AIRCALL_API_TOKEN)`.
- Webhook: create in Aircall dashboard (or `POST /webhooks`) pointing at `.../functions/v1/webhook-aircall`, events `call.ended`, `call.commented`, `call.tagged`; validate the webhook token.
- On `call.ended`: `GET /calls/{id}` for direction, duration, user, raw phone number, recording url. Match by phone → `contacts.phone` (normalise E.164); unmatched → admin "Unmatched calls" queue. Create a `call` activity.
- If the Aircall AI add-on is enabled, fetch `GET /calls/{id}/transcription` (poll a few minutes after call end) and run the transcript through **the same `process-recording` pipeline** — one pipeline, two sources.

### 6.7 Outreach (org-level OAuth; read-only; poll every 30 min, `sync-outreach`)

- OAuth (admin connects once in Admin → Integrations): `GET https://api.outreach.io/oauth/authorize?client_id=$OUTREACH_CLIENT_ID&redirect_uri=$OUTREACH_REDIRECT_URI&response_type=code&scope=accounts.read prospects.read sequences.read sequenceStates.read mailings.read calls.read users.read` → exchange at `POST https://api.outreach.io/oauth/token`; refresh likewise.
- API base `https://api.outreach.io/api/v2` (JSON:API). Match prospects by email: `GET /prospects?filter[emails]={email}`. Sync per matched contact: `sequenceStates` (active sequence + step + state), recent `mailings` (opens/clicks/replies) and `calls` filtered by `updatedAt` cursor, `page[size]=100`.
- Render an **Outreach panel** on the contact card (current sequence, step, last touch) and write mailing/call events into `activities` (source `outreach`, deduped against Gmail/Aircall by message-id/time+number so nothing appears twice). Sequence enrollment from Compass is v1.1.

### Sync schedule (pg_cron → pg_net → Edge Functions)

| Job | Cadence |
|---|---|
| `sync-gmail` (per connected user) | */10 min |
| `sync-calendar` | */15 min |
| `sync-hubspot` | */15 min |
| `sync-outreach` | */30 min |
| `fathom` backfill poll | hourly |
| `generate-meeting-prep` | hourly |
| `compute-health` | nightly 02:00 UTC (+ weekly snapshot Sun 23:00 UTC) |
| `generate-digests` | hourly (fires per-user at their local digest hour; Friday run adds `weekly_exec` for managers) |
| `alert-evaluator` | */30 min (evaluates `alert_rules`, upserts `alerts` on `dedupe_key`) |

---

## 7. Screens & UX — Attio design language

This is a **pinned visual direction: make it look and feel like Attio.** Quiet, dense, fast, keyboard-first. Do not build a colorful dashboard product.

**Design tokens (define as Tailwind theme + CSS vars):**
- Type: Inter; base **13px**, table text 13px, section titles 14px/600, page titles 18px/600. Tabular numerals for all metrics.
- Colors: background `#FFFFFF`, sidebar/panels `#FAFAFA`, borders `#EAECF0` (1px everywhere, almost no shadows — one subtle shadow level for popovers), text primary `#101828`, secondary `#667085`, accent (links/primary buttons/focus) `#2563EB`. Health: green `#12B76A`, amber `#F79009`, red `#F04438` — used as 8px dots and soft-tinted chips (e.g. `#ECFDF3` bg), never as large fills.
- Radii 8px (6px chips/inputs); row height 36px; sidebar 232px; right record panel 320px; generous but tight 8/12/16 spacing scale.
- Interactions: every list is keyboard-navigable (↑↓ move, Enter opens, `e` edit cell); **⌘K** global palette (search companies/contacts/deals/notes via the `search_all` RPC + quick actions "Create task", "Log note", "Go to Renewals"); inline cell editing with optimistic updates; saved views per user; empty states that state the next action ("Connect Gmail to see emails here"); skeleton loaders everywhere; toasts for every mutation with undo where cheap.

**Navigation (left sidebar):** Home · Portfolio · Renewals · Tasks · Alerts (with unread count) · Success Plans · Contacts · NPS & CSAT · Reports (manager only) · — · Settings · Admin (admin only).

1. **Home = Morning Review (5.1).** Date header, the AI "Top 3 priorities" narrative, then sections: Today's meetings (time, company, health dot, "Prep" button opening the brief in a slide-over) · Tasks due · New alerts · Health movers · Renewal checkpoints. Monday shows the week-recap block on top. Manager Home adds a link to their latest Weekly Exec Summary.
2. **Portfolio.** KPI cards from the user's segment preset, then the accounts table: Name, Health (dot + score + WoW delta arrow), ARR, Renewal (date + countdown chip, amber ≤90d, red ≤30d), Phase, Last touch, Next touch, Open tasks, NPS, Owner (managers see team's books with CSM + segment filters). Column chooser, sort, filter, saved views. Row click → 360.
3. **Account 360.** Header: name, health chip **with WoW delta**, ARR, renewal countdown, phase, owner, segment; quick actions (Log note · Task · Email · Meeting). Tabs: **Overview · Health · Timeline · Success Plan · Deals & Renewal · Contacts · Emails · Meetings · Tasks · Notes · NPS**.
   - *Overview:* left = recent timeline (filter chips by type) + composer (Note/Email/Task tabs); right panel = attribute sections: About, **Health breakdown mini** (5 dimension bars), Renewal (date, ARR, deal stage, next steps), Success plan progress, Stakeholder map summary (roles covered vs expected), AI summaries (account/risk/renewal — regenerate buttons), Red/Green flags, Next step, **Path to green** (editable).
   - *Health (requirement #7's second half):* score ring + band + **"changed X pts since last week"**; per-dimension bars with computed contributions and the raw inputs on hover; **"Why this score"** AI paragraph; **3 recommendation cards each with "Create task"**; 12-month sparkline (includes migrated Planhat history); the manual inputs editable inline (value 1–10 + comment, sentiment 1–10, exec flag) triggering instant recompute.
   - *Timeline:* infinite scroll of `activities`, grouped by day; email rows expand (lazy body fetch); meeting rows show Fathom summary/action-items/risks/asks chips; call rows show Aircall metadata + transcript link.
   - *Deals & Renewal:* deal cards — stage, amount, close date, confidence, **AI next steps**, ai_summary, the **suggested-stage approve/dismiss chip**, MEDDIC checklist from `qualification`, "Open in HubSpot" link.
   - *Contacts:* stakeholder table (role chips, relationship 1–10, influence/advocate badges, last touch, Outreach sequence state) + a simple **org mini-map** built from `reports_to_contact_id`.
4. **Renewals.** Toggle: **Kanban by stage** (renewal pipeline; cards: company, ARR, close date, health dot, next steps first line) and **Forecast**: by quarter — Commit / Best case / Pipeline sums (from `forecast_category`, fallback stage-probability-weighted) **and a health-adjusted line** (amount × health factor: green 1.0, amber 0.75, red 0.4). Table below: renewal date, ARR, stage, health, WoW health delta, owner, days-to-renewal, flag "at-risk renewal" (≤90d & health <60). Managers: segment/CSM filters + GRR/NRR summary.
5. **Tasks.** My Day / My Week / All; group by company or due date; overdue styling; playbook-run sub-list showing template step progress; complete inline.
6. **Alerts.** Inbox grouped by rule; acknowledge / snooze (1d/1w) / resolve; row links to the 360 section that fired it. Realtime badge updates.
7. **Success Plans.** Per-account plan page (objectives list: status chips, target dates, linked tasks, progress bar auto-computed from objective statuses) + an org/enterprise overview grid (plan progress per account). Objective status changes write `system` timeline activities.
8. **Reports (managers).** Team roll-up: health distribution per segment, at-risk ARR, renewal forecast vs last week, activity leaderboard (meetings/emails/tasks per CSM), NPS trend; archive of Weekly Exec Summaries.
9. **NPS & CSAT.** Score trend, response feed (score, comment, contact, account), promoters/passives/detractors split, per-segment cut. Survey *sending* is v1.1 — V1 displays migrated + manually logged responses (and keeps feeding the sentiment dimension).
10. **Admin.** Users & roles (assign role/segment/manager) · **Health config** (per-segment weight sliders summing to 100, thresholds, usage metric-key mapping; changing anything triggers recompute with a preview diff of the 10 most-affected accounts) · Alert rules (enable/disable, edit thresholds, segment scoping) · Playbook builder (templates + steps + triggers) · Integrations (connection status per provider, last sync, error states, org-level connect buttons for HubSpot/Fathom/Aircall/Outreach, **Unmatched recordings/calls queues**) · Migration console (run reports from `sync_runs` + the reconciliation report).
11. **Settings (every user).** Connect Gmail & Calendar (per-user OAuth), digest hour + timezone, notification prefs.

**Seed data for `alert_rules`** (all segment-aware, editable): health drop ≥10 WoW · crossed into red · no touch > segment `touchSlaDays` · renewal ≤90d & health <60 · NPS detractor received · open deal with no activity 14d · playbook step overdue 3d · new P1 ticket · Gmail/Calendar connection broken.

**Seed `playbook_templates`:** Onboarding (per segment variants) · Renewal 120-day motion (mid/enterprise: T-120 internal review → T-90 exec check-in → T-60 proposal → T-30 close plan) · Scaled renewal automation (T-60 sequence of email tasks) · Risk turnaround (triggered by health_drop) · Enterprise exec-sponsor cadence (quarterly).

---

## 8. Environment variables

```
# frontend (only these two are public)
VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
# edge function secrets
SUPABASE_SERVICE_ROLE_KEY
ANTHROPIC_API_KEY            AI_MODEL_REASONING=claude-sonnet-4-6   AI_MODEL_FAST=claude-haiku-4-5
PLANHAT_API_TOKEN            MIGRATE_DIMENSION_IDS=<comma-separated dimension ids>
HUBSPOT_PRIVATE_APP_TOKEN    HUBSPOT_RENEWAL_PIPELINE_ID / HUBSPOT_EXPANSION_PIPELINE_ID / HUBSPOT_WRITEBACK=true
FATHOM_API_KEY               FATHOM_WEBHOOK_SECRET
AIRCALL_API_ID / AIRCALL_API_TOKEN / AIRCALL_WEBHOOK_TOKEN
OUTREACH_CLIENT_ID / OUTREACH_CLIENT_SECRET / OUTREACH_REDIRECT_URI
ORG_EMAIL_DOMAIN             ORG_TIMEZONE=Europe/Amsterdam
STORE_EMAIL_BODIES=false     APP_URL
```
(Google client id/secret live in Supabase Auth provider config, not env.)

---

## 9. Acceptance criteria (definition of done — verify each)

1. Google sign-in works; admin can assign role/segment/manager; RLS verified: a CSM cannot query another CSM's companies via the API (write a test), a manager sees exactly their team, admin sees all.
2. `npm run migrate:planhat` completes idempotently (second run creates zero duplicates) and prints the reconciliation report; migrated companies show tier→segment, value score + comment, red/green flags, path to green, timeline history, tasks, NPS, objectives-as-success-plans, and a pre-populated health sparkline.
3. Portfolio renders <1s at 150 accounts with the owner's segment KPI cards; saved views and inline edit persist.
4. Account 360: timeline paginates smoothly at 1,000+ activities; composer logs notes/tasks; emails send via Gmail and appear on the timeline instantly.
5. Health tab shows score, WoW delta, dimension bars whose contributions sum to the score, an AI "why" citing real inputs, and exactly 3 recommendations whose "Create task" buttons work. Editing a manual input recomputes live. Changing weights in Admin recomputes and the preview diff renders.
6. Connecting Gmail/Calendar via Settings stores a refresh token; within one poll cycle, matched emails and meetings appear on the right accounts (domain matching verified; own-domain + freemail excluded).
7. Every upcoming matched meeting has a prep brief ≤24h before start; prep goes stale and regenerates when new activity lands.
8. A Fathom webhook for a matched meeting produces, with zero human input: a timeline entry with summary + action items, tasks per action item, extracted risks/asks chips, and — when an open deal exists — updated next steps + ai_summary + (if implied) a stage suggestion chip. `HUBSPOT_WRITEBACK=true` patches the HubSpot deal. Everything appears in `ai_runs`.
9. An Aircall `call.ended` webhook logs the call, matches by phone, and (with transcription available) runs the same pipeline. Unmatched recordings/calls land in the admin queues and can be linked manually.
10. HubSpot renewal deals appear in Renewals within 15 min of change; forecast math (commit/best-case/pipeline + health-adjusted) is correct on seeded fixtures; `companies.renewal_date/arr` track the renewal deal.
11. Daily digest generates at each user's local hour; Monday edition includes the week recap; Friday generates the manager exec summary. Narratives reference only assembled facts.
12. Alert engine fires each seeded rule against fixtures exactly once (dedupe verified); acknowledge/snooze/resolve work; realtime badge updates.
13. Outreach panel shows sequence state on matched contacts; no duplicate activities versus Gmail/Aircall.
14. `npm run seed:demo` populates a convincing demo book (3 CSMs — one per segment — with segment-appropriate account counts scaled down 10×, contacts, activities, deals, health history) so the app is fully explorable with zero credentials.
15. No secrets in the client bundle; all AI calls server-side; every AI write audited in `ai_runs`; loading/empty/error states exist on every screen; the README walks through Google Cloud setup, Supabase config, webhook registration, migration, and Netlify deploy step by step.

---

## 10. Build order

1. Supabase schema + RLS + auth + profiles/admin gating
2. App shell, design tokens, sidebar, ⌘K, table primitives
3. Portfolio + Account 360 (Overview/Timeline/Contacts/Tasks/Notes) on demo seed
4. Planhat migration script + reconciliation report
5. Health engine + configs + Health tab + Admin health config
6. Google OAuth + Gmail sync/send + Calendar sync
7. Fathom + Aircall webhooks + shared recording pipeline + unmatched queues
8. HubSpot sync + Renewals screens + write-back
9. Digests (daily/Monday/exec) + meeting prep + Home
10. Alerts engine + inbox; playbooks + seeds; Success Plans
11. Outreach sync + contact panel
12. Reports, NPS/CSAT, Settings, polish pass against Section 9

Work through all 12 phases without stopping for approval. Where a vendor API detail differs from this spec, adapt, keep the behavior contract, and log the difference in the README's "Deviations" section.
