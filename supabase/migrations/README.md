# Compass migrations

Apply in filename order (`supabase db push` does this automatically):

| File | Contents |
|---|---|
| `20260714090001_extensions.sql` | pgcrypto, pg_cron, pg_net, pgsodium, supabase_vault |
| `20260714090002_schema.sql` | All Section 3 tables + `updated_at` triggers + `search_vector` GIN indexes + `(source, source_id)` unique indexes + `company_id` indexes. Includes an `unmatched_recordings` admin queue. |
| `20260714090003_rls.sql` | `is_admin()`, `is_manager_of()`, `can_see_company()` + RLS enabled and policies on every table (Section 2). |
| `20260714090004_rpc.sql` | `search_all(q)` — powers ⌘K (security invoker, RLS-respecting). |
| `20260714090005_seed.sql` | `health_configs` (per-segment weights/thresholds/input_config), 9 `alert_rules`, 6 `playbook_templates` + steps. |
| `20260714090006_cron.sql` | `invoke_edge()` helper + the full pg_cron schedule (Section 6). Operator sets two Vault secrets first (see file header). |

Tables created: profiles, companies, contacts, activities, notes, emails,
calendar_events, meeting_preps, tasks, playbook_templates, playbook_template_steps,
playbook_runs, playbook_run_steps, success_plans, success_plan_objectives, deals,
health_configs, health_snapshots, usage_metrics, tickets, nps_responses,
csat_responses, alert_rules, alerts, digests, integration_connections, sync_runs,
ai_runs, unmatched_recordings.
