// Domain types — mirror the Postgres schema (Section 3). camelCase in the app,
// snake_case at the DB/edge boundary (mapped in the data layer).
import type { Segment, Role } from './segments';

export type { Segment, Role };
export type HealthBand = 'green' | 'amber' | 'red';
export type CompanyStatus = 'prospect' | 'customer' | 'churned';

export interface Profile {
  id: string;
  email: string;
  fullName: string;
  avatarUrl?: string | null;
  role: Role;
  segment: Segment | null;
  managerId?: string | null;
  timezone: string;
  digestHour: number;
  isActive: boolean;
}

export interface Company {
  id: string;
  name: string;
  domains: string[];
  website?: string | null;
  country?: string | null;
  city?: string | null;
  ownerId: string | null;
  collaboratorIds: string[];
  segment: Segment | null;
  phase?: string | null;
  status: CompanyStatus;
  tier?: string | null;
  region?: string | null;
  tags: string[];
  mrr?: number | null;
  arr?: number | null;
  renewalDate?: string | null;
  renewalArr?: number | null;
  hubspotCompanyId?: string | null;
  healthScore: number | null;
  healthBand: HealthBand | null;
  healthDeltaWow: number | null;
  healthUpdatedAt?: string | null;
  valueScore?: number | null;
  valueComment?: string | null;
  sentimentAssessment?: number | null;
  execRelationshipFlag: boolean;
  redFlags?: string | null;
  greenFlags?: string | null;
  nextStep?: string | null;
  pathToGreen?: string | null;
  handoverNotes?: string | null;
  aiAccountSummary?: string | null;
  aiRiskSummary?: string | null;
  aiRenewalSummary?: string | null;
  lastTouchAt?: string | null;
  lastTouchType?: string | null;
  nextTouchAt?: string | null;
  source?: string;
}

export type ContactRole =
  | 'exec_sponsor'
  | 'decision_maker'
  | 'main_user'
  | 'tech_ops'
  | 'end_user';

export interface Contact {
  id: string;
  companyId: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  otherEmails: string[];
  phone?: string | null;
  title?: string | null;
  department?: string | null;
  seniority?: string | null;
  linkedinUrl?: string | null;
  contactRole?: ContactRole | null;
  relationshipStrength?: number | null;
  isPrimary: boolean;
  isChampion: boolean;
  hasInfluence: boolean;
  isAdvocate: boolean;
  advocateType?: string | null;
  reportsToContactId?: string | null;
  npsLatest?: number | null;
  npsLatestAt?: string | null;
  sentiment30d?: string | null;
  engagementScore?: number | null;
  lastActiveAt?: string | null;
  lastTouchAt?: string | null;
  archived: boolean;
}

export type ActivityType =
  | 'email'
  | 'meeting'
  | 'call'
  | 'note'
  | 'nps'
  | 'task'
  | 'system'
  | 'ticket';

export interface Activity {
  id: string;
  companyId: string;
  contactIds: string[];
  userId?: string | null;
  type: ActivityType;
  direction?: 'inbound' | 'outbound' | null;
  title: string;
  snippet?: string | null;
  bodyRef?: string | null;
  occurredAt: string;
  meta: {
    fathomUrl?: string;
    actionItems?: string[];
    risks?: string[];
    asks?: string[];
    decisions?: string[];
    sentiment?: number;
    ambiguous?: boolean;
    transcriptUrl?: string;
    durationSec?: number;
    phone?: string;
    [k: string]: unknown;
  };
}

export interface Note {
  id: string;
  companyId: string;
  contactId?: string | null;
  authorId?: string | null;
  title?: string | null;
  content: unknown; // Tiptap JSON
  contentText: string;
  pinned: boolean;
  createdAt: string;
}

export type TaskPriority = 'low' | 'normal' | 'high';
export type TaskOrigin = 'manual' | 'playbook' | 'ai_call' | 'ai_recommendation' | 'alert';

export interface Task {
  id: string;
  companyId: string;
  assigneeId?: string | null;
  creatorId?: string | null;
  title: string;
  description?: string | null;
  dueDate?: string | null;
  completedAt?: string | null;
  priority: TaskPriority;
  origin: TaskOrigin;
  playbookRunStepId?: string | null;
  sourceActivityId?: string | null;
  successPlanObjectiveId?: string | null;
}

export type DealPipeline = 'renewal' | 'expansion' | 'new_business';
export type DealStatus = 'open' | 'won' | 'lost';

export interface Deal {
  id: string;
  companyId: string;
  hubspotDealId?: string | null;
  pipeline: DealPipeline;
  stage?: string | null;
  stageProbability?: number | null;
  forecastCategory?: string | null; // pipeline|best_case|commit|closed|omitted
  name: string;
  amount?: number | null;
  currency: string;
  closeDate?: string | null;
  ownerId?: string | null;
  status: DealStatus;
  nextSteps?: string | null;
  aiSummary?: string | null;
  confidence?: number | null;
  qualification: Record<string, unknown>;
  suggestedStage?: string | null;
  suggestedStageReason?: string | null;
  contactIds: string[];
  lastSyncedAt?: string | null;
}

export interface HealthDimension {
  score: number | null; // null = excluded (weight redistributed)
  inputs: Record<string, number | string | null>;
  contribution: number;
  weight: number;
}

export interface HealthSnapshot {
  id: string;
  companyId: string;
  snapshotDate: string;
  isWeekly: boolean;
  overall: number;
  band: HealthBand;
  deltaWow: number | null;
  dimensions: Record<string, HealthDimension>;
  explanation?: string | null;
  recommendations?: HealthRecommendation[] | null;
  source?: string;
}

export interface HealthRecommendation {
  title: string;
  why: string;
  suggestedTask: { title: string; dueInDays: number };
}

export interface HealthConfig {
  segment: Segment;
  weights: Record<string, number>;
  thresholds: { red: number; amber: number };
  inputConfig: Record<string, unknown>;
}

export type ObjectiveStatus =
  | 'not_started'
  | 'on_track'
  | 'at_risk'
  | 'achieved'
  | 'missed';

export interface SuccessPlan {
  id: string;
  companyId: string;
  name: string;
  ownerId?: string | null;
  status: string;
  targetDate?: string | null;
  progressPct: number;
}

export interface SuccessPlanObjective {
  id: string;
  planId: string;
  companyId: string;
  title: string;
  businessOutcome?: string | null;
  metric?: string | null;
  targetDate?: string | null;
  status: ObjectiveStatus;
  position: number;
  notes?: string | null;
}

export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertStatus = 'open' | 'acknowledged' | 'resolved' | 'snoozed';

export interface Alert {
  id: string;
  ruleId?: string | null;
  companyId: string;
  ownerId?: string | null;
  title: string;
  detail?: string | null;
  severity: AlertSeverity;
  status: AlertStatus;
  snoozedUntil?: string | null;
  dedupeKey?: string | null;
  createdAt: string;
}

export interface AlertRule {
  id: string;
  name: string;
  description?: string | null;
  ruleType: string;
  config: Record<string, unknown>;
  segment: Segment[];
  enabled: boolean;
  severity: AlertSeverity;
}

export interface NpsResponse {
  id: string;
  companyId: string;
  contactId?: string | null;
  score: number;
  comment?: string | null;
  respondedAt: string;
}

export interface CsatResponse {
  id: string;
  companyId: string;
  contactId?: string | null;
  score: number;
  comment?: string | null;
  respondedAt: string;
  context?: string | null;
}

export interface Ticket {
  id: string;
  companyId: string;
  externalRef?: string | null;
  priority: 'p1' | 'p2' | 'p3' | 'p4';
  status: string;
  openedAt?: string | null;
  resolvedAt?: string | null;
  subject?: string | null;
  source: string;
}

export interface UsageMetric {
  id: string;
  companyId: string;
  metricKey: string;
  metricDate: string;
  value: number;
}

export interface CalendarEvent {
  id: string;
  companyId?: string | null;
  gcalEventId?: string | null;
  title: string;
  startsAt: string;
  endsAt: string;
  attendeeEmails: string[];
  organizerEmail?: string | null;
  meetLink?: string | null;
  status?: string | null;
  matchedContactIds: string[];
  loggedActivityId?: string | null;
  fathomRecordingId?: string | null;
}

export interface MeetingPrep {
  id: string;
  companyId: string;
  calendarEventId: string;
  content: MeetingPrepContent;
  narrative?: string | null;
  generatedAt: string;
  stale: boolean;
}

export interface MeetingPrepContent {
  accountSnapshot: {
    arr?: number | null;
    phase?: string | null;
    renewalCountdown?: number | null;
    health?: number | null;
    healthDelta?: number | null;
    topDrag?: string | null;
  };
  openItems: string[];
  recentTouchpoints: string[];
  dealStatus?: string | null;
  attendees: {
    name: string;
    role?: string | null;
    relationshipStrength?: number | null;
    lastContact?: string | null;
    note?: string | null;
  }[];
  suggestedAgenda: string[];
}

export interface EmailMessage {
  id: string;
  companyId: string;
  contactIds: string[];
  gmailMessageId?: string | null;
  gmailThreadId?: string | null;
  direction?: 'inbound' | 'outbound' | null;
  fromEmail?: string | null;
  toEmails: string[];
  ccEmails: string[];
  subject?: string | null;
  snippet?: string | null;
  bodyHtml?: string | null;
  sentAt: string;
}

export type DigestType = 'daily' | 'weekly_exec';

export interface Digest {
  id: string;
  userId: string;
  digestType: DigestType;
  digestDate: string;
  content: DigestContent;
  narrative?: string | null;
}

export interface DigestContent {
  meetings: { time: string; company: string; companyId: string; health: number | null; calendarEventId?: string }[];
  tasksDue: { id: string; title: string; company: string; companyId: string; dueDate?: string | null; overdue: boolean }[];
  unprocessedActionItems: { title: string; company: string; companyId: string }[];
  alerts: { id: string; title: string; severity: AlertSeverity; companyId: string }[];
  healthMovers: { companyId: string; company: string; delta: number; score: number }[];
  renewalCheckpoints: { companyId: string; company: string; daysOut: number; arr: number | null }[];
  weekRecap?: {
    healthMovers: number;
    meetingsHeld: number;
    emailsExchanged: number;
    npsReceived: number;
    renewalStageChanges: number;
    tasksCompleted: number;
    tasksCreated: number;
  };
}

export interface IntegrationConnection {
  id: string;
  userId?: string | null;
  provider: 'google' | 'outreach' | 'hubspot' | 'fathom' | 'aircall' | 'planhat';
  status: 'active' | 'error' | 'disconnected';
  externalAccountEmail?: string | null;
  lastSyncAt?: string | null;
  scopes?: string[];
}

export interface OutreachState {
  contactId: string;
  sequenceName?: string | null;
  step?: number | null;
  state?: string | null;
  lastTouchAt?: string | null;
}
