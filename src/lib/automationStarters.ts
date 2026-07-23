// Templated-automation starter library (iteration2.md §8) wired to real Compass
// signals. Each becomes an `automations` row + `automation_steps` action(s),
// disabled by default. Slack = a plain outbound webhook (§8 — no OAuth).
import type { AutomationStepKind } from './types';
import type { RuleGroup } from './rules';

export interface StarterAction { kind: AutomationStepKind; config: Record<string, unknown> }
export interface AutomationStarter {
  key: string;
  name: string;
  description: string;
  triggerModel: string;
  triggerType: 'record_created' | 'record_updated' | 'record_created_or_updated';
  triggerFilter: RuleGroup;
  actions: StarterAction[];
}

export const AUTOMATION_STARTERS: AutomationStarter[] = [
  {
    key: 'health_drop', name: 'Health score drops to red',
    description: "When an account's health falls into the red band, alert the owner and post to a webhook (Slack/Teams).",
    triggerModel: 'company', triggerType: 'record_updated',
    triggerFilter: { match: 'all', rules: [{ field: 'health_band', op: 'eq', value: 'red' }] },
    actions: [
      { kind: 'notify', config: { mode: 'task', title: 'Health went red — investigate & build path to green', owner: 'account_owner' } },
      { kind: 'webhook', config: { url: '', message: '⚠️ {{company}} health dropped to red' } },
    ],
  },
  {
    key: 'renewal_90', name: '90 days before renewal',
    description: 'When an account is 90 days from renewal, create a renewal-motion task for the owner.',
    triggerModel: 'company', triggerType: 'record_updated',
    triggerFilter: { match: 'all', rules: [{ field: 'renewal_date_days_until', op: 'lte', value: 90 }] },
    actions: [{ kind: 'notify', config: { mode: 'task', title: 'Renewal in 90 days — kick off the renewal motion', owner: 'account_owner' } }],
  },
  {
    key: 'nps_submitted', name: 'NPS response submitted',
    description: 'When an NPS response comes in, create a follow-up task. (Promoter/passive/detractor branching lives in a Custom automation.)',
    triggerModel: 'nps', triggerType: 'record_created',
    triggerFilter: { match: 'all', rules: [] },
    actions: [{ kind: 'notify', config: { mode: 'task', title: 'Follow up on new NPS response', owner: 'account_owner' } }],
  },
  {
    key: 'sentiment_decline', name: 'Sentiment trend declining',
    description: 'When 30-day interaction sentiment trends down, flag the account and notify the manager. (Fires once the Sentiment pipeline lands in Part D.)',
    triggerModel: 'company', triggerType: 'record_updated',
    triggerFilter: { match: 'all', rules: [{ field: 'sentiment_trend_30d', op: 'lt', value: 0 }] },
    actions: [
      { kind: 'notify', config: { mode: 'task', title: 'Sentiment declining — review recent conversations', owner: 'account_owner' } },
      { kind: 'notify', config: { mode: 'in_app', target: 'manager', message: 'Sentiment declining on {{company}}' } },
    ],
  },
];
