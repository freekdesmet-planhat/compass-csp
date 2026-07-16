// Playbook catalogue — the automations that generate tasks/alerts across Compass.
// Shared by the read-only Playbooks page (inspectable by everyone) and the
// editable Admin → Playbooks tab, so both stay in sync from one source of truth.
import type { Segment } from './segments';

export interface PlaybookStep {
  title: string;
  /** Days after the trigger fires that this step's task is due. */
  dueInDays: number;
  priority: 'normal' | 'high';
}

export interface Playbook {
  id: string;
  name: string;
  /** Machine trigger key. */
  trigger: string;
  /** Human-readable trigger condition, e.g. "Renewal T-120" or "Health drop ≥10 WoW". */
  triggerLabel: string;
  description: string;
  segments: Segment[];
  enabled: boolean;
  steps: PlaybookStep[];
}

const S = (title: string, dueInDays: number, priority: 'normal' | 'high' = 'normal'): PlaybookStep => ({ title, dueInDays, priority });

export const PLAYBOOKS: Playbook[] = [
  {
    id: 'pb_onboarding_scaled', name: 'Onboarding (Scaled)', trigger: 'new_customer', triggerLabel: 'New customer onboarded',
    description: 'Automated first-90-days motion for scaled accounts.', segments: ['scaled'], enabled: true,
    steps: [S('Welcome email sequence', 0), S('Activation check @ day 14', 14), S('30-day value review', 30, 'high')],
  },
  {
    id: 'pb_renewal_120', name: 'Renewal 120-day motion (Mid/Ent)', trigger: 'renewal_t_minus', triggerLabel: 'Renewal T-120',
    description: 'Staged renewal motion for mid-touch and enterprise books.', segments: ['mid_touch', 'enterprise'], enabled: true,
    steps: [S('T-120 internal review', 0), S('T-90 exec check-in', 30, 'high'), S('T-60 proposal', 60, 'high'), S('T-30 close plan', 90, 'high')],
  },
  {
    id: 'pb_renewal_scaled', name: 'Scaled renewal automation', trigger: 'renewal_t_minus', triggerLabel: 'Renewal T-60',
    description: 'Low-touch renewal email sequence for scaled accounts.', segments: ['scaled'], enabled: true,
    steps: [S('T-60 renewal email 1', 0), S('T-45 reminder', 15), S('T-15 final notice', 45, 'high')],
  },
  {
    id: 'pb_risk_turnaround', name: 'Risk turnaround', trigger: 'health_drop', triggerLabel: 'Health drop ≥10 WoW',
    description: 'Fires when cached health falls 10+ points week-over-week.', segments: ['scaled', 'mid_touch', 'enterprise'], enabled: true,
    steps: [S('Root-cause call', 2, 'high'), S('Exec escalation', 5, 'high'), S('Path-to-green plan', 7, 'high')],
  },
  {
    id: 'pb_exec_cadence', name: 'Enterprise exec-sponsor cadence', trigger: 'manual', triggerLabel: 'Manual / quarterly cadence',
    description: 'Keeps a steady exec touch and QBR rhythm on enterprise accounts.', segments: ['enterprise'], enabled: false,
    steps: [S('Quarterly exec sync', 0), S('QBR prep', 80), S('QBR', 90, 'high')],
  },
];
