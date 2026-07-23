// playbook-autoapply — makes Playbooks autonomous (iteration2.md §5, §7). On a
// cron cadence it:
//   1. ENTRY  — applies each live template whose entry_criteria match a company
//               (deduped: one non-archived run per template×company).
//   2. EXIT   — archives active runs whose exit_criteria now match, honouring
//               keep_remaining / cancel_remaining.
//   3. REEVAL — advances active runs: step conditions latch on, group conditions
//               gate on/off, dependents activate — creating tasks as steps go live.
// Runs with the service-role key (bypasses RLS). Seeded templates have empty
// entry_criteria, so nothing auto-applies until a manager authors criteria.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { serviceClient, json } from "../_shared/supabase.ts";
import { evaluateRules, isEmptyRuleGroup, companyContext, initialActivation, addDays, toDateStr, reevaluate } from "../_shared/playbook-eval.ts";

const MAX_APPLY = 200; // per-invocation guard; dedupe lets later runs continue
const TERMINAL = ["done", "ignored", "skipped"];

serve(async () => {
  const supabase = serviceClient();
  try {
    const { data: templates, error: tErr } = await supabase.from("playbook_templates").select("*").eq("status", "live");
    if (tErr) throw tErr;
    const live = templates ?? [];
    const ids = live.map((t: any) => t.id);
    if (!ids.length) return json({ ok: true, applied: 0, archived: 0, reevaluated: 0, note: "no live templates" });

    const [{ data: groups }, { data: steps }, { data: companies }, { data: runs }] = await Promise.all([
      supabase.from("playbook_groups").select("*").in("template_id", ids),
      supabase.from("playbook_template_steps").select("*").in("template_id", ids),
      supabase.from("companies").select("id,health_score,health_band,segment,arr,phase,status,renewal_date,owner_id"),
      supabase.from("playbook_runs").select("id,template_id,company_id,status").neq("status", "archived"),
    ]);
    const groupsByTpl = new Map<string, any[]>(); for (const g of groups ?? []) (groupsByTpl.get(g.template_id) ?? groupsByTpl.set(g.template_id, []).get(g.template_id)!).push(g);
    const stepsByTpl = new Map<string, any[]>(); for (const s of steps ?? []) (stepsByTpl.get(s.template_id) ?? stepsByTpl.set(s.template_id, []).get(s.template_id)!).push(s);
    const coById = new Map<string, any>(); for (const c of companies ?? []) coById.set(c.id, c);
    const existing = new Set<string>(); for (const r of runs ?? []) existing.add(`${r.template_id}|${r.company_id}`);

    let applied = 0, archived = 0, reevaluated = 0;
    const now = new Date();

    // 1. ENTRY — apply matching templates to company targets
    for (const t of live) {
      if (t.target_model !== "company" || isEmptyRuleGroup(t.entry_criteria)) continue;
      const tSteps = (stepsByTpl.get(t.id) ?? []).slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      const gById = new Map((groupsByTpl.get(t.id) ?? []).map((g) => [g.id, g]));
      for (const c of companies ?? []) {
        if (applied >= MAX_APPLY) break;
        if (existing.has(`${t.id}|${c.id}`)) continue;
        const ctx = companyContext(c);
        if (!evaluateRules(t.entry_criteria, ctx)) continue;
        const { data: run, error: rErr } = await supabase.from("playbook_runs").insert({ template_id: t.id, company_id: c.id, target_model: "company", target_record_id: c.id, status: "active", entry_snapshot: ctx }).select("id").single();
        if (rErr || !run) continue;
        // per-step: create task (active task steps) then the run step — parallel across steps
        await Promise.all(tSteps.map(async (s: any) => {
          const start = addDays(now, s.start_after_days ?? 0, s.workdays_only ?? true);
          const due = s.duration_days ? addDays(start, s.duration_days, s.workdays_only ?? true) : start;
          const state = initialActivation(s, s.group_id ? gById.get(s.group_id) : undefined, ctx);
          let taskId: string | null = null;
          if (s.step_type === "task" && state === "active") {
            const assignee = s.owner_ref?.value === "account_owner" ? (c.owner_id ?? null) : null;
            const { data: task } = await supabase.from("tasks").insert({ company_id: c.id, title: s.title ?? "Step", due_date: toDateStr(due), priority: s.default_priority ?? "normal", origin: "playbook", assignee_id: assignee }).select("id").single();
            taskId = task?.id ?? null;
          }
          await supabase.from("playbook_run_steps").insert({ run_id: run.id, template_step_id: s.id, group_id: s.group_id ?? null, task_id: taskId, step_type: s.step_type ?? "task", position: s.position ?? 0, activation_state: state, start_date: toDateStr(start), due_date: toDateStr(due) });
        }));
        existing.add(`${t.id}|${c.id}`);
        applied++;
      }
    }

    // 2 + 3. EXIT + REEVAL on active runs (includes ones just created)
    const templateById = new Map(live.map((t: any) => [t.id, t]));
    const { data: activeRuns } = await supabase.from("playbook_runs").select("id,template_id,company_id").eq("status", "active");
    for (const run of activeRuns ?? []) {
      const t = templateById.get(run.template_id); const c = coById.get(run.company_id);
      if (!t || !c) continue;
      const ctx = companyContext(c);

      if (!isEmptyRuleGroup(t.exit_criteria) && evaluateRules(t.exit_criteria, ctx)) {
        await supabase.from("playbook_runs").update({ status: "archived", archived_at: new Date().toISOString(), archive_action: t.exit_archive_action }).eq("id", run.id);
        if (t.exit_archive_action === "cancel_remaining") {
          const { data: rs } = await supabase.from("playbook_run_steps").select("id,task_id,activation_state").eq("run_id", run.id);
          await Promise.all((rs ?? []).filter((x) => !TERMINAL.includes(x.activation_state)).map(async (x) => {
            await supabase.from("playbook_run_steps").update({ activation_state: "skipped", skip_reason: "exit criteria met" }).eq("id", x.id);
            if (x.task_id) await supabase.from("tasks").update({ completed_at: new Date().toISOString() }).eq("id", x.task_id);
          }));
        }
        archived++;
        continue;
      }

      const tSteps = stepsByTpl.get(run.template_id) ?? [];
      const stepById = new Map(tSteps.map((s: any) => [s.id, s]));
      const groupById = new Map((groupsByTpl.get(run.template_id) ?? []).map((g) => [g.id, g]));
      const { data: rsteps } = await supabase.from("playbook_run_steps").select("*").eq("run_id", run.id);
      const changes = reevaluate(rsteps ?? [], stepById, groupById, ctx);
      await Promise.all(changes.map(async (ch) => {
        const rs = (rsteps ?? []).find((x) => x.id === ch.id);
        let taskId = rs?.task_id ?? null;
        if (ch.activation_state === "active" && rs?.step_type === "task" && !rs?.task_id) {
          const tpl = rs.template_step_id ? stepById.get(rs.template_step_id) : undefined;
          const assignee = tpl?.owner_ref?.value === "account_owner" ? (c.owner_id ?? null) : null;
          const { data: task } = await supabase.from("tasks").insert({ company_id: c.id, title: tpl?.title ?? "Step", due_date: rs.due_date, priority: tpl?.default_priority ?? "normal", origin: "playbook", assignee_id: assignee }).select("id").single();
          taskId = task?.id ?? null;
        }
        await supabase.from("playbook_run_steps").update({ activation_state: ch.activation_state, task_id: taskId }).eq("id", ch.id);
      }));
      if (changes.length) reevaluated++;
    }

    return json({ ok: true, applied, archived, reevaluated, liveTemplates: live.length });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
