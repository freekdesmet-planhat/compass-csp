// Segment presets drive defaults everywhere: default portfolio view, KPI cards,
// health-score weights, touch-cadence norms and alert thresholds.

export type Segment = 'scaled' | 'mid_touch' | 'enterprise';
export type Role = 'csm' | 'manager' | 'admin';

export const SEGMENT_PRESETS = {
  scaled: {
    label: 'Scaled',
    touchSlaDays: 90,
    expectedActiveContacts: 1,
    meetingNormPerQuarter: 0,
    kpis: [
      'health_distribution',
      'at_risk_count',
      'no_touch_60d',
      'usage_adoption_pct',
      'nps_response_rate',
      'playbook_completion',
      'renewal_rate_count',
    ],
  },
  mid_touch: {
    label: 'Mid-touch',
    touchSlaDays: 45,
    expectedActiveContacts: 3,
    meetingNormPerQuarter: 2,
    kpis: [
      'health_weighted_arr',
      'renewals_90d_arr',
      'at_risk_arr',
      'meetings_this_week',
      'expansion_pipeline',
      'nps_trend',
    ],
  },
  enterprise: {
    label: 'Enterprise',
    touchSlaDays: 21,
    expectedActiveContacts: 6,
    meetingNormPerQuarter: 6,
    kpis: [
      'success_plan_progress',
      'stakeholder_coverage',
      'exec_engagement_recency',
      'nrr',
      'at_risk_arr',
      'qbr_compliance',
    ],
  },
} as const satisfies Record<Segment, unknown>;

export type KpiKey =
  (typeof SEGMENT_PRESETS)[keyof typeof SEGMENT_PRESETS]['kpis'][number];

export const SEGMENT_LABELS: Record<Segment, string> = {
  scaled: 'Scaled',
  mid_touch: 'Mid-touch',
  enterprise: 'Enterprise',
};

// Human labels for KPI keys (used by the Portfolio KPI cards)
export const KPI_LABELS: Record<string, string> = {
  health_distribution: 'Health distribution',
  at_risk_count: 'At-risk accounts',
  no_touch_60d: 'No touch 60d+',
  usage_adoption_pct: 'Usage adoption',
  nps_response_rate: 'NPS response rate',
  playbook_completion: 'Playbook completion',
  renewal_rate_count: 'Renewals won (QTD)',
  health_weighted_arr: 'Health-weighted ARR',
  renewals_90d_arr: 'Renewals in 90d',
  at_risk_arr: 'At-risk ARR',
  meetings_this_week: 'Meetings this week',
  expansion_pipeline: 'Expansion pipeline',
  nps_trend: 'NPS (avg)',
  success_plan_progress: 'Success plan progress',
  stakeholder_coverage: 'Stakeholder coverage',
  exec_engagement_recency: 'Exec engagement',
  nrr: 'Net revenue retention',
  qbr_compliance: 'QBR compliance',
};

// Default health-config weights per segment (must sum to 100). Seeds health_configs.
export const DEFAULT_HEALTH_WEIGHTS: Record<Segment, Record<string, number>> = {
  enterprise: { value: 20, engagement: 20, support: 25, sentiment: 20, usage: 15 },
  mid_touch: { value: 10, engagement: 20, support: 25, sentiment: 20, usage: 25 },
  scaled: { value: 0, engagement: 20, support: 20, sentiment: 15, usage: 45 },
};

export const DEFAULT_HEALTH_THRESHOLDS = { red: 40, amber: 70 };

export const HEALTH_DIMENSIONS = [
  { key: 'value', label: 'Value to client' },
  { key: 'engagement', label: 'Engagement' },
  { key: 'support', label: 'Support / performance' },
  { key: 'sentiment', label: 'Sentiment' },
  { key: 'usage', label: 'Usage' },
] as const;
