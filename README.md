# Compass — internal Customer Success platform

Compass replaces Planhat + ChurnZero + Gainsight for a 30–50 person CS org. It is
fast, dense and keyboard-driven (Attio design language), built around one
flagship workflow: **the morning portfolio review**. Every CSM opens Compass and
sees what to do today, what changed in their book this week, and — on every
account — not just a health score but *why* it's that score, how it moved since
last week, and 3 concrete recommendations to improve it.

**Stack:** Vite + React 18 + TypeScript (strict) + Tailwind + shadcn-style UI +
React Router v6 + TanStack Query + Tiptap + Recharts + lucide-react + cmdk.
Backend: Supabase (Postgres + RLS, Auth, Edge Functions, `pg_cron`/`pg_net`,
Realtime). AI: Anthropic, called **only from Edge Functions**.

---

## Quick start — DEMO MODE (zero credentials)

The app runs fully **without any backend**. When `VITE_SUPABASE_URL` /
`VITE_SUPABASE_ANON_KEY` are absent, Compass serves a deterministic in-browser
dataset (3 CSMs one-per-segment, a manager, an admin, ~25 accounts scaled 10×
down, with contacts, activities, deals, 12-month health history, tasks, alerts,
success plans, NPS/CSAT, calendar + meeting preps, digests).

```bash
npm install            # if this fails with EACCES on ~/.npm, see "npm cache" below
npm run dev            # http://localhost:5173 — no sign-in, fully explorable
```

Use the **user switcher** (bottom-left of the sidebar) to view the app as the
admin, the manager, or any of the three CSMs — this demonstrates the RLS-mirrored
visibility model (a CSM sees only their book; a manager sees their team; admin
sees everything).

> **npm cache:** if `npm install` fails with `EACCES … /Users/you/.npm`, your npm
> cache has root-owned files from an old npm bug. Either run
> `sudo chown -R $(id -u):$(id -g) ~/.npm` once, or install with a local cache:
> `npm install --cache ./.npmcache`.

```bash
npm run build          # tsc -b && vite build → dist/
npm run typecheck      # strict type check
```

---

## Full setup — LIVE MODE

### 1. Supabase project

1. Create a Supabase project. Note the **Project URL**, **anon key**, and
   **service-role key** (Settings → API).
2. Link the CLI and apply migrations:
   ```bash
   supabase link --project-ref <PROJECT_REF>
   supabase db push          # applies supabase/migrations/* in order
   ```
   Migrations create every table (Section 3), the RLS helpers + policies
   (`is_admin`, `is_manager_of`, `can_see_company`), the `search_all` RPC for ⌘K,
   seed data (`health_configs`, `alert_rules`, `playbook_templates`), and the
   `pg_cron` schedule. See `supabase/migrations/README.md` for the file order.
3. In `20260714090006_cron.sql`, set the functions base URL (`<PROJECT_REF>`) and
   store the service-role key in Vault as documented in that file's comments, so
   `pg_cron` → `pg_net` can invoke Edge Functions.

### 2. Google Cloud (Gmail + Calendar + Sign-in)

1. Create a Google Cloud project → **APIs & Services**.
2. **OAuth consent screen** → User type **Internal** (org-only).
3. Enable the **Gmail API** and **Google Calendar API**.
4. **Credentials → OAuth client ID → Web application**. Authorized redirect URI:
   `https://<PROJECT_REF>.supabase.co/auth/v1/callback`.
5. In Supabase → **Authentication → Providers → Google**, paste the client ID and
   secret. Base sign-in requests only `openid email profile`.
6. In-app, **Settings → "Connect Gmail & Calendar"** re-runs `signInWithOAuth`
   with the extended scopes (`gmail.readonly`, `gmail.send`, `calendar.readonly`)
   and `access_type=offline`, `prompt=consent`. The callback stores the
   `provider_refresh_token` in `integration_connections` (server-side only).

### 3. Edge Function secrets

All secrets live in Supabase Edge Function secrets (never in the client bundle).

```bash
supabase secrets set \
  ANTHROPIC_API_KEY=... \
  AI_MODEL_REASONING=claude-sonnet-4-6 \
  AI_MODEL_FAST=claude-haiku-4-5 \
  HUBSPOT_PRIVATE_APP_TOKEN=... \
  HUBSPOT_RENEWAL_PIPELINE_ID=... HUBSPOT_EXPANSION_PIPELINE_ID=... HUBSPOT_WRITEBACK=true \
  FATHOM_API_KEY=... FATHOM_WEBHOOK_SECRET=... \
  AIRCALL_API_ID=... AIRCALL_API_TOKEN=... AIRCALL_WEBHOOK_TOKEN=... \
  OUTREACH_CLIENT_ID=... OUTREACH_CLIENT_SECRET=... OUTREACH_REDIRECT_URI=... \
  ORG_EMAIL_DOMAIN=yourco.com ORG_TIMEZONE=Europe/Amsterdam \
  STORE_EMAIL_BODIES=false APP_URL=https://compass.yourco.com

supabase functions deploy   # deploys everything under supabase/functions/*
```

`.env.example` documents every variable. Only `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` are ever exposed to the client.

### 4. Webhook registration

- **Fathom** — the `webhook-fathom` function self-registers on boot
  (`POST /webhooks` with `include_transcript/summary/action_items`). Set
  `FATHOM_WEBHOOK_SECRET` and confirm the destination URL is
  `https://<PROJECT_REF>.supabase.co/functions/v1/webhook-fathom`.
- **Aircall** — in the Aircall dashboard create a webhook pointing at
  `.../functions/v1/webhook-aircall` for events `call.ended`, `call.commented`,
  `call.tagged`; set `AIRCALL_WEBHOOK_TOKEN`.
- **HubSpot** — create a private app with CRM read (+ write for write-back) scopes
  and set `HUBSPOT_PRIVATE_APP_TOKEN`; the renewal/expansion pipeline ids select
  which pipelines sync.
- **Outreach** — an admin connects once via Admin → Integrations (OAuth).

### 5. Planhat migration (one-time)

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... PLANHAT_API_TOKEN=... \
  MIGRATE_DIMENSION_IDS=<comma-separated dimension ids> \
  npm run migrate:planhat
```

Runs locally (it takes a while), paginates all Planhat endpoints, is **idempotent**
(upsert on `source='planhat', source_id=<_id>` — a second run creates zero
duplicates), and prints a **reconciliation report** (counts per model, unmatched
owners, companies without domains, custom-field drift). Company tier → segment,
manual value/sentiment scores, red/green flags, path-to-green, timeline history,
tasks, NPS, objectives-as-success-plans, and a 12-month health sparkline all come
across on day one.

### 6. Demo seed (optional, for a populated live environment)

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed:demo
```

Writes the same demo book to Postgres so a fresh live environment is explorable
before real data lands.

### 7. Netlify deploy

`netlify.toml` is configured: build `npm run build`, publish `dist`, SPA redirect
`/* → /index.html 200`. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in
Netlify environment variables. Everything else lives in Supabase secrets.

---

## Architecture notes

- **Data layer.** The app talks to data through TanStack Query hooks in
  `src/lib/hooks.ts`. In demo mode these read/write the in-browser store
  (`src/lib/store.ts`, seeded by `src/lib/demo/generate.ts`, persisted to
  `localStorage`). In live mode the same hook surface targets Supabase.
- **Health engine.** `src/lib/health.ts` is the single source of the deterministic
  5-dimension scoring math (value / engagement / support / sentiment / usage),
  per-segment weights, pro-rata redistribution of excluded dimensions, and
  contribution math. The `compute-health` Edge Function mirrors it exactly; the AI
  only writes the "why" narrative and the 3 recommendations — it never invents
  numbers.
- **RLS.** Every table is gated by `can_see_company()` (owner / collaborator /
  manager-of-owner / admin). Edge Functions use the service role and scope every
  query by ids they resolve themselves.
- **AI audit.** Every AI run and every applied change is logged to `ai_runs`.

---

## Deviations from the spec

- **Demo mode** is the zero-credential path (acceptance #14). It is an in-browser
  dataset + store, not a Supabase instance; the same hook surface targets Supabase
  when `VITE_SUPABASE_*` are set. This keeps the app fully explorable with no
  backend while preserving the production data path.
- **Auth in demo** is simulated via a user switcher (to demonstrate RLS
  perspectives). Live mode uses Google via Supabase Auth exactly as specified;
  `profiles` rows are created on first sign-in.
- **Edge Functions, the Planhat migration, and the demo seed script** are written
  to the spec's real endpoints and behavior contract but are exercised against
  live credentials by the operator — they cannot run in this build sandbox. Where
  a vendor field detail was uncertain it is implemented to the spec with a
  `// DEVIATION:` comment; verify field-level details against each vendor's
  current docs during rollout.
- **NPS scale.** The migrated/demo NPS `score` is stored on a −100..100 point
  scale (Planhat-style), so the NPS screen buckets promoter ≥ 50 / detractor < 0 /
  passive between, and headline NPS = mean of scores.
- **npm cache.** Local installs may need `--cache ./.npmcache` due to a root-owned
  `~/.npm` from a historical npm bug (see Quick start).
- **Bundle size.** The SPA ships as a single chunk (~250 kB gzip). Route-level
  code-splitting is a straightforward follow-up if needed.
