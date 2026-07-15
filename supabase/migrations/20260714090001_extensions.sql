-- ============================================================================
-- Compass — 01. Extensions
-- ----------------------------------------------------------------------------
-- Required Postgres/Supabase extensions. Idempotent (create if not exists).
-- Supabase installs extensions into the dedicated `extensions` schema.
-- ============================================================================

-- pgcrypto — gen_random_uuid() for all primary keys.
create extension if not exists pgcrypto with schema extensions;

-- pg_cron — scheduled jobs (Section 6 sync schedule). Lives in its own schema.
create extension if not exists pg_cron;

-- pg_net — async HTTP from Postgres; pg_cron jobs call Edge Functions via
-- net.http_post (see 20260714090006_cron.sql).
create extension if not exists pg_net with schema extensions;

-- pgsodium + Supabase Vault — encrypt integration OAuth tokens / API keys at
-- rest. integration_connections.access_token / refresh_token and the cron
-- service-role secret are stored via Vault (vault.create_secret) and never
-- exposed to the client; only Edge Functions (service role) decrypt them.
create extension if not exists pgsodium;
create extension if not exists supabase_vault;
