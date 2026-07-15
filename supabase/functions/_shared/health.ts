// EXACT mirror of src/lib/health.ts — the deterministic 5-dimension scoring
// math (Section 4). Kept identical so the nightly compute-health Edge Function
// and the client display never diverge. Contributions are computed here; the
// AI only narrates the "why" and recommendations, it never invents numbers.

export interface HealthInputs {
  valueScore: number | null;
  valueComment?: string | null;
  inboundEmailRecencyDays: number | null;
  emailReplyRate30d: number | null;
  meetingsLast90d: number;
  meetingNormPerQuarter: number;
  distinctActiveContacts90d: number;
  expectedActiveContacts: number;
  openP1: number;
  openP2: number;
  avgResolutionDays90d: number | null;
  incidentCount90d: number;
  hasTicketData: boolean;
  sentimentAssessment: number | null;
  companyNps: number | null;
  execContactRelationshipAvg: number | null;
  callSentimentRolling: number | null;
  execRelationshipFlag: boolean;
  wau: number | null;
  seats: number | null;
  adoptionBreadth: number | null;
  usageTrendSlope: number | null;
}

export type HealthBand = "green" | "amber" | "red";
export interface DimensionResult { score: number | null; inputs: Record<string, number | string | null>; contribution: number; weight: number; }
export interface HealthResult { overall: number; band: HealthBand; dimensions: Record<string, DimensionResult>; }

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

function scoreValue(i: HealthInputs) { return i.valueScore == null ? null : clamp(i.valueScore * 10); }

function scoreEngagement(i: HealthInputs): number {
  let recencyScore = 50;
  if (i.inboundEmailRecencyDays != null) recencyScore = clamp(100 - (i.inboundEmailRecencyDays / 30) * 100);
  const replyScore = i.emailReplyRate30d != null ? clamp(i.emailReplyRate30d * 100) : recencyScore;
  const emailThird = clamp((recencyScore + replyScore) / 2);
  const norm = Math.max(i.meetingNormPerQuarter, 1);
  const meetingThird = clamp((i.meetingsLast90d / norm) * 100);
  const expected = Math.max(i.expectedActiveContacts, 1);
  const breadthThird = clamp((i.distinctActiveContacts90d / expected) * 100);
  return clamp((emailThird + meetingThird + breadthThird) / 3);
}

function scoreSupport(i: HealthInputs): number {
  if (!i.hasTicketData) return 75;
  let s = 100;
  s -= i.openP1 * 40;
  s -= i.openP2 * 15;
  if (i.avgResolutionDays90d != null) { const over = i.avgResolutionDays90d - 5; if (over > 0) s -= Math.min(over * 3, 30); }
  s -= i.incidentCount90d * 5;
  return clamp(s);
}

function scoreSentiment(i: HealthInputs): number | null {
  const parts: { w: number; v: number }[] = [];
  if (i.sentimentAssessment != null) parts.push({ w: 30, v: clamp(i.sentimentAssessment * 10) });
  if (i.companyNps != null) parts.push({ w: 25, v: clamp((i.companyNps + 100) / 2) });
  if (i.execContactRelationshipAvg != null) parts.push({ w: 20, v: clamp(i.execContactRelationshipAvg * 10) });
  if (i.callSentimentRolling != null) parts.push({ w: 15, v: clamp((i.callSentimentRolling + 1) * 50) });
  if (parts.length === 0) return null;
  const totalW = parts.reduce((a, p) => a + p.w, 0);
  let s = parts.reduce((a, p) => a + p.v * p.w, 0) / totalW;
  if (i.execRelationshipFlag) s += 10;
  return clamp(s);
}

function scoreUsage(i: HealthInputs): number | null {
  if (i.wau == null && i.adoptionBreadth == null && i.usageTrendSlope == null) return null;
  const utilisation = i.wau != null && i.seats != null && i.seats > 0 ? clamp((i.wau / i.seats) * 100) : 50;
  const adoption = i.adoptionBreadth != null ? clamp(i.adoptionBreadth * 100) : 50;
  const trend = i.usageTrendSlope != null ? clamp((i.usageTrendSlope + 1) * 50) : 50;
  return clamp(utilisation * 0.5 + adoption * 0.3 + trend * 0.2);
}

export function computeHealth(
  inputs: HealthInputs,
  weights: Record<string, number>,
  thresholds: { red: number; amber: number } = { red: 40, amber: 70 },
): HealthResult {
  const rawScores: Record<string, number | null> = {
    value: scoreValue(inputs), engagement: scoreEngagement(inputs), support: scoreSupport(inputs),
    sentiment: scoreSentiment(inputs), usage: scoreUsage(inputs),
  };
  const rawInputs: Record<string, Record<string, number | string | null>> = {
    value: { valueScore: inputs.valueScore, valueComment: inputs.valueComment ?? null },
    engagement: { inboundEmailRecencyDays: inputs.inboundEmailRecencyDays, emailReplyRate30d: inputs.emailReplyRate30d, meetingsLast90d: inputs.meetingsLast90d, meetingNorm: inputs.meetingNormPerQuarter, distinctActiveContacts90d: inputs.distinctActiveContacts90d, expectedActiveContacts: inputs.expectedActiveContacts },
    support: { openP1: inputs.openP1, openP2: inputs.openP2, avgResolutionDays90d: inputs.avgResolutionDays90d, incidentCount90d: inputs.incidentCount90d, hasTicketData: inputs.hasTicketData ? 1 : 0 },
    sentiment: { sentimentAssessment: inputs.sentimentAssessment, companyNps: inputs.companyNps, execContactRelationshipAvg: inputs.execContactRelationshipAvg, callSentimentRolling: inputs.callSentimentRolling, execRelationshipFlag: inputs.execRelationshipFlag ? 1 : 0 },
    usage: { wau: inputs.wau, seats: inputs.seats, adoptionBreadth: inputs.adoptionBreadth, usageTrendSlope: inputs.usageTrendSlope },
  };
  const presentKeys = Object.keys(rawScores).filter((k) => rawScores[k] != null);
  const presentWeightTotal = presentKeys.reduce((a, k) => a + (weights[k] ?? 0), 0) || 1;
  const dimensions: Record<string, DimensionResult> = {};
  let overall = 0;
  for (const key of Object.keys(rawScores)) {
    const score = rawScores[key];
    const baseWeight = weights[key] ?? 0;
    const effWeight = score == null ? 0 : (baseWeight / presentWeightTotal) * 100;
    const contribution = score == null ? 0 : (effWeight / 100) * score;
    overall += contribution;
    dimensions[key] = { score: score == null ? null : Math.round(score), inputs: rawInputs[key], contribution: Math.round(contribution * 10) / 10, weight: Math.round(effWeight * 10) / 10 };
  }
  overall = Math.round(overall);
  const band: HealthBand = overall < thresholds.red ? "red" : overall < thresholds.amber ? "amber" : "green";
  return { overall, band, dimensions };
}

export const SEGMENT_NORMS: Record<string, { meetingNormPerQuarter: number; expectedActiveContacts: number }> = {
  scaled: { meetingNormPerQuarter: 0, expectedActiveContacts: 1 },
  mid_touch: { meetingNormPerQuarter: 2, expectedActiveContacts: 3 },
  enterprise: { meetingNormPerQuarter: 6, expectedActiveContacts: 6 },
};
