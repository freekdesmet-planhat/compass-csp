// Client-side dataset layer (D2) — mirrors the ds_* RPCs for demo mode. Every
// dataset is scoped to the caller's visible company ids (RLS mirror), so widgets
// never leak another CSM's book. Returns [{label, value}] rows.
import { getDb } from './store';
import type { FilterSpec } from './portfolioFilters';
import type { Company, Deal, Activity, HealthSnapshot, NpsResponse, Task } from './types';

export type Dataset = 'companies' | 'renewals' | 'activities' | 'health_trend' | 'nps' | 'tasks';
export interface DatasetRow { label: string; value: number }
export interface DatasetSpec { dataset: string; groupBy?: string | null; measure?: string | null; filter?: FilterSpec }

const SEGMENT_LABEL = (s: string | null | undefined) => (s === 'mid_touch' ? 'Mid-touch' : s ? s[0].toUpperCase() + s.slice(1) : '(none)');

function quarterOf(d?: string | null): string { if (!d) return '(none)'; const dt = new Date(d); return `${dt.getFullYear()}Q${Math.floor(dt.getMonth() / 3) + 1}`; }
function monthOf(d?: string | null): string { return d ? d.slice(0, 7) : '(none)'; }

export function runDataset(spec: DatasetSpec, visibleIds: Set<string>, ownerName: (id: string) => string): DatasetRow[] {
  const db = getDb();
  const measure = spec.measure ?? 'count';
  const groupBy = spec.groupBy ?? 'segment';
  const inScope = <T extends { companyId?: string; id?: string }>(rows: T[], key: 'companyId' | 'id') => rows.filter((r) => visibleIds.has((r as Record<string, string>)[key]));

  const agg = (rows: { arr?: number | null; healthScore?: number | null }[], m: string): number => {
    if (m === 'sum_arr') return Math.round(rows.reduce((a, r) => a + (r.arr ?? 0), 0));
    if (m === 'avg_health') return rows.length ? Math.round(rows.reduce((a, r) => a + (r.healthScore ?? 0), 0) / rows.length) : 0;
    return rows.length;
  };
  const group = <T,>(rows: T[], keyFn: (r: T) => string, m: string): DatasetRow[] => {
    const map = new Map<string, T[]>();
    rows.forEach((r) => { const k = keyFn(r); (map.get(k) ?? map.set(k, []).get(k)!).push(r); });
    return [...map.entries()].map(([label, rs]) => ({ label, value: agg(rs as { arr?: number | null; healthScore?: number | null }[], m) })).sort((a, b) => b.value - a.value);
  };

  switch (spec.dataset as Dataset) {
    case 'companies': {
      const rows = inScope(db.companies as Company[], 'id');
      const keyFn = groupBy === 'healthBand' ? (c: Company) => c.healthBand ?? '(none)'
        : groupBy === 'owner' ? (c: Company) => ownerName(c.ownerId ?? '')
        : groupBy === 'phase' ? (c: Company) => c.phase ?? '(none)'
        : groupBy === 'region' ? (c: Company) => c.region ?? '(none)'
        : (c: Company) => SEGMENT_LABEL(c.segment);
      return group(rows, keyFn, measure);
    }
    case 'renewals': {
      const rows = (db.deals as Deal[]).filter((d) => d.pipeline === 'renewal' && d.status === 'open' && visibleIds.has(d.companyId));
      const keyFn = groupBy === 'quarter' ? (d: Deal) => quarterOf(d.closeDate) : groupBy === 'forecast' ? (d: Deal) => d.forecastCategory ?? '(none)' : (d: Deal) => d.stage ?? '(none)';
      const map = new Map<string, Deal[]>();
      rows.forEach((d) => { const k = keyFn(d); (map.get(k) ?? map.set(k, []).get(k)!).push(d); });
      return [...map.entries()].map(([label, ds]) => ({ label, value: measure === 'count' ? ds.length : Math.round(ds.reduce((a, d) => a + (d.amount ?? 0), 0)) })).sort((a, b) => (spec.groupBy === 'quarter' ? a.label.localeCompare(b.label) : b.value - a.value));
    }
    case 'activities': {
      const rows = (db.activities as Activity[]).filter((a) => visibleIds.has(a.companyId));
      const keyFn = groupBy === 'user' ? (a: Activity) => ownerName(a.userId ?? '') : groupBy === 'month' ? (a: Activity) => monthOf(a.occurredAt) : (a: Activity) => a.type;
      return group(rows, keyFn, 'count').sort((a, b) => groupBy === 'month' ? a.label.localeCompare(b.label) : b.value - a.value);
    }
    case 'health_trend': {
      const snaps = (db.healthSnapshots as HealthSnapshot[]).filter((s) => visibleIds.has(s.companyId));
      const map = new Map<string, number[]>();
      snaps.forEach((s) => { const m = s.snapshotDate.slice(0, 7); (map.get(m) ?? map.set(m, []).get(m)!).push(s.overall); });
      return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-12).map(([label, vs]) => ({ label, value: Math.round(vs.reduce((a, b) => a + b, 0) / vs.length) }));
    }
    case 'nps': {
      const rows = (db.npsResponses as NpsResponse[]).filter((n) => visibleIds.has(n.companyId));
      if (groupBy === 'month') {
        const map = new Map<string, number[]>();
        rows.forEach((n) => { const m = monthOf(n.respondedAt); (map.get(m) ?? map.set(m, []).get(m)!).push(n.score); });
        return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, vs]) => ({ label, value: Math.round(vs.reduce((a, b) => a + b, 0) / vs.length) }));
      }
      const bucket = (s: number) => (s >= 50 ? 'promoter' : s < 0 ? 'detractor' : 'passive');
      return group(rows.map((n) => ({ b: bucket(n.score) })), (r) => r.b, 'count');
    }
    case 'tasks': {
      const rows = (db.tasks as Task[]).filter((t) => visibleIds.has(t.companyId));
      const keyFn = groupBy === 'priority' ? (t: Task) => t.priority : groupBy === 'type' ? (t: Task) => t.taskType : groupBy === 'assignee' ? (t: Task) => ownerName(t.assigneeId ?? '') : (t: Task) => (t.completedAt ? 'completed' : 'open');
      return group(rows, keyFn, 'count');
    }
    default: return [];
  }
}

// Map a widget datapoint back to a Portfolio FilterSpec for drill-through (B1).
export function drillFilter(dataset: string, groupBy: string | null | undefined, label: string): FilterSpec {
  if (dataset === 'companies') {
    if (groupBy === 'healthBand') return { healthBand: label as FilterSpec['healthBand'] };
    if (groupBy === 'segment') return { segment: label === 'Mid-touch' ? 'mid_touch' : label.toLowerCase() };
    if (groupBy === 'phase') return { phase: label };
  }
  if (dataset === 'renewals' && groupBy === 'quarter') return { quarter: label };
  return {};
}
