-- ============================================================================
-- Compass — 05. Seed config (health_configs, alert_rules, playbooks)
-- ----------------------------------------------------------------------------
-- Weights/thresholds/input_config mirror src/lib/segments.ts exactly.
-- ============================================================================

-- ── health_configs (one row per segment) ─────────────────────────────────────
insert into public.health_configs (segment, weights, thresholds, input_config) values
  ('enterprise',
   '{"value":20,"engagement":20,"support":25,"sentiment":20,"usage":15}',
   '{"red":40,"amber":70}',
   '{"usage":{"wau_metric":"weekly_active_users","seats_metric":"licensed_seats","adoption_metrics":["feature_x_users"],"trend_weeks":4}}'),
  ('mid_touch',
   '{"value":10,"engagement":20,"support":25,"sentiment":20,"usage":25}',
   '{"red":40,"amber":70}',
   '{"usage":{"wau_metric":"weekly_active_users","seats_metric":"licensed_seats","adoption_metrics":["feature_x_users"],"trend_weeks":4}}'),
  ('scaled',
   '{"value":0,"engagement":20,"support":20,"sentiment":15,"usage":45}',
   '{"red":40,"amber":70}',
   '{"usage":{"wau_metric":"weekly_active_users","seats_metric":"licensed_seats","adoption_metrics":["feature_x_users"],"trend_weeks":4}}')
on conflict (segment) do update set weights = excluded.weights, thresholds = excluded.thresholds, input_config = excluded.input_config;

-- ── alert_rules (Section 7; all segment-aware) ────────────────────────────────
insert into public.alert_rules (name, description, rule_type, config, segment, enabled, severity) values
  ('Health drop ≥10 WoW','Cached health fell 10+ points week-over-week','health_drop','{"points":10}','{scaled,mid_touch,enterprise}',true,'warning'),
  ('Crossed into red','Health band moved to red','health_band_red','{}','{scaled,mid_touch,enterprise}',true,'critical'),
  ('No touch > SLA','No touch beyond the segment touch SLA','no_touch_sla','{}','{scaled,mid_touch,enterprise}',true,'warning'),
  ('Renewal ≤90d & health <60','At-risk renewal','renewal_at_risk','{"days":90,"health":60}','{scaled,mid_touch,enterprise}',true,'critical'),
  ('NPS detractor received','A detractor NPS response landed','nps_detractor','{}','{scaled,mid_touch,enterprise}',true,'warning'),
  ('Open deal no activity 14d','Open deal with no activity for 14 days','deal_stale','{"days":14}','{scaled,mid_touch,enterprise}',true,'warning'),
  ('Playbook step overdue 3d','A playbook step is 3+ days overdue','playbook_overdue','{"days":3}','{scaled,mid_touch,enterprise}',true,'info'),
  ('New P1 ticket','A new P1 ticket was opened','new_p1','{}','{scaled,mid_touch,enterprise}',true,'critical'),
  ('Gmail/Calendar connection broken','A Google connection is in error state','connection_broken','{}','{scaled,mid_touch,enterprise}',true,'warning')
on conflict do nothing;

-- ── playbook templates + steps ────────────────────────────────────────────────
do $$
declare tid uuid;
begin
  -- Onboarding (scaled)
  insert into public.playbook_templates (name, description, segment, trigger, trigger_config)
    values ('Onboarding — Scaled','Automated one-to-many onboarding','{scaled}','new_customer','{}') returning id into tid;
  insert into public.playbook_template_steps (template_id, position, title, relative_due_days, default_priority) values
    (tid,1,'Send welcome email sequence',0,'normal'),
    (tid,2,'Activation check @ day 14',14,'normal'),
    (tid,3,'30-day value review',30,'high');

  -- Onboarding (mid/enterprise)
  insert into public.playbook_templates (name, description, segment, trigger, trigger_config)
    values ('Onboarding — Mid/Enterprise','High-touch onboarding with kickoff + success plan','{mid_touch,enterprise}','new_customer','{}') returning id into tid;
  insert into public.playbook_template_steps (template_id, position, title, relative_due_days, default_priority) values
    (tid,1,'Kickoff call',3,'high'),
    (tid,2,'Build success plan',10,'high'),
    (tid,3,'Admin + user training',21,'normal'),
    (tid,4,'30-day executive review',30,'high');

  -- Renewal 120-day motion (mid/enterprise)
  insert into public.playbook_templates (name, description, segment, trigger, trigger_config)
    values ('Renewal 120-day motion','T-120 review → T-90 exec check-in → T-60 proposal → T-30 close plan','{mid_touch,enterprise}','renewal_t_minus','{"days_before_renewal":120}') returning id into tid;
  insert into public.playbook_template_steps (template_id, position, title, relative_due_days, default_priority) values
    (tid,1,'T-120 internal review',0,'normal'),
    (tid,2,'T-90 exec check-in',30,'high'),
    (tid,3,'T-60 proposal',60,'high'),
    (tid,4,'T-30 close plan',90,'high');

  -- Scaled renewal automation
  insert into public.playbook_templates (name, description, segment, trigger, trigger_config)
    values ('Scaled renewal automation','T-60 sequence of email tasks','{scaled}','renewal_t_minus','{"days_before_renewal":60}') returning id into tid;
  insert into public.playbook_template_steps (template_id, position, title, relative_due_days, default_priority) values
    (tid,1,'T-60 renewal email 1',0,'normal'),
    (tid,2,'T-45 reminder',15,'normal'),
    (tid,3,'T-15 final notice',45,'high');

  -- Risk turnaround
  insert into public.playbook_templates (name, description, segment, trigger, trigger_config)
    values ('Risk turnaround','Triggered by a health drop','{scaled,mid_touch,enterprise}','health_drop','{"points":10}') returning id into tid;
  insert into public.playbook_template_steps (template_id, position, title, relative_due_days, default_priority) values
    (tid,1,'Root-cause call',2,'high'),
    (tid,2,'Executive escalation',5,'high'),
    (tid,3,'Path-to-green plan',7,'high');

  -- Enterprise exec-sponsor cadence
  insert into public.playbook_templates (name, description, segment, trigger, trigger_config)
    values ('Enterprise exec-sponsor cadence','Quarterly executive engagement','{enterprise}','manual','{}') returning id into tid;
  insert into public.playbook_template_steps (template_id, position, title, relative_due_days, default_priority) values
    (tid,1,'Quarterly exec sync',0,'normal'),
    (tid,2,'QBR prep',80,'normal'),
    (tid,3,'QBR',90,'high');
end $$;
