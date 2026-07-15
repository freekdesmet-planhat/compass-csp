// Sync bookkeeping: cursor read/write on integration_connections.sync_cursor,
// sync_runs lifecycle logging, and repeated-failure → status='error' + admin
// alert escalation.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type Provider = "google" | "outreach" | "hubspot" | "fathom" | "aircall" | "planhat";

export async function getCursor(
  supabase: SupabaseClient,
  connectionId: string,
): Promise<Record<string, unknown>> {
  const { data } = await supabase
    .from("integration_connections")
    .select("sync_cursor")
    .eq("id", connectionId)
    .single();
  return (data?.sync_cursor as Record<string, unknown>) ?? {};
}

export async function setCursor(
  supabase: SupabaseClient,
  connectionId: string,
  cursor: Record<string, unknown>,
): Promise<void> {
  await supabase
    .from("integration_connections")
    .update({ sync_cursor: cursor, last_sync_at: new Date().toISOString() })
    .eq("id", connectionId);
}

export interface SyncRunHandle {
  id: string;
  finish: (ok: boolean, stats: Record<string, unknown>, error?: string) => Promise<void>;
}

// Open a sync_runs row; returns a handle to close it. On failure it also flips
// the connection to status='error' when this is the N-th consecutive failure and
// raises a single deduped admin alert.
export async function startSyncRun(
  supabase: SupabaseClient,
  provider: Provider,
  connectionId: string | null,
): Promise<SyncRunHandle> {
  const { data, error } = await supabase
    .from("sync_runs")
    .insert({ provider, connection_id: connectionId, started_at: new Date().toISOString() })
    .select("id")
    .single();
  if (error) throw error;
  const runId = data!.id as string;

  return {
    id: runId,
    finish: async (ok, stats, errMsg) => {
      await supabase
        .from("sync_runs")
        .update({
          finished_at: new Date().toISOString(),
          ok,
          stats,
          error: errMsg ?? null,
        })
        .eq("id", runId);

      if (!connectionId) return;

      if (ok) {
        await supabase
          .from("integration_connections")
          .update({ status: "active", last_sync_at: new Date().toISOString() })
          .eq("id", connectionId);
        return;
      }

      // Count recent consecutive failures for this connection.
      const { data: recent } = await supabase
        .from("sync_runs")
        .select("ok")
        .eq("connection_id", connectionId)
        .not("finished_at", "is", null)
        .order("finished_at", { ascending: false })
        .limit(3);
      const consecutiveFail = (recent ?? []).length >= 3 && (recent ?? []).every((r) => r.ok === false);

      if (consecutiveFail) {
        await supabase
          .from("integration_connections")
          .update({ status: "error" })
          .eq("id", connectionId);
        await raiseAdminAlert(
          supabase,
          `${provider} sync failing`,
          `Connection ${connectionId} has failed 3+ consecutive syncs. Last error: ${errMsg ?? "unknown"}`,
          `sync-error:${connectionId}`,
        );
      }
    },
  };
}

// Raise a deduped admin alert. alerts has unique(rule_id, company_id, dedupe_key);
// for infra alerts we use a sentinel-free upsert on dedupe_key alone.
export async function raiseAdminAlert(
  supabase: SupabaseClient,
  title: string,
  detail: string,
  dedupeKey: string,
  severity: "info" | "warning" | "critical" = "critical",
): Promise<void> {
  // Avoid duplicating an already-open alert with the same dedupe_key.
  const { data: existing } = await supabase
    .from("alerts")
    .select("id")
    .eq("dedupe_key", dedupeKey)
    .in("status", ["open", "acknowledged", "snoozed"])
    .limit(1);
  if (existing && existing.length) return;

  await supabase.from("alerts").insert({
    company_id: null,
    title,
    detail,
    severity,
    status: "open",
    dedupe_key: dedupeKey,
  });
}

// Run a sync body inside a sync_run, catching + logging errors uniformly.
export async function withSyncRun(
  supabase: SupabaseClient,
  provider: Provider,
  connectionId: string | null,
  body: () => Promise<Record<string, unknown>>,
): Promise<{ ok: boolean; stats: Record<string, unknown>; error?: string }> {
  const run = await startSyncRun(supabase, provider, connectionId);
  try {
    const stats = await body();
    await run.finish(true, stats);
    return { ok: true, stats };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await run.finish(false, {}, msg);
    return { ok: false, stats: {}, error: msg };
  }
}
