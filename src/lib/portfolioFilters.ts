// Shared drill-down system (B1). One typed FilterSpec that serialises to/from
// Portfolio URL params, applied by the Portfolio page and produced by every
// clickable KPI card, report chart element and dashboard widget.

import type { Company } from './types';
import { daysUntil } from './utils';

export interface FilterSpec {
  segment?: string;
  healthBand?: 'green' | 'amber' | 'red';
  owner?: string;
  renewalWindowDays?: number;
  atRiskRenewal?: boolean;
  phase?: string;
  noTouchDays?: number;
  npsBucket?: 'promoter' | 'passive' | 'detractor';
  quarter?: string; // e.g. "2026Q4"
  status?: string;
}

const KEYS: (keyof FilterSpec)[] = [
  'segment', 'healthBand', 'owner', 'renewalWindowDays', 'atRiskRenewal',
  'phase', 'noTouchDays', 'npsBucket', 'quarter', 'status',
];

const NUMERIC: (keyof FilterSpec)[] = ['renewalWindowDays', 'noTouchDays'];
const BOOL: (keyof FilterSpec)[] = ['atRiskRenewal'];

// URL param aliases keep query strings short + spec-accurate (?band=amber).
const ALIAS: Partial<Record<keyof FilterSpec, string>> = { healthBand: 'band' };
const REV_ALIAS: Record<string, keyof FilterSpec> = Object.fromEntries(
  Object.entries(ALIAS).map(([k, v]) => [v, k as keyof FilterSpec])
);

export function filterToParams(spec: FilterSpec): URLSearchParams {
  const p = new URLSearchParams();
  for (const key of KEYS) {
    const v = spec[key];
    if (v == null || v === '' || v === false) continue;
    p.set(ALIAS[key] ?? key, String(v));
  }
  return p;
}

export function filterToQuery(spec: FilterSpec): string {
  const s = filterToParams(spec).toString();
  return s ? `?${s}` : '';
}

export function paramsToFilter(params: URLSearchParams): FilterSpec {
  const spec: FilterSpec = {};
  params.forEach((value, rawKey) => {
    const key = (REV_ALIAS[rawKey] ?? rawKey) as keyof FilterSpec;
    if (!KEYS.includes(key)) return;
    if (NUMERIC.includes(key)) (spec as Record<string, unknown>)[key] = Number(value);
    else if (BOOL.includes(key)) (spec as Record<string, unknown>)[key] = value === 'true';
    else (spec as Record<string, unknown>)[key] = value;
  });
  return spec;
}

export function isEmptyFilter(spec: FilterSpec): boolean {
  return KEYS.every((k) => spec[k] == null || spec[k] === '' || spec[k] === false);
}

// Human-readable chips for the dismissible filter bar.
export function describeFilter(spec: FilterSpec, ownerName?: (id: string) => string): { key: keyof FilterSpec; label: string }[] {
  const chips: { key: keyof FilterSpec; label: string }[] = [];
  if (spec.segment) chips.push({ key: 'segment', label: `Segment: ${spec.segment === 'mid_touch' ? 'Mid-touch' : spec.segment}` });
  if (spec.healthBand) chips.push({ key: 'healthBand', label: `Health: ${spec.healthBand}` });
  if (spec.owner) chips.push({ key: 'owner', label: `Owner: ${ownerName?.(spec.owner) ?? spec.owner}` });
  if (spec.renewalWindowDays != null) chips.push({ key: 'renewalWindowDays', label: `Renews ≤${spec.renewalWindowDays}d` });
  if (spec.atRiskRenewal) chips.push({ key: 'atRiskRenewal', label: 'At-risk renewals' });
  if (spec.phase) chips.push({ key: 'phase', label: `Phase: ${spec.phase.replace(/_/g, ' ')}` });
  if (spec.noTouchDays != null) chips.push({ key: 'noTouchDays', label: `No touch ${spec.noTouchDays}d+` });
  if (spec.npsBucket) chips.push({ key: 'npsBucket', label: `NPS: ${spec.npsBucket}` });
  if (spec.quarter) chips.push({ key: 'quarter', label: `Renewal: ${spec.quarter}` });
  if (spec.status) chips.push({ key: 'status', label: `Status: ${spec.status}` });
  return chips;
}

function quarterOf(dateStr?: string | null): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return `${d.getFullYear()}Q${Math.floor(d.getMonth() / 3) + 1}`;
}

// Apply a FilterSpec to a company list. `lastTouchAt` drives the no-touch filter.
export function applyFilter(companies: Company[], spec: FilterSpec): Company[] {
  return companies.filter((c) => {
    if (spec.segment && c.segment !== spec.segment) return false;
    if (spec.healthBand && c.healthBand !== spec.healthBand) return false;
    if (spec.owner && c.ownerId !== spec.owner) return false;
    if (spec.phase && c.phase !== spec.phase) return false;
    if (spec.status && c.status !== spec.status) return false;
    if (spec.quarter && quarterOf(c.renewalDate) !== spec.quarter) return false;
    if (spec.renewalWindowDays != null) {
      const d = daysUntil(c.renewalDate);
      if (d == null || d < 0 || d > spec.renewalWindowDays) return false;
    }
    if (spec.atRiskRenewal) {
      const d = daysUntil(c.renewalDate);
      if (d == null || d < 0 || d > 90 || (c.healthScore ?? 100) >= 60) return false;
    }
    if (spec.noTouchDays != null) {
      const d = c.lastTouchAt ? Math.abs(daysUntil(c.lastTouchAt) ?? 0) : 9999;
      if (d < spec.noTouchDays) return false;
    }
    return true;
  });
}
