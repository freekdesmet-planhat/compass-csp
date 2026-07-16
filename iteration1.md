# COMPASS V1.1 — Iteration Prompt (existing codebase)

> **How to use:** Open Claude Code inside the existing Compass repo and paste this entire file. This is an **iteration on a working V1**, not a rebuild.

---

## 0. Iteration ground rules — read before touching anything

1. **Explore first.** Read the repo structure, `supabase/migrations`, `src/lib/segments.ts`, the design tokens, and the V1 spec sections referenced below before writing code. Reuse existing components (tables, chips, slide-overs, composer) everywhere — V1.1 must be visually indistinguishable from V1's Attio language.
2. **Never edit shipped migrations.** All schema changes go in new files under `supabase/migrations/` (prefix `v1_1_`). Every new table gets RLS consistent with `can_see_company()` / role helpers from V1.
3. **Bugs get root-cause fixes**, not band-aids: reproduce, fix, and where practical add a small test or a note in the PR description explaining the cause.
4. Update `scripts/seed-demo.ts` so every new feature is populated with demo data, bump `package.json` to `1.1.0`, and maintain `CHANGELOG.md` (this becomes a feature — see D7).
5. Work through Part A → B → C → D in order. Do not stop for approval; log any deviation in README "Deviations".

---

## Part A — Bug fixes (P0, do these first)

**A1. Customer 360 quick actions are dead** *(items 11/21/29)*. The header buttons **Log note · Task · Email · Meeting** do nothing. Wire all four: Note → opens the composer's Note tab focused; Task → opens the new task modal (B5); Email → opens the email composer (to: defaults to the account's primary contact; send via the existing `send-gmail` function; if the user hasn't connected Gmail, show an inline "Connect Gmail in Settings" state instead of failing silently — likely the original bug); Meeting → opens the Log-interaction composer (D5) on its "meeting" type. Same fix applies to the composer tabs on the Overview tab if they share the broken handler.

**A2. NPS page shows nothing** *(item 3)*. Diagnose the empty state: check (a) the page query joins/RLS against `nps_responses`, (b) whether the Planhat migration actually inserted rows (re-check step 8 of `migrate-planhat.ts` — `GET /nps` mapping), (c) demo seed coverage. Fix the real cause, backfill if the migration step was faulty (idempotent re-run of just that step: add `--only=nps` flag support to the script), and give the page a proper empty state with a "Log NPS response" manual-entry action.

**A3. Left sidebar: label cut off + collapse** *(items 5, 15)*. "NPS & CSAT" truncates — fix the flex overflow (`min-w-0` + `truncate` on labels, verify all items at 232px). Add a **collapse toggle** (bottom of sidebar + `[` keyboard shortcut): collapsed state is a 64px icon rail with tooltips; persist the preference in `localStorage` and mirror to `profiles.sidebar_collapsed`.

**A4. Tasks can't be completed on the 360 Tasks tab** *(item 30)*. Add the checkbox/complete affordance (it exists on the global Tasks page — reuse that row component), optimistic update, strikethrough + move to a collapsed "Completed" group.

**A5. Success plans: no create, no status editing** *(items 8, 14)*. Add **"New success plan"** buttons on both the org-level Success Plans page and the 360 Success Plan tab (modal: name, owner, target date, optional first objectives). Make **plan status** (`active/paused/completed`) and every **objective status** editable dropdowns (they render read-only today); status changes write the `system` timeline activity per V1 spec and recompute `progress_pct`.

**A6. Email logs hide the participants** *(items 13/23)*. Email rows currently show subject + content only. Render **From / To / Cc as chips**: matched contacts appear as person chips linking to their Contact 360 (C4), your own team's addresses as internal chips, unmatched addresses as plain text with a "+ add as contact" hover action. Data: `emails.from_email/to_emails/cc_emails` + `contact_ids` exist — if `contact_ids` is unpopulated on historical rows, ship `scripts/backfill-email-contacts.ts` (match against `contacts.email/other_emails`, re-runnable) and run it in the migration console.

---

## Part B — One interaction layer: everything is clickable *(items 24, 31, 6, 25, 27, 28)*

**B1. Shared drill-down system** — build once, reuse three times. Create `src/lib/portfolioFilters.ts`: a typed `FilterSpec` (`segment?, healthBand?, owner?, renewalWindowDays?, atRiskRenewal?, phase?, noTouchDays?, npsBucket?`) that serialises to/from Portfolio URL params (`/portfolio?band=amber&segment=scaled`). The Portfolio page reads the URL, applies filters, and shows a dismissible filter-chip bar.
- **Portfolio KPI cards** *(24)*: every card click navigates to its own FilterSpec (e.g. "At-risk renewals" → `?atRiskRenewal=true`).
- **Reports** *(31)*: every chart element is clickable — clicking the amber bar of the Scaled health-distribution chart opens `/portfolio?band=amber&segment=scaled`. Apply to all existing report charts (health distribution, at-risk ARR, renewal forecast bars → Renewals view filtered by quarter/category, activity leaderboard → that CSM's book, NPS trend point → NPS page filtered to that period). Cursor-pointer + hover states so clickability is discoverable.
- The new **Dashboards** (D2) use the same mechanism for widget click-through.

**B2. ⌘K search backdrop blur** *(item 6)*: overlay gets `bg-black/20 backdrop-blur-sm` (respect `prefers-reduced-motion` for the transition), applied to the shared modal overlay so all slide-overs benefit consistently.

**B3. Deal qualification is hand-editable** *(item 25)*: the MEDDIC checklist on the 360 Deals tab becomes interactive — each criterion a Yes/No/Unset segmented toggle writing to `deals.qualification` jsonb, with a timeline `system` activity on change ("Budget confirmed by {user}"). AI never overwrites a manually set flag (merge rule in `process-recording`: manual keys win).

**B4. Contacts fields inline-editable** *(item 28)*: on the 360 Contacts tab (and Contact 360), `contact_role`, `relationship_strength` (1–10 stepper), `department`, `seniority`, `title`, `is_champion`, `has_influence` become inline-editable cells using the existing optimistic-edit pattern. Relationship/role edits trigger a health recompute (sentiment + engagement inputs depend on them).

**B5. Real task creation modal** *(item 27)*: replace the bare quick-create with a modal used everywhere tasks are born (360 header, Health-tab recommendation "Create task", Tasks pages): **title, description, task type** (`todo | email | call | check_in | meeting` — new `tasks.task_type` column, icon per type, filterable on Task views), **due date, priority, assignee** (any active teammate — picker from `profiles`), linked company (prefilled), optional linked objective. Assigning to someone else creates a notification (D6). Health-tab recommendations pre-fill title/description/due from the AI suggestion.

---

## Part C — Customer 360 & contact upgrades

**C1. Website + domains hyperlinked** *(item 2.1)*: `companies.website` renders as an external link (favicon + hostname, `target=_blank rel=noopener`) in the 360 header and right panel; domain chips likewise.

**C2. Latest company news** *(item 2.2)*. New columns: `companies.latest_news text, latest_news_at timestamptz, latest_news_sources jsonb`. Backfill from our Planhat tenant's `custom.(AI) Latest News` field (extend the migration script with a re-runnable `--only=news-backfill` step). New "Latest news" card on the 360 Overview right panel: rendered bullets, "as of {date}", source links, and a **Refresh** button → new Edge Function `news-refresh` that calls the Anthropic API **with the `web_search` tool** ("3 recent, business-relevant developments about {company} ({website}), ≤120 words total, each bullet with its source URL; return strict JSON"). Auto-refresh weekly for `enterprise`-segment accounts only (pg_cron; cost control — make the segment list configurable in Admin → Health/AI settings).

**C3. Usage tab on the 360** *(item 2.3)*. New tab between Health and Timeline, driven entirely by `usage_metrics`: (a) headline row — utilisation % (WAU/seats per the segment's `input_config`), 4-week trend arrow, last-active date; (b) one line chart per configured metric key (90d default, 30/90/365 toggle, weekly aggregation); (c) adoption grid — each `adoption_metrics` key with current value + sparkline; (d) "Manage metrics" link (admins) to the existing health `input_config`. Honest empty state when a key has no data ("No data for `weekly_active_users` — check the metric key in Admin → Health config"). Build it config-driven so layout needs no code change when metric keys change.

**C4. Contact 360 page** *(items 12/22)*. Route `/contacts/:id`; every contact name anywhere in the app becomes a link to it. Layout mirrors the account 360: header (name, title, company link, role chip, relationship 1–10, champion/influence/advocate badges, email/phone/LinkedIn actions — email opens the composer pre-addressed); right attribute panel fully inline-editable (B4 fields + reports-to picker + personal notes); tabs: **Activity** (timeline filtered to this contact), **Emails**, **Meetings**, **Outreach** (the existing panel, promoted to a tab), **NPS** (their response history), **Tasks** (tasks mentioning them via contact link — add optional `tasks.contact_id`), **Notes**. Also show where they sit in the mini org-map.

**C5. Whitespace / expansion map** *(item 18)*. New tables:
```sql
products ( id, name text unique, category text, position int )
company_products ( company_id, product_id,
  status text check (status in ('current','active_opp','need_to_discuss','rejected','none')) default 'none',
  arr numeric, note text, updated_by uuid, unique(company_id, product_id) )
```
Seed `products` from our catalogue: **Core Licence, SEO Intelligence, Traffic Monitor, Conversion Optimiser, Consulting Services, SEO Consulting**. Backfill `company_products` from the Planhat tenant fields of the same names (values map: `Current Product→current`, `Active Opp→active_opp`, `Need To Discuss→need_to_discuss`, `Rejected→rejected`) via a `--only=whitespace` migration step — these fields exist in Planhat but were not migrated in V1.
UI: (a) **360 → Deals & Renewal** gains a "Products & whitespace" strip — one cell per product, status-coloured (current = solid green, active_opp = blue, need_to_discuss = amber outline, rejected = grey strike, none = empty dashed = *whitespace*), click to set status or "Create expansion deal" (prefills a `pipeline='expansion'` deal). (b) **Renewals page** gains an **Expansion** tab: accounts × products heatmap (rows = accounts in scope, columns = products), sortable by whitespace count, segment/owner filters, cells clickable with the same popover, summary header ("€X ARR whitespace across N accounts" = accounts' ARR-weighted empty cells). This is the go-to view for spotting cross-sell plays.

**C6. Contacts directory: slice & dice like Planhat** *(item 7)*. Upgrade the Contacts page from a simple list to a full Attio-grade data table over every visible contact: columns for name, company (link), role, relationship, department, seniority, title, latest NPS, last touch, engagement score, champion/influence/advocate badges, and account segment; a **filter builder** (add condition → field → operator → value, AND-combined, covering all those fields); **group-by** (company, role, department, segment) with collapsible groups and per-group counts; sort on any column; **saved views** (reuse the Portfolio saved-view infrastructure); bulk select → export CSV or bulk-edit role/tags. This becomes the stakeholder-mining workbench ("all exec sponsors with relationship ≤4 across my book").

---

## Part D — New modules

**D1. Ask Compass — the agent chat** *(item 4)*. Sidebar entry directly **under Home**. A Claude-style chat where a CSM asks anything about their book ("Which of my accounts renew in Q4 with declining usage?", "Summarise everything that happened with Acme last month", "Who haven't I touched in 60 days?") and the agent queries Compass data and answers — no tab-hopping.
- **UI:** thread list + chat pane (existing design tokens; user/assistant bubbles, streaming text, tool-activity shimmer "Checking renewals…"), suggested starter prompts per segment, every entity in answers rendered as a chip linking to its record.
- **Backend:** Edge Function `ask-compass` running an Anthropic **tool-use loop** (max 8 tool calls/turn, `AI_MODEL_REASONING`) with read-only tools: `search_companies(query|FilterSpec)`, `get_company_360(id)` (attributes + latest health snapshot + last 20 activities + open tasks/deals + success plan), `get_contact(id)`, `list_renewals(filter)`, `list_tasks(filter)`, `get_health_breakdown(company_id)`, `aggregate_portfolio(group_by, measure, filter)`, `get_usage(company_id)`, `search_activities(company_id, query, date_range)`.
- **Security is non-negotiable:** the function verifies the caller's JWT, resolves their visible company ids via a `visible_company_ids()` security-definer RPC (same logic as `can_see_company`), and **hard-filters every tool by that set** — the service-role key must never let a CSM read outside their book. Managers/admins inherit their normal scope. System prompt: answer only from tool results, cite records, say "I couldn't find that" rather than guess, keep answers tight.
- **Storage:** `ask_compass_threads (user_id, title)` + `ask_compass_messages (thread_id, role, content, tool_calls jsonb)`; RLS owner-only. Log runs to `ai_runs (kind='ask_compass')`.

**D2. Dashboards in Reports** *(items 10/20)*. Reports becomes two sub-tabs: **Overview** (existing, now fully drillable via B1) and **Dashboards**. A dashboard = grid of widgets (drag-to-arrange, resizable; persist layout).
```sql
dashboards ( id, name, owner_id, shared bool default false, layout jsonb )
dashboard_widgets ( dashboard_id, position jsonb, kind text check (kind in ('metric','bar','line','donut','table')),
                    dataset text, group_by text, measure text, filter jsonb, title text )
```
- **Dataset layer** (keeps it safe + simple — no free-form SQL): RLS-respecting RPCs `ds_companies`, `ds_renewals`, `ds_activities`, `ds_health_trend`, `ds_nps`, `ds_tasks`, each accepting `FilterSpec` + `group_by` + `measure` (count / sum arr / avg health / …). Widget editor = dataset → measure → group-by → filters → chart kind, live preview.
- Every widget/segment click drills through B1. Sharing: `shared=true` makes it visible to the owner's team (manager sees team dashboards). Seed two defaults: **"My book at a glance"** (CSM) and **"Renewal command centre"** (manager).

**D3. CSV import** *(item 9)*. Admin → **Import** (admins + managers). Wizard: upload CSV (Papaparse, client-side parse) → choose entity (**Companies / Contacts / Usage metrics**) → column-mapping UI with auto-suggestions from headers → validation preview (row-level errors: bad email, unknown owner, missing name, duplicate) → choose mode (`create only | update matches | upsert`; match keys: companies by domain or external_id, contacts by email, usage by company external_id + metric_key + date) → run → downloadable result report. Store `import_runs (entity, mode, stats jsonb, report_path, run_by)`. Imports write `source='csv_import'` and are idempotent per mode.

**D4. Library — content explorer** *(item 19)*. Sidebar entry **Library**: the internal best-practice shelf (QBR decks, one-pagers, templates, links). `library_items ( title, description, item_type check in ('deck','doc','template','link'), url text, storage_path text, tags text[], segments text[], uploaded_by, download_count )`; files to a Supabase Storage bucket `library` (50MB cap), links stored as-is. Card grid + search + tag/segment/type filters, preview or download, usage counter. Stretch (only if time allows): meeting prep (5.3) appends a "Suggested content" line when an item's tags match the account's phase/segment.

**D5. Log-interaction composer** *(item 16)*. The easy way to capture what happened offline: in-person meeting, an unrecorded call, hallway sentiment. Entry points: 360 "Meeting" quick action (A1), a "+ Log interaction" in the composer, and a ⌘K action. Fields: type (`in_person | call_unrecorded | other`), date/time (defaults now), contacts involved (multi-select), summary (textarea), **sentiment slider 1–10**, optional next step (creates a task via B5). Writes an `activities` row (`type='meeting'|'call'`, `source='app'`, `meta.sentiment`, `meta.logged_manually=true`) and feeds the rolling call-sentiment health input exactly like a Fathom sentiment — then triggers a recompute. Timeline renders these with a small "logged manually" marker.

**D6. @mentions, notifications, Slack** *(item 26)*. Tiptap Mention extension in notes (`@` → teammate picker). New `notifications ( user_id, kind check in ('mention','task_assigned','system'), title, body, link, read_at )` + bell icon in the top bar (unread count, dropdown, mark-all-read; Supabase Realtime). Producers: note mentions, task assignment (B5). **Slack mirror (optional):** if `SLACK_BOT_TOKEN` is set, Edge Function `notify` resolves the Slack user via `POST https://slack.com/api/users.lookupByEmail` and DMs via `POST https://slack.com/api/chat.postMessage` (message: who mentioned you, note snippet, deep link). Graceful no-op without the token. README gains a 5-step Slack app setup (create app → add `chat:write` + `users:read.email` bot scopes → install to workspace → copy bot token → set secret).

**D7. Changelog / "What's new"** *(item 1 — ASSUMPTION: product changelog, not per-record audit; `ai_runs` already covers AI audit)*. `changelog_entries ( version, released_on date, category check in ('new','improved','fixed'), title, body )`, seeded with the V1.0 summary and every V1.1 item from this prompt. "What's new" entry at the sidebar bottom (sparkle icon) opening a slide-over grouped by version; unread dot when `profiles.last_seen_version <` latest. Keep `CHANGELOG.md` in the repo as the source and a tiny script `npm run changelog:sync` that upserts it into the table on deploy.

**D8. Deeper mid-touch & scaled coverage** *(item 17 — ASSUMPTION: this means richer data + fully-wired segment views, not new modules)*. (a) `seed-demo.ts` generates **realistic full-size books**: the scaled CSM gets 150 accounts (usage-heavy signals, 1–2 contacts, sparse meetings), mid-touch 70 (renewal dates spread across 4 quarters, 4–6 contacts, playbook runs in flight) — no more 10× scale-down, so performance and pagination are honestly exercised. (b) Audit the mid/scaled KPI cards from `SEGMENT_PRESETS` and implement any that were stubbed (`usage_adoption_pct`, `playbook_completion`, `renewal_rate_count`, `expansion_pipeline`, `nps_trend`) with real queries + B1 drill-downs. (c) Scaled portfolio gains a **bulk-action bar** (select rows → create task for N accounts / start playbook for N accounts) — the one-to-many motion needs batch tools.

---

## Part E — Deploy pipeline: GitHub → Netlify (frontend) + Supabase (backend)

The stack is **GitHub (repo) + Netlify (SPA hosting) + Supabase (everything backend)**. Netlify builds only the frontend — migrations, Edge Functions and cron changes do NOT ship with a Netlify deploy. Close that gap and formalise the workflow:

1. **Repo hygiene:** `.env*` gitignored; keep `.env.example` current. The only env vars in Netlify's UI are `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; every secret ships via `supabase secrets set` (add a copy-paste block of all `secrets set` commands to the README).
2. **`netlify.toml`:** verify V1's config — build `npm run build`, publish `dist`, SPA redirect `/* → /index.html 200` — and pin `NODE_VERSION`.
3. **GitHub Action `.github/workflows/deploy-supabase.yml`:** on push to `main` with changes under `supabase/**`: checkout → `supabase/setup-cli` → `supabase link --project-ref ${{ secrets.SUPABASE_PROJECT_REF }}` → `supabase db push` → `supabase functions deploy`. Repo secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`. Add a PR-triggered job that runs a dry-run migration diff so schema changes are visible in review.
4. **Webhook functions must skip JWT verification:** in `supabase/config.toml`, set `verify_jwt = false` for `webhook-fathom` and `webhook-aircall` (external services can't send Supabase JWTs; our own secret-header validation remains the gate). Confirm the functions actually enforce those secret checks.
5. **Deploy previews:** in Supabase Auth → URL Configuration, set the production Netlify domain as Site URL and add `https://*--<netlify-site-name>.netlify.app/**` to Additional Redirect URLs so Google sign-in works on every PR preview.
6. **Document the branch workflow in the README:** `git checkout -b v1.x` → run the iteration prompt in Claude Code → push → test the Netlify deploy preview against the acceptance table → merge to main (Netlify ships the SPA, the Action ships Supabase) → tag the release and let `npm run changelog:sync` update "What's new".

---

## Schema additions (one `v1_1_` migration set; RLS on all)

New tables: `products`, `company_products`, `notifications`, `library_items`, `dashboards`, `dashboard_widgets`, `import_runs`, `ask_compass_threads`, `ask_compass_messages`, `changelog_entries`.
Altered: `tasks` +`task_type text default 'todo'`, +`contact_id uuid null`; `companies` +`latest_news`, +`latest_news_at`, +`latest_news_sources jsonb`; `profiles` +`sidebar_collapsed bool default false`, +`last_seen_version text`.
New RPCs: `visible_company_ids()` (security definer), the six `ds_*` dataset functions, and any FilterSpec helper needed server-side.
New Edge Functions: `ask-compass`, `news-refresh`, `notify`. New env (all optional except none): `SLACK_BOT_TOKEN`.
Migration script gains `--only=` step targeting (`nps | news-backfill | whitespace`) so backfills run without a full re-migration.

---

## V1.1 acceptance criteria — mapped to the original request list

| # (original) | Verify |
|---|---|
| 1 | "What's new" opens from the sidebar, shows v1.0 + v1.1 grouped entries, unread dot clears after viewing |
| 2.1 | Website + domain chips on the 360 open in a new tab |
| 2.2 | Latest-news card shows backfilled Planhat content with date; Refresh produces 3 sourced bullets via web search; weekly auto-refresh scheduled for enterprise accounts |
| 2.3 | Usage tab renders utilisation, per-metric charts and adoption grid from `usage_metrics`; honest empty states; config-driven |
| 3 | NPS page shows migrated + demo responses; root cause documented; manual "Log NPS response" works |
| 4 | Ask Compass answers "Which of my accounts renew in Q4 with declining usage?" correctly with linked account chips, streams, and **cannot** return another CSM's account (write this security test) |
| 5, 15 | No sidebar truncation; collapse toggle + `[` shortcut work and persist |
| 6 | ⌘K (and slide-overs) blur the background |
| 7 | Contacts directory filters on role/relationship/department/seniority/NPS/last-touch/segment/company, group-by works, saved views persist, bulk select works |
| 8, 14 | Success plans can be created from both entry points; plan + objective statuses editable; progress recomputes; timeline events written |
| 9 | CSV wizard imports companies, contacts and usage metrics with mapping, validation preview, dedupe modes, and a downloadable report; re-running in upsert mode creates no duplicates |
| 10/20 | A user can build, arrange, save and share a dashboard from the dataset layer; widget clicks drill to filtered records; both seeded dashboards render |
| 11/21/29 | All four 360 quick actions work; email sends via Gmail and appears on the timeline; disconnected-Gmail state is handled gracefully |
| 12/22 | Contact 360 exists at `/contacts/:id`, is linked from every contact name, and all tabs populate |
| 13/23 | Email rows show From/To/Cc chips; matched contacts link to their Contact 360; backfill script populates historical rows |
| 16 | Log-interaction captures an in-person conversation with sentiment; it appears on the timeline and moves the sentiment input on the next recompute |
| 17 | Demo seed produces full-size scaled (150) and mid-touch (70) books; all mid/scaled KPI cards compute real numbers and drill down; bulk-action bar works on scaled portfolio |
| 18 | Whitespace strip on the 360 and the Expansion heatmap render the backfilled Planhat product statuses; empty cells read as whitespace; a cell click can set status or create an expansion deal; ARR-weighted whitespace summary is correct on fixtures |
| 19 | Library uploads a deck to storage, stores links, filters by tag/segment/type, and tracks downloads |
| 24 | Every Portfolio KPI card opens the correctly filtered table with visible filter chips |
| 25 | MEDDIC toggles persist, write timeline events, and are never overwritten by the AI pipeline |
| 26 | An @mention notifies in-app in realtime and (with token set) via Slack DM with a working deep link |
| 27 | Task modal supports description, type, priority, assignee; assignment notifies the assignee; type icons + filters appear on task views |
| 28 | Contact role/relationship/etc. inline-edit and trigger a health recompute |
| 30 | Tasks complete from the 360 Tasks tab with optimistic UI |
| 31 | Every Reports chart element (including new dashboards) is clickable and lands on the matching drilled view — test the exact case: amber bar of Scaled health distribution → portfolio filtered to amber + scaled |

Also re-verify the V1 regression basics after all changes: portfolio <1s at 150 accounts, RLS isolation test still passes, no secrets client-side, `CHANGELOG.md` and README updated, version bumped to 1.1.0.

---

## Order of work

0. **Part E** — deploy pipeline first: every subsequent part then ships and gets tested on a real preview URL
1. **Part A** (A1–A6) — ship the bug fixes first so testing the rest isn't blocked
2. **B1 + B2** (drill-down system + blur) — B1 is a dependency of 24/31/D2/D8
3. **B3–B5** (editability + task modal) → **D6** (notifications, needed by B5)
4. **Part C** (C1–C5)
5. **D1** Ask Compass · **D2** Dashboards · **D3** Import · **D4** Library · **D5** Log interaction · **D7** Changelog · **D8** Segment depth
6. Full pass over the acceptance table, update seed + docs, commit with a clean summary

Do not pause for approval between parts. Anything ambiguous: pick the option most consistent with V1's patterns and record it in README "Deviations".
