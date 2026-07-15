import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ── Formatting helpers (tabular numerals used in the UI) ────────────────────
export function fmtCurrency(n: number | null | undefined, currency = 'USD'): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: n >= 10000 ? 0 : 2,
    notation: n >= 1_000_000 ? 'compact' : 'standard',
  }).format(n);
}

export function fmtNumber(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US').format(n);
}

export function fmtPct(n: number | null | undefined, digits = 0): string {
  if (n == null) return '—';
  return `${n.toFixed(digits)}%`;
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtDateShort(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function relativeTime(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  const diff = Date.now() - date.getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days < 0) return `in ${Math.abs(days)}d`;
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function daysUntil(d: string | Date | null | undefined): number | null {
  if (!d) return null;
  const date = typeof d === 'string' ? new Date(d) : d;
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('');
}

// ── Health band helpers ─────────────────────────────────────────────────────
export type HealthBand = 'green' | 'amber' | 'red';

export function healthBand(
  score: number | null | undefined,
  thresholds = { red: 40, amber: 70 }
): HealthBand | null {
  if (score == null) return null;
  if (score < thresholds.red) return 'red';
  if (score < thresholds.amber) return 'amber';
  return 'green';
}

export const HEALTH_COLORS: Record<HealthBand, { dot: string; text: string; tint: string }> = {
  green: { dot: 'var(--green)', text: 'var(--green)', tint: 'var(--green-tint)' },
  amber: { dot: 'var(--amber)', text: 'var(--amber)', tint: 'var(--amber-tint)' },
  red: { dot: 'var(--red)', text: 'var(--red)', tint: 'var(--red-tint)' },
};

// Health factor used in the renewal health-adjusted forecast line
export function healthFactor(band: HealthBand | null): number {
  if (band === 'green') return 1.0;
  if (band === 'amber') return 0.75;
  if (band === 'red') return 0.4;
  return 0.75;
}
