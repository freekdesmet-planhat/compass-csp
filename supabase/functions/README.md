# Compass Edge Functions (Deno)

All AI runs are logged to `ai_runs`. All syncs are idempotent (upsert on
`(source, source_id)`), cursor-based (`integration_connections.sync_cursor`),
logged to `sync_runs`, and retry 429/5xx with backoff. Functions use the
service-role key and bypass RLS, scoping every query by ids they resolve.

`_shared/` — `supabase.ts` (service/user clients + `json`), `anthropic.ts`
(`callAI`/`callAIJson`/`logAiRun`, models from env), `http.ts` (retry/backoff),
`matching.ts` (email→company/contact w/ domain + freemail exclusion, phone→contact),
`google.ts` (token refresh), `sync.ts` (cursor + `sync_runs` + failure escalation),
`health.ts` (exact mirror of `src/lib/health.ts`).

| Function | Trigger | Secrets |
|---|---|---|
| `sync-gmail` | cron */10 (per connected user) | Google (Supabase Auth provider) |
| `sync-calendar` | cron */15 (per user) | Google |
| `sync-hubspot` | cron */15 (org) | `HUBSPOT_PRIVATE_APP_TOKEN`, pipeline ids, `HUBSPOT_WRITEBACK` |
| `sync-outreach` | cron */30 (org) | `OUTREACH_CLIENT_ID/SECRET/REDIRECT_URI` |
| `webhook-fathom` | webhook + hourly backfill | `FATHOM_API_KEY`, `FATHOM_WEBHOOK_SECRET` |
| `webhook-aircall` | webhook (`call.ended` …) | `AIRCALL_API_ID/TOKEN`, `AIRCALL_WEBHOOK_TOKEN` |
| `process-recording` | invoked by the two webhooks | `ANTHROPIC_API_KEY`, `HUBSPOT_*` (write-back) |
| `compute-health` | cron nightly 02:00 + weekly Sun 23:00 + on-demand `{companyId}` | `ANTHROPIC_API_KEY` |
| `generate-meeting-prep` | cron hourly | `ANTHROPIC_API_KEY` |
| `generate-digests` | cron hourly (per-user local digest hour; Fri exec) | `ANTHROPIC_API_KEY` |
| `ai-generate` | authenticated (regenerate buttons) | `ANTHROPIC_API_KEY` |
| `send-gmail` | authenticated (composer) | Google |
| `alert-evaluator` | cron */30 | — |

**Deviations:** vendor payload field names are implemented to the spec; where a
detail was uncertain it is handled defensively (multiple candidate keys) — verify
against current vendor docs during rollout. `compute-health` duplicates the health
math from `src/lib/health.ts` verbatim (Deno can't import from `/src`); keep the
two in sync if the algorithm changes.
