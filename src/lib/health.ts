// ── Health score engine (Section 4) ─────────────────────────────────────────
// Five dimensions normalised 0–100, combined as a weighted average using the
// owning segment's weights. Deterministic per-dimension contribution math lives
// here (weight × score); the AI only narrates, it never invents numbers.
//
// This module is imported by the client (demo mode + live display) AND mirrored
// by the compute-health edge function so the math is identical everywhere.

import type { HealthBand } from './utils';
import type { HealthRecommendation } from './types';

export interface HealthInputs {
  // Value to client — manual 1–10 (or null = excluded, weight redistributed)
  valueScore: number | null;
  valueComment?: string | null;

  // Engagement
  inboundEmailRecencyDays: number | null; // days since last inbound email
  emailReplyRate30d: number | null; // 0..1
  meetingsLast90d: number;
  meetingNormPerQuarter: number;
  distinctActiveContacts90d: number;
  expectedActiveContacts: number;

  // Support / performance
  openP1: number;
  openP2: number;
  avgResolutionDays90d: number | null;
  incidentCount90d: number;
  hasTicketData: boolean;

  // Sentiment
  sentimentAssessment: number | null; // manual 1–10
  companyNps: number | null; // -100..100
  execContactRelationshipAvg: number | null; // 1–10 across exec_sponsor/decision_maker
  callSentimentRolling: number | null; // -1..1
  execRelationshipFlag: boolean;

  // Usage
  wau: number | null;
  seats: number | null;
  adoptionBreadth: number | null; // 0..1 fraction of adoption metrics active
  usageTrendSlope: number | null; // normalised -1..1 over trend_weeks
}

export interface DimensionResult {
  score: number | null;
  inputs: Record<string, number | string | null>;
  contribution: number;
  weight: number;
}

export interface HealthResult {
  overall: number;
  band: HealthBand;
  dimensions: Record<string, DimensionResult>;
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

// 1. Value to client — manual 1–10 → ×10. Missing = excluded.
function scoreValue(i: HealthInputs): DimensionResult['score'] {
  if (i.valueScore == null) return null;
  return clamp(i.valueScore * 10);
}

// 2. Engagement — equal thirds, each capped at 100.
function scoreEngagement(i: HealthInputs): number {
  // (a) inbound-email recency & reply rate over 30d
  let recencyScore = 50;
  if (i.inboundEmailRecencyDays != null) {
    // fresh (0d) → 100, 30d → ~0
    recencyScore = clamp(100 - (i.inboundEmailRecencyDays / 30) * 100);
  }
  const replyScore = i.emailReplyRate30d != null ? clamp(i.emailReplyRate30d * 100) : recencyScore;
  const emailThird = clamp((recencyScore + replyScore) / 2);

  // (b) meetings last 90d vs norm for segment
  const norm = Math.max(i.meetingNormPerQuarter, 1);
  const meetingThird = clamp((i.meetingsLast90d / norm) * 100);

  // (c) stakeholder breadth: distinct contacts w/ touch in 90d vs expected
  const expected = Math.max(i.expectedActiveContacts, 1);
  const breadthThird = clamp((i.distinctActiveContacts90d / expected) * 100);

  return clamp((emailThird + meetingThird + breadthThird) / 3);
}

// 3. Support / performance — start at 100 and subtract; floor 0. No data → 75.
function scoreSupport(i: HealthInputs): number {
  if (!i.hasTicketData) return 75;
  let s = 100;
  s -= i.openP1 * 40;
  s -= i.openP2 * 15;
  if (i.avgResolutionDays90d != null) {
    const over = i.avgResolutionDays90d - 5; // 5-day target
    if (over > 0) s -= Math.min(over * 3, 30);
  }
  s -= i.incidentCount90d * 5;
  return clamp(s);
}

// 4. Sentiment — weighted 30/25/20/15/10 blend.
function scoreSentiment(i: HealthInputs): number | null {
  const parts: { w: number; v: number }[] = [];
  if (i.sentimentAssessment != null) parts.push({ w: 30, v: clamp(i.sentimentAssessment * 10) });
  if (i.companyNps != null) parts.push({ w: 25, v: clamp((i.companyNps + 100) / 2) });
  if (i.execContactRelationshipAvg != null)
    parts.push({ w: 20, v: clamp(i.execContactRelationshipAvg * 10) });
  if (i.callSentimentRolling != null) parts.push({ w: 15, v: clamp((i.callSentimentRolling + 1) * 50) });
  if (parts.length === 0) return null;
  const totalW = parts.reduce((a, p) => a + p.w, 0);
  let s = parts.reduce((a, p) => a + p.v * p.w, 0) / totalW;
  if (i.execRelationshipFlag) s += 10; // +10 bonus
  return clamp(s);
}

// 5. Usage — 50% utilisation + 30% adoption breadth + 20% trend slope.
function scoreUsage(i: HealthInputs): number | null {
  if (i.wau == null && i.adoptionBreadth == null && i.usageTrendSlope == null) return null;
  const utilisation =
    i.wau != null && i.seats != null && i.seats > 0 ? clamp((i.wau / i.seats) * 100) : 50;
  const adoption = i.adoptionBreadth != null ? clamp(i.adoptionBreadth * 100) : 50;
  // positive slope 100 / flat 50 / declining 0, linear in between
  const trend = i.usageTrendSlope != null ? clamp((i.usageTrendSlope + 1) * 50) : 50;
  return clamp(utilisation * 0.5 + adoption * 0.3 + trend * 0.2);
}

export function computeHealth(
  inputs: HealthInputs,
  weights: Record<string, number>,
  thresholds: { red: number; amber: number } = { red: 40, amber: 70 }
): HealthResult {
  const rawScores: Record<string, number | null> = {
    value: scoreValue(inputs),
    engagement: scoreEngagement(inputs),
    support: scoreSupport(inputs),
    sentiment: scoreSentiment(inputs),
    usage: scoreUsage(inputs),
  };

  const rawInputs: Record<string, Record<string, number | string | null>> = {
    value: { valueScore: inputs.valueScore, valueComment: inputs.valueComment ?? null },
    engagement: {
      inboundEmailRecencyDays: inputs.inboundEmailRecencyDays,
      emailReplyRate30d: inputs.emailReplyRate30d,
      meetingsLast90d: inputs.meetingsLast90d,
      meetingNorm: inputs.meetingNormPerQuarter,
      distinctActiveContacts90d: inputs.distinctActiveContacts90d,
      expectedActiveContacts: inputs.expectedActiveContacts,
    },
    support: {
      openP1: inputs.openP1,
      openP2: inputs.openP2,
      avgResolutionDays90d: inputs.avgResolutionDays90d,
      incidentCount90d: inputs.incidentCount90d,
      hasTicketData: inputs.hasTicketData ? 1 : 0,
    },
    sentiment: {
      sentimentAssessment: inputs.sentimentAssessment,
      companyNps: inputs.companyNps,
      execContactRelationshipAvg: inputs.execContactRelationshipAvg,
      callSentimentRolling: inputs.callSentimentRolling,
      execRelationshipFlag: inputs.execRelationshipFlag ? 1 : 0,
    },
    usage: {
      wau: inputs.wau,
      seats: inputs.seats,
      adoptionBreadth: inputs.adoptionBreadth,
      usageTrendSlope: inputs.usageTrendSlope,
    },
  };

  // Redistribute excluded dimensions' weight pro-rata across present ones.
  const presentKeys = Object.keys(rawScores).filter((k) => rawScores[k] != null);
  const presentWeightTotal = presentKeys.reduce((a, k) => a + (weights[k] ?? 0), 0) || 1;

  const dimensions: Record<string, DimensionResult> = {};
  let overall = 0;
  for (const key of Object.keys(rawScores)) {
    const score = rawScores[key];
    const baseWeight = weights[key] ?? 0;
    // effective weight = base scaled up so present weights sum to 100
    const effWeight = score == null ? 0 : (baseWeight / presentWeightTotal) * 100;
    const contribution = score == null ? 0 : (effWeight / 100) * score;
    overall += contribution;
    dimensions[key] = {
      score: score == null ? null : Math.round(score),
      inputs: rawInputs[key],
      contribution: Math.round(contribution * 10) / 10,
      weight: Math.round(effWeight * 10) / 10,
    };
  }

  overall = Math.round(overall);
  const band: HealthBand = overall < thresholds.red ? 'red' : overall < thresholds.amber ? 'amber' : 'green';
  return { overall, band, dimensions };
}

const DIM_LABEL: Record<string, string> = {
  value: 'Value to client', engagement: 'Engagement', support: 'Support / performance',
  sentiment: 'Sentiment', usage: 'Usage',
};

const REC_TEMPLATES: Record<string, HealthRecommendation> = {
  value: { title: 'Reconfirm value with the sponsor', why: 'Value-to-client is scoring low — realign on the outcomes and ROI the account signed up for.', suggestedTask: { title: 'Schedule a value review with the exec sponsor', dueInDays: 7 } },
  engagement: { title: 'Re-engage the account', why: 'Engagement is thin — meeting cadence or stakeholder breadth has slipped.', suggestedTask: { title: 'Book a check-in and refresh the stakeholder map', dueInDays: 5 } },
  support: { title: 'Clear support friction', why: 'Open or slow tickets are dragging the score down.', suggestedTask: { title: 'Review open tickets with the support lead', dueInDays: 3 } },
  sentiment: { title: 'Address sentiment risk', why: 'Sentiment signals (NPS, exec relationships) are soft.', suggestedTask: { title: 'Run a relationship + sentiment pulse', dueInDays: 7 } },
  usage: { title: 'Drive adoption', why: 'Usage/adoption is below expectation for the segment.', suggestedTask: { title: 'Plan an enablement or activation push', dueInDays: 10 } },
};

// Deterministic narrative + recommendations from a computed result. The V1 design
// had an AI narrate this; in live mode there's no AI job, so we derive an honest
// explanation directly from the dimension contributions (no invented numbers).
export function explainHealth(res: HealthResult): { explanation: string; recommendations: HealthRecommendation[] } {
  const entries = Object.entries(res.dimensions);
  const present = entries.filter(([, d]) => d.score != null);
  const excluded = entries.filter(([, d]) => d.score == null).map(([k]) => DIM_LABEL[k] ?? k);

  if (!present.length) {
    return { explanation: `Overall health is ${res.overall} (${res.band}). No dimension data is available yet — add a value/sentiment rating or connect more signals, then recompute.`, recommendations: [] };
  }

  const byContribDesc = [...present].sort((a, b) => b[1].contribution - a[1].contribution);
  const byScoreAsc = [...present].sort((a, b) => (a[1].score ?? 0) - (b[1].score ?? 0));
  const top = byContribDesc[0];
  const weakest = byScoreAsc[0];

  const parts = [`Overall health is ${res.overall} (${res.band}).`];
  parts.push(`${DIM_LABEL[top[0]] ?? top[0]} is the biggest driver, contributing ${top[1].contribution} points (score ${top[1].score}, weight ${top[1].weight}%).`);
  if (weakest && weakest[0] !== top[0] && (weakest[1].score ?? 100) < 60) {
    parts.push(`${DIM_LABEL[weakest[0]] ?? weakest[0]} is the weakest area at ${weakest[1].score}/100 — the clearest place to improve.`);
  }
  if (excluded.length) {
    parts.push(`${excluded.join(' and ')} ${excluded.length > 1 ? 'are' : 'is'} excluded for lack of data, so ${excluded.length > 1 ? 'their' : 'its'} weight was redistributed across the rest.`);
  }

  const recommendations = byScoreAsc
    .filter(([, d]) => (d.score ?? 100) < 65)
    .slice(0, 3)
    .map(([k]) => REC_TEMPLATES[k])
    .filter(Boolean);

  return { explanation: parts.join(' '), recommendations };
}
