// Deterministic in-browser demo dataset (acceptance #14). Mirrors what
// scripts/seed-demo.ts writes to Postgres, scaled 10× down. Seeded PRNG →
// identical data every load so the app is stable and shareable.

import { computeHealth, type HealthInputs } from '../health';
import { DEFAULT_HEALTH_WEIGHTS, DEFAULT_HEALTH_THRESHOLDS, SEGMENT_PRESETS } from '../segments';
import type {
  Profile, Company, Contact, Activity, Deal, HealthSnapshot, Task, Alert, AlertRule,
  SuccessPlan, SuccessPlanObjective, NpsResponse, CsatResponse, Ticket, UsageMetric,
  CalendarEvent, MeetingPrep, Digest, EmailMessage, Segment, ContactRole, HealthRecommendation,
  Product, CompanyProduct, CompanyProductStatus, Notification, LibraryItem, Dashboard,
  DashboardWidget, AskThread, AskMessage, ChangelogEntry, ImportRun,
  PlaybookTemplate, PlaybookGroup, PlaybookStep, EmailTemplate, PlaybookType, PlaybookStepType,
} from '../types';

// ── seeded PRNG ──────────────────────────────────────────────────────────────
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(42);
const rand = () => rng();
const randInt = (lo: number, hi: number) => Math.floor(lo + rand() * (hi - lo + 1));
const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const chance = (p: number) => rand() < p;
const uid = (() => { let n = 1000; return (p: string) => `${p}_${(n++).toString(36)}`; })();

const DAY = 86_400_000;
const now = new Date('2026-07-16T08:00:00Z').getTime();
const daysAgo = (d: number) => new Date(now - d * DAY).toISOString();
const daysAhead = (d: number) => new Date(now + d * DAY).toISOString();
const dateOnly = (iso: string) => iso.slice(0, 10);

export interface DemoDataset {
  profiles: Profile[];
  companies: Company[];
  contacts: Contact[];
  activities: Activity[];
  deals: Deal[];
  healthSnapshots: HealthSnapshot[];
  tasks: Task[];
  alerts: Alert[];
  alertRules: AlertRule[];
  successPlans: SuccessPlan[];
  objectives: SuccessPlanObjective[];
  npsResponses: NpsResponse[];
  csatResponses: CsatResponse[];
  tickets: Ticket[];
  usageMetrics: UsageMetric[];
  calendarEvents: CalendarEvent[];
  meetingPreps: MeetingPrep[];
  digests: Digest[];
  emails: EmailMessage[];
  products: Product[];
  companyProducts: CompanyProduct[];
  notifications: Notification[];
  libraryItems: LibraryItem[];
  dashboards: Dashboard[];
  dashboardWidgets: DashboardWidget[];
  askThreads: AskThread[];
  askMessages: AskMessage[];
  changelog: ChangelogEntry[];
  importRuns: ImportRun[];
  playbookTemplates: PlaybookTemplate[];
  playbookGroups: PlaybookGroup[];
  playbookSteps: PlaybookStep[];
  emailTemplates: EmailTemplate[];
}

const FIRST = ['Sarah', 'James', 'Maria', 'David', 'Lena', 'Tom', 'Priya', 'Marcus', 'Elena', 'Yuki', 'Omar', 'Anna', 'Kevin', 'Sofia', 'Liam', 'Noah', 'Emma', 'Ava', 'Raj', 'Chloe'];
const LAST = ['Chen', 'Okonkwo', 'Rossi', 'Park', 'Meyer', 'Novak', 'Sharma', 'Andersson', 'Costa', 'Tanaka', 'Haddad', 'Kowalski', 'Nguyen', 'Silva', 'Murphy', 'Weber', 'Larsen', 'Ivanova', 'Patel', 'Dubois'];
const COMPANY_WORDS = ['Nimbus', 'Vertex', 'Quanta', 'Helios', 'Orbit', 'Cobalt', 'Lumen', 'Atlas', 'Pulse', 'Forge', 'Cedar', 'Vantage', 'Meridian', 'Beacon', 'Arbor', 'Summit', 'Delta', 'Ember', 'Halcyon', 'Kestrel', 'Onyx', 'Tessera', 'Verdant', 'Zephyr', 'Aurora', 'Basalt', 'Cirrus', 'Drift', 'Enso', 'Fathom'];
const COMPANY_SUFFIX = ['Labs', 'Systems', 'Health', 'Retail', 'Cloud', 'Digital', 'Analytics', 'Group', 'Software', 'Networks', 'Bank', 'Media', 'Logistics', 'Robotics', 'AI'];
const PHASES = ['onboarding', 'adoption', 'value_realization', 'renewal', 'expansion'];
const COUNTRIES = [['United States', 'San Francisco', 'AMER'], ['United Kingdom', 'London', 'EMEA'], ['Germany', 'Berlin', 'EMEA'], ['France', 'Paris', 'EMEA'], ['Netherlands', 'Amsterdam', 'EMEA'], ['Australia', 'Sydney', 'APAC'], ['Singapore', 'Singapore', 'APAC'], ['Canada', 'Toronto', 'AMER']];
const CONTACT_ROLES: ContactRole[] = ['exec_sponsor', 'decision_maker', 'main_user', 'tech_ops', 'end_user'];
const RENEWAL_STAGES = ['T-120 Review', 'Exec Check-in', 'Proposal Sent', 'Negotiation', 'Verbal Commit', 'Closed Won'];

// Stage-appropriate next steps so kanban cards don't all read identically.
const NEXT_STEPS_BY_STAGE: Record<string, string> = {
  'T-120 Review': '• Schedule the T-120 renewal review\n• Pull usage + value data for the deck',
  'Exec Check-in': '• Align exec sponsor on FY26 priorities\n• Confirm the renewal timeline',
  'Proposal Sent': '• Chase signature on the commercial proposal\n• Answer procurement questions',
  'Negotiation': '• Work through pricing redlines\n• Loop in deal desk on multi-year terms',
  'Verbal Commit': '• Get the paperwork countersigned\n• Confirm PO and billing details',
  'Closed Won': '• Schedule the renewal kickoff\n• Hand off new modules to onboarding',
};

// NPS verbatims that actually match the score band (Nps.tsx buckets: promoter ≥ 50,
// detractor < 0, passive in between) — so a promoter never reads like a detractor.
const NPS_VERBATIMS: Record<'promoter' | 'passive' | 'detractor', string[]> = {
  promoter: [
    'Great support, product keeps improving.',
    'The team is responsive and the roadmap keeps delivering.',
    'Rolled it out org-wide — clear ROI and happy users.',
    'Best vendor relationship we have; would recommend without hesitation.',
    'Onboarding was smooth and adoption stuck.',
  ],
  passive: [
    'Works well overall, a few workflows still feel clunky.',
    'Solid product, but onboarding was rougher than expected.',
    'Does the job; would love faster support responses.',
    'Good value, though reporting could be more flexible.',
    'Happy enough, waiting to see the next few releases land.',
  ],
  detractor: [
    'Missing features we were promised during the sale.',
    'Too many bugs lately and support has been slow.',
    'Hard to justify the renewal at the current price.',
    'Integrations keep breaking and it is costing us time.',
    'Adoption stalled — the team finds it hard to use.',
  ],
};
function npsComment(score: number): string {
  const band = score >= 50 ? 'promoter' : score < 0 ? 'detractor' : 'passive';
  return pick(NPS_VERBATIMS[band]);
}

const RECS_POOL: HealthRecommendation[] = [
  { title: 'Resolve the two open P1 tickets', why: 'Support dragged the score −18; both P1s have been open 11+ days.', suggestedTask: { title: 'Escalate open P1s with support lead', dueInDays: 2 } },
  { title: 'Re-engage the executive sponsor', why: 'No exec touch in 47 days; relationship strength slipped to 5/10.', suggestedTask: { title: 'Schedule exec sponsor check-in', dueInDays: 5 } },
  { title: 'Drive feature adoption workshop', why: 'Usage utilisation is 41% of seats; adoption breadth flat for 4 weeks.', suggestedTask: { title: 'Run adoption workshop for main users', dueInDays: 10 } },
  { title: 'Collect a fresh NPS pulse', why: 'Last NPS is 94 days old; sentiment blend relying on stale data.', suggestedTask: { title: 'Send NPS pulse to key stakeholders', dueInDays: 7 } },
  { title: 'Widen stakeholder coverage', why: 'Only 2 of 6 expected contacts active in 90d; single-threaded risk.', suggestedTask: { title: 'Map and reach 2 new stakeholders', dueInDays: 14 } },
  { title: 'Confirm renewal path early', why: 'Renewal is 78 days out and health is amber; secure the internal review.', suggestedTask: { title: 'Kick off T-90 renewal review', dueInDays: 3 } },
];

function companyName(): string {
  return `${pick(COMPANY_WORDS)} ${pick(COMPANY_SUFFIX)}`;
}

export function generateDemoData(): DemoDataset {
  const ds: DemoDataset = {
    profiles: [], companies: [], contacts: [], activities: [], deals: [], healthSnapshots: [],
    tasks: [], alerts: [], alertRules: [], successPlans: [], objectives: [], npsResponses: [],
    csatResponses: [], tickets: [], usageMetrics: [], calendarEvents: [], meetingPreps: [],
    digests: [], emails: [],
    products: [], companyProducts: [], notifications: [], libraryItems: [], dashboards: [],
    dashboardWidgets: [], askThreads: [], askMessages: [], changelog: [], importRuns: [],
    playbookTemplates: [], playbookGroups: [], playbookSteps: [], emailTemplates: [],
  };
  seedPlaybooks(ds);

  // ── Profiles: Freek (admin), Bey (manager), 10 CSMs across the 3 segments ──
  // Mirrors the real internal roster seeded in Supabase so demo + live match.
  const admin: Profile = { id: 'u_admin', email: 'freek.desmet@planhat.com', fullName: 'Freek Desmet', role: 'admin', segment: null, timezone: 'Europe/Amsterdam', digestHour: 7, isActive: true };
  const manager: Profile = { id: 'u_mgr', email: 'beyonce@planhat.com', fullName: 'Bey', role: 'manager', segment: null, timezone: 'Europe/Amsterdam', digestHour: 8, isActive: true };

  // Each CSM owns a book; per-segment counts still total scaled 150 / mid 70 / ent 12.
  const CSM_SEED: { id: string; email: string; fullName: string; segment: Segment; count: number; tz: string }[] = [
    { id: 'u_aretha',  email: 'aretha@planhat.com',       fullName: 'Aretha',   segment: 'scaled',     count: 38, tz: 'Europe/Amsterdam' },
    { id: 'u_axl',     email: 'axl@planhat.com',          fullName: 'Axl',      segment: 'scaled',     count: 38, tz: 'Europe/London' },
    { id: 'u_bill',    email: 'bill@planhat.com',         fullName: 'Bill',     segment: 'scaled',     count: 37, tz: 'America/New_York' },
    { id: 'u_bob',     email: 'bob@planhat.com',          fullName: 'Bob',      segment: 'scaled',     count: 37, tz: 'Europe/Amsterdam' },
    { id: 'u_ella',    email: 'ella@planhat.com',         fullName: 'Ella',     segment: 'mid_touch',  count: 24, tz: 'Europe/London' },
    { id: 'u_elvis',   email: 'elvis@planhat.com',        fullName: 'The King', segment: 'mid_touch',  count: 23, tz: 'America/New_York' },
    { id: 'u_freddie', email: 'freddie@planhat.com',      fullName: 'Freddie',  segment: 'mid_touch',  count: 23, tz: 'Europe/London' },
    { id: 'u_irma',    email: 'irma.sjogren@planhat.com', fullName: 'Irma',     segment: 'enterprise', count: 4,  tz: 'Europe/Amsterdam' },
    { id: 'u_mick',    email: 'mick@planhat.com',         fullName: 'Mick',     segment: 'enterprise', count: 4,  tz: 'Europe/London' },
    { id: 'u_taylor',  email: 'taylor@planhat.com',       fullName: 'Taylor',   segment: 'enterprise', count: 4,  tz: 'America/New_York' },
  ];
  const csms: Profile[] = CSM_SEED.map((c) => ({
    id: c.id, email: c.email, fullName: c.fullName, role: 'csm', segment: c.segment,
    managerId: manager.id, timezone: c.tz, digestHour: 7, isActive: true,
  }));
  ds.profiles.push(admin, manager, ...csms);

  // ── products catalogue (C5) ────────────────────────────────────────────────
  ds.products = PRODUCTS.map((p, i) => ({ id: `prod_${i + 1}`, name: p.name, category: p.category, position: i + 1 }));

  // Full-size books (D8): scaled 150, mid-touch 70, enterprise 12 — exercises
  // pagination + performance honestly (no 10× scale-down), now split per CSM.
  const books: { csm: Profile; segment: Segment; count: number }[] = CSM_SEED.map((c, i) => ({
    csm: csms[i], segment: c.segment, count: c.count,
  }));

  for (const book of books) {
    const preset = SEGMENT_PRESETS[book.segment];
    for (let c = 0; c < book.count; c++) {
      buildCompany(ds, book.csm, book.segment, preset, manager);
    }
  }

  ensureRenewalStageCoverage(ds);
  ds.alertRules = seedAlertRules();
  buildDigests(ds);
  buildLibrary(ds);
  buildDashboards(ds, csms, manager);
  buildAskCompass(ds, csms.find((c) => c.segment === 'enterprise') ?? csms[0]);
  buildNotifications(ds, csms, manager);
  ds.changelog = CHANGELOG_SEED;
  return ds;
}

// Products catalogue (C5) + whitespace status distribution.
const PRODUCTS: { name: string; category: string }[] = [
  { name: 'Core Licence', category: 'license' },
  { name: 'SEO Intelligence', category: 'product' },
  { name: 'Traffic Monitor', category: 'product' },
  { name: 'Conversion Optimiser', category: 'product' },
  { name: 'Consulting Services', category: 'services' },
  { name: 'SEO Consulting', category: 'services' },
];

function buildCompany(
  ds: DemoDataset,
  owner: Profile,
  segment: Segment,
  preset: (typeof SEGMENT_PRESETS)[Segment],
  manager: Profile
) {
  const companyId = uid('co');
  const [country, city, region] = pick(COUNTRIES);
  const name = companyName();
  const domain = `${name.split(' ')[0].toLowerCase()}.com`;
  const arr = segment === 'enterprise' ? randInt(180, 900) * 1000 : segment === 'mid_touch' ? randInt(45, 180) * 1000 : randInt(8, 45) * 1000;
  const mrr = Math.round(arr / 12);
  const phase = pick(PHASES);
  const status = chance(0.05) ? 'churned' : 'customer';

  const nContacts = segment === 'enterprise' ? randInt(10, 14) : segment === 'mid_touch' ? randInt(4, 6) : randInt(1, 2);
  const contacts: Contact[] = [];
  for (let i = 0; i < nContacts; i++) {
    const first = pick(FIRST); const last = pick(LAST);
    const role: ContactRole = i === 0 ? 'exec_sponsor' : i === 1 ? 'decision_maker' : i === 2 ? 'main_user' : pick(CONTACT_ROLES);
    const contact: Contact = {
      id: uid('ct'), companyId, firstName: first, lastName: last,
      email: `${first.toLowerCase()}.${last.toLowerCase()}@${domain}`, otherEmails: [],
      phone: `+1${randInt(2000000000, 9999999999)}`, title: pick(['VP Operations', 'Head of Data', 'Director of CS', 'CTO', 'Product Lead', 'Ops Manager', 'Analyst']),
      department: pick(['Operations', 'Engineering', 'Product', 'Data', 'Success']), seniority: pick(['C-Level', 'VP', 'Director', 'Manager', 'IC']),
      linkedinUrl: null, contactRole: role, relationshipStrength: randInt(4, 9),
      isPrimary: i === 0, isChampion: chance(0.3), hasInfluence: role === 'exec_sponsor' || role === 'decision_maker', isAdvocate: chance(0.25),
      advocateType: chance(0.25) ? pick(['reference', 'case_study', 'referral']) : null,
      reportsToContactId: i > 0 && chance(0.5) ? contacts[0]?.id : null,
      // Single roll so npsLatest and npsLatestAt stay consistent (a score always
      // carries a date — otherwise an NPS response gets a null respondedAt).
      ...(chance(0.6) ? { npsLatest: randInt(-20, 100), npsLatestAt: daysAgo(randInt(10, 120)) } : { npsLatest: null, npsLatestAt: null }),
      sentiment30d: pick(['positive', 'neutral', 'negative', 'positive', 'neutral']),
      engagementScore: randInt(20, 95), lastActiveAt: daysAgo(randInt(0, 40)), lastTouchAt: daysAgo(randInt(0, 60)), archived: false,
    };
    contacts.push(contact);
    ds.contacts.push(contact);
  }

  // ── health inputs ─────────────────────────────────────────────────────────
  const openP1 = chance(0.15) ? randInt(1, 2) : 0;
  const openP2 = chance(0.3) ? randInt(1, 3) : 0;
  const valueScore = segment === 'scaled' ? (chance(0.4) ? randInt(4, 9) : null) : randInt(4, 9);
  const sentimentAssessment = chance(0.8) ? randInt(4, 9) : null;
  const execFlag = chance(0.4);
  const seats = randInt(20, 400);
  const wau = Math.round(seats * (0.3 + rand() * 0.65));
  const trendSlope = -1 + rand() * 2;
  const hasTicketData = chance(0.7);

  const inputs: HealthInputs = {
    valueScore, valueComment: valueScore ? pick(['Strong exec alignment, clear ROI story', 'Value narrative still forming', 'Renewal case is solid', 'Needs a business review to reset value']) : null,
    inboundEmailRecencyDays: randInt(0, 25), emailReplyRate30d: rand(),
    meetingsLast90d: randInt(0, Math.max(preset.meetingNormPerQuarter + 2, 2)), meetingNormPerQuarter: preset.meetingNormPerQuarter,
    distinctActiveContacts90d: randInt(1, nContacts), expectedActiveContacts: preset.expectedActiveContacts,
    openP1, openP2, avgResolutionDays90d: hasTicketData ? randInt(2, 14) : null, incidentCount90d: randInt(0, 3), hasTicketData,
    sentimentAssessment, companyNps: chance(0.6) ? randInt(-30, 100) : null,
    execContactRelationshipAvg: contacts.filter((c) => c.contactRole === 'exec_sponsor' || c.contactRole === 'decision_maker').reduce((a, c, _, arr2) => a + (c.relationshipStrength ?? 5) / arr2.length, 0) || null,
    callSentimentRolling: chance(0.5) ? -1 + rand() * 2 : null, execRelationshipFlag: execFlag,
    wau, seats, adoptionBreadth: rand(), usageTrendSlope: trendSlope,
  };

  const weights = DEFAULT_HEALTH_WEIGHTS[segment];
  const result = computeHealth(inputs, weights, DEFAULT_HEALTH_THRESHOLDS);
  const deltaWow = Math.round((-15 + rand() * 30) * 10) / 10;

  const renewalDays = randInt(-30, 300);
  const company: Company = {
    id: companyId, name, domains: [domain], website: `https://${domain}`, country, city,
    ownerId: owner.id, collaboratorIds: chance(0.2) ? [manager.id] : [], segment, phase, status,
    tier: segment === 'enterprise' ? 'Enterprise' : segment === 'mid_touch' ? 'Mid-Market' : 'SMB',
    region, tags: chance(0.5) ? [pick(['strategic', 'at-risk', 'expansion', 'reference'])] : [],
    mrr, arr, renewalDate: dateOnly(daysAhead(renewalDays)), renewalArr: arr,
    hubspotCompanyId: `hs_${companyId}`,
    healthScore: result.overall, healthBand: result.band, healthDeltaWow: deltaWow, healthUpdatedAt: daysAgo(0),
    valueScore, valueComment: inputs.valueComment, sentimentAssessment, execRelationshipFlag: execFlag,
    redFlags: chance(0.4) ? pick(['Champion left the company', 'Budget freeze signalled in Q3', 'Competitor eval underway', 'Low usage among power users']) : null,
    greenFlags: chance(0.5) ? pick(['Exec sponsor highly engaged', 'Expansion interest in analytics module', 'Strong NPS from main users', 'On track for value milestones']) : null,
    nextStep: pick(['Schedule QBR', 'Send renewal proposal', 'Follow up on adoption plan', 'Confirm exec attendance']),
    pathToGreen: result.band !== 'green' ? pick(['Close P1s + re-run business review', 'Re-establish exec sponsor cadence', 'Adoption push on core workflows']) : null,
    handoverNotes: chance(0.3) ? 'Migrated from sales; original champion was the VP Ops.' : null,
    aiAccountSummary: `${name} is a ${segment} account in ${phase}. ARR $${(arr / 1000).toFixed(0)}k, health ${result.overall} (${result.band}).`,
    aiRiskSummary: result.band === 'red' ? 'Elevated churn risk driven by support and engagement gaps.' : result.band === 'amber' ? 'Watch: mixed signals across engagement and usage.' : 'Low risk; steady engagement and healthy usage.',
    aiRenewalSummary: `Renewal ${renewalDays < 0 ? 'overdue' : `in ${renewalDays}d`}; ARR $${(arr / 1000).toFixed(0)}k.`,
    lastTouchAt: daysAgo(randInt(0, 70)), lastTouchType: pick(['email', 'meeting', 'call', 'note']), nextTouchAt: chance(0.6) ? daysAhead(randInt(1, 30)) : null,
    latestNews: segment === 'enterprise' || chance(0.25)
      ? `• ${name} announced a new ${pick(['funding round', 'product launch', 'executive hire', 'partnership', 'market expansion'])} — ${pick(['signals growth budget', 'aligns with our roadmap', 'expands their footprint'])}.\n• Reported ${pick(['strong quarterly results', 'a reorganisation', 'hiring across ops'])}.\n• Press coverage on their ${pick(['SEO strategy', 'analytics investment', 'digital transformation'])}.`
      : null,
    latestNewsAt: segment === 'enterprise' || chance(0.25) ? daysAgo(randInt(1, 20)) : null,
    latestNewsSources: segment === 'enterprise' ? [{ title: 'TechCrunch', url: 'https://techcrunch.com/' }, { title: 'Company blog', url: `https://${domain}/blog` }] : null,
    source: 'planhat',
  };
  ds.companies.push(company);

  // ── products & whitespace (C5) ─────────────────────────────────────────────
  const statusPool: CompanyProductStatus[] = ['current', 'current', 'active_opp', 'need_to_discuss', 'rejected', 'none', 'none'];
  ds.products.forEach((p, pi) => {
    // Core Licence is always current for customers; others vary → real whitespace.
    let cpStatus: CompanyProductStatus;
    if (pi === 0) cpStatus = status !== 'churned' ? 'current' : 'rejected';
    else cpStatus = segment === 'enterprise' ? pick(statusPool) : pick(['current', 'none', 'none', 'active_opp', 'need_to_discuss']);
    ds.companyProducts.push({
      id: uid('cp'), companyId, productId: p.id, status: cpStatus,
      arr: cpStatus === 'current' ? Math.round(arr * (0.1 + rand() * 0.3)) : cpStatus === 'active_opp' ? Math.round(arr * (0.15 + rand() * 0.25)) : null,
      note: null, updatedBy: owner.id,
    });
  });

  // ── usage metrics (weekly WAU + seats + adoption over 16 weeks) ────────────
  for (let w = 15; w >= 0; w--) {
    const d = dateOnly(daysAgo(w * 7));
    ds.usageMetrics.push({ id: uid('um'), companyId, metricKey: 'weekly_active_users', metricDate: d, value: Math.round(wau * (0.8 + rand() * 0.4)) });
    ds.usageMetrics.push({ id: uid('um'), companyId, metricKey: 'licensed_seats', metricDate: d, value: seats });
    ds.usageMetrics.push({ id: uid('um'), companyId, metricKey: 'feature_x_users', metricDate: d, value: Math.round(wau * (0.2 + rand() * 0.5)) });
  }

  // ── health snapshots: 12 monthly history + current weekly ──────────────────
  let prev = result.overall;
  for (let m = 12; m >= 1; m--) {
    prev = Math.max(10, Math.min(98, prev + Math.round(-8 + rand() * 16)));
    const band = prev < 40 ? 'red' : prev < 70 ? 'amber' : 'green';
    ds.healthSnapshots.push({
      id: uid('hs'), companyId, snapshotDate: dateOnly(daysAgo(m * 30)), isWeekly: true,
      overall: prev, band, deltaWow: null, dimensions: {}, source: 'planhat',
    });
  }
  ds.healthSnapshots.push({
    id: uid('hs'), companyId, snapshotDate: dateOnly(daysAgo(0)), isWeekly: true,
    overall: result.overall, band: result.band, deltaWow,
    dimensions: result.dimensions,
    explanation: buildExplanation(name, result),
    recommendations: pickRecs(result),
    source: 'app',
  });

  // ── tickets ────────────────────────────────────────────────────────────────
  for (let i = 0; i < openP1; i++) ds.tickets.push({ id: uid('tk'), companyId, externalRef: `INC-${randInt(1000, 9999)}`, priority: 'p1', status: 'open', openedAt: daysAgo(randInt(5, 15)), resolvedAt: null, subject: 'Critical: data sync failing', source: 'planhat' });
  for (let i = 0; i < openP2; i++) ds.tickets.push({ id: uid('tk'), companyId, externalRef: `INC-${randInt(1000, 9999)}`, priority: 'p2', status: 'open', openedAt: daysAgo(randInt(2, 20)), resolvedAt: null, subject: 'Report export intermittently slow', source: 'planhat' });

  // ── NPS responses ────────────────────────────────────────────────────────────
  contacts.filter((c) => c.npsLatest != null).forEach((c) => {
    ds.npsResponses.push({ id: uid('nps'), companyId, contactId: c.id, score: c.npsLatest!, comment: npsComment(c.npsLatest!), respondedAt: c.npsLatestAt! });
  });
  if (chance(0.5)) ds.csatResponses.push({ id: uid('csat'), companyId, contactId: contacts[0]?.id, score: randInt(3, 5), comment: 'Support was responsive.', respondedAt: daysAgo(randInt(5, 60)), context: 'ticket_resolution' });

  // ── deals: renewal + maybe expansion ──────────────────────────────────────
  if (status !== 'churned') {
    const stageIdx = renewalDays < 30 ? randInt(3, 5) : renewalDays < 90 ? randInt(1, 3) : randInt(0, 2);
    const renewalDeal: Deal = {
      id: uid('dl'), companyId, hubspotDealId: `hsdeal_${companyId}_r`, pipeline: 'renewal',
      stage: RENEWAL_STAGES[stageIdx], stageProbability: [0.2, 0.4, 0.6, 0.75, 0.9, 1.0][stageIdx],
      forecastCategory: stageIdx >= 4 ? 'commit' : stageIdx >= 2 ? 'best_case' : 'pipeline',
      name: `${name} — Renewal FY26`, amount: arr, currency: 'USD', closeDate: company.renewalDate,
      ownerId: owner.id, status: stageIdx === 5 ? 'won' : 'open',
      nextSteps: '• Confirm exec attendance for review\n• Align on FY26 success metrics\n• Send commercial proposal',
      aiSummary: 'Renewal progressing; commercial terms agreed in principle, awaiting exec sign-off.',
      confidence: Math.round(([0.2, 0.4, 0.6, 0.75, 0.9, 1.0][stageIdx]) * 100),
      qualification: { Champion: true, EconomicBuyer: chance(0.6), DecisionCriteria: chance(0.7), IdentifyPain: true, Budget: chance(0.6), Timeline: true },
      suggestedStage: chance(0.25) ? RENEWAL_STAGES[Math.min(stageIdx + 1, 5)] : null,
      suggestedStageReason: chance(0.25) ? 'Last call: customer confirmed budget approved and asked for paperwork.' : null,
      contactIds: contacts.slice(0, 2).map((c) => c.id), lastSyncedAt: daysAgo(0),
    };
    renewalDeal.nextSteps = NEXT_STEPS_BY_STAGE[RENEWAL_STAGES[stageIdx]] ?? renewalDeal.nextSteps;
    ds.deals.push(renewalDeal);
    if (segment !== 'scaled' && chance(0.4)) {
      ds.deals.push({
        id: uid('dl'), companyId, hubspotDealId: `hsdeal_${companyId}_e`, pipeline: 'expansion',
        stage: pick(['Discovery', 'Proposal', 'Negotiation']), stageProbability: 0.4 + rand() * 0.4, forecastCategory: 'best_case',
        name: `${name} — Analytics expansion`, amount: Math.round(arr * (0.2 + rand() * 0.4)), currency: 'USD',
        closeDate: dateOnly(daysAhead(randInt(30, 120))), ownerId: owner.id, status: 'open',
        nextSteps: '• Scope analytics seats\n• Build ROI model', aiSummary: 'Expansion interest confirmed by champion; sizing in progress.',
        confidence: randInt(40, 75), qualification: { Champion: true, IdentifyPain: true }, suggestedStage: null, suggestedStageReason: null,
        contactIds: contacts.slice(0, 1).map((c) => c.id), lastSyncedAt: daysAgo(0),
      });
    }
  } else {
    ds.activities.push({ id: uid('ac'), companyId, contactIds: [], userId: null, type: 'system', title: 'Account churned', snippet: 'Churn reason: consolidated onto competitor platform.', occurredAt: daysAgo(randInt(10, 90)), meta: {} });
  }

  // ── success plan (enterprise + some mid_touch) ─────────────────────────────
  if (segment === 'enterprise' || (segment === 'mid_touch' && chance(0.5))) {
    const planId = uid('sp');
    const objTitles = ['Achieve 80% seat activation', 'Launch executive dashboard', 'Reduce manual reporting by 50%', 'Establish quarterly business reviews'];
    const objs: SuccessPlanObjective[] = objTitles.slice(0, segment === 'enterprise' ? 4 : 2).map((title, i) => ({
      id: uid('ob'), planId, companyId, title, businessOutcome: pick(['Faster time-to-value', 'Operational efficiency', 'Exec visibility', 'Cost reduction']),
      metric: pick(['Seat activation %', 'Reports automated', 'Hours saved/week', 'NPS']), targetDate: dateOnly(daysAhead(randInt(30, 180))),
      status: pick(['not_started', 'on_track', 'on_track', 'at_risk', 'achieved']), position: i, notes: null,
    }));
    ds.objectives.push(...objs);
    const achieved = objs.filter((o) => o.status === 'achieved').length;
    const onTrack = objs.filter((o) => o.status === 'on_track').length;
    ds.successPlans.push({ id: planId, companyId, name: 'Success Plan FY26', ownerId: owner.id, status: 'active', targetDate: dateOnly(daysAhead(180)), progressPct: Math.round(((achieved + onTrack * 0.5) / objs.length) * 100) });
  }

  // ── activities timeline (emails, meetings, calls, notes) ───────────────────
  const nActivities = segment === 'enterprise' ? randInt(30, 45) : segment === 'mid_touch' ? randInt(18, 30) : randInt(6, 14);
  for (let i = 0; i < nActivities; i++) {
    const type = pick<Activity['type']>(['email', 'email', 'meeting', 'call', 'note', 'email']);
    const occurredAt = daysAgo(randInt(0, 180));
    const contact = pick(contacts);
    const base: Activity = {
      id: uid('ac'), companyId, contactIds: contact ? [contact.id] : [], userId: owner.id, type,
      direction: type === 'email' ? pick(['inbound', 'outbound']) : null,
      title: '', snippet: '', occurredAt, meta: {},
    };
    if (type === 'email') {
      base.title = pick(['Re: Renewal timeline', 'Q3 business review follow-up', 'Adoption metrics recap', 'Support escalation update', 'Intro to new team members']);
      base.snippet = 'Thanks for the update — looping in our ops lead to align on next steps before the review.';
      ds.emails.push({ id: uid('em'), companyId, contactIds: contact ? [contact.id] : [], gmailMessageId: `gm_${base.id}`, gmailThreadId: `gt_${randInt(1, 50)}`, direction: base.direction, fromEmail: base.direction === 'inbound' ? contact?.email ?? null : owner.email, toEmails: [base.direction === 'inbound' ? owner.email : contact?.email ?? ''], ccEmails: [], subject: base.title, snippet: base.snippet, bodyHtml: `<p>${base.snippet}</p><p>Best,<br/>${contact?.firstName ?? 'Team'}</p>`, sentAt: occurredAt });
    } else if (type === 'meeting') {
      base.title = pick(['Quarterly Business Review', 'Adoption sync', 'Renewal planning call', 'Exec alignment']);
      base.snippet = 'Reviewed adoption progress and agreed on the renewal timeline.';
      base.meta = { fathomUrl: 'https://fathom.video/calls/' + randInt(10000, 99999), actionItems: ['Send updated ROI model', 'Confirm exec attendance', 'Share adoption dashboard'], risks: chance(0.4) ? ['Budget approval delayed to next quarter'] : [], asks: chance(0.4) ? ['Wants SSO before renewal'] : [], sentiment: -0.3 + rand() * 1.3 };
    } else if (type === 'call') {
      base.title = 'Aircall — outbound check-in';
      base.snippet = 'Quick check-in on the open support ticket; customer satisfied with progress.';
      base.meta = { transcriptUrl: 'https://aircall.io/calls/' + randInt(10000, 99999), durationSec: randInt(180, 1800), phone: contact?.phone ?? undefined, actionItems: ['Follow up on ticket resolution'], sentiment: 0.2 + rand() * 0.6 };
    } else {
      base.title = pick(['Internal note', 'Call prep', 'Renewal strategy']);
      base.snippet = 'CSM note: champion is supportive but we need a second stakeholder before renewal.';
    }
    ds.activities.push(base);
  }
  // sync last touch NPS activity
  ds.npsResponses.filter((n) => n.companyId === companyId).forEach((n) => {
    ds.activities.push({ id: uid('ac'), companyId, contactIds: n.contactId ? [n.contactId] : [], userId: null, type: 'nps', title: `NPS ${n.score}`, snippet: n.comment ?? '', occurredAt: n.respondedAt, meta: { sentiment: (n.score) / 100 } });
  });

  // ── tasks ──────────────────────────────────────────────────────────────────
  const nTasks = randInt(2, 6);
  for (let i = 0; i < nTasks; i++) {
    const completed = chance(0.4);
    ds.tasks.push({
      id: uid('ts'), companyId, assigneeId: owner.id, creatorId: owner.id,
      title: pick(['Prep QBR deck', 'Send renewal proposal', 'Follow up on P1 ticket', 'Schedule exec sync', 'Update success plan', 'Review adoption metrics']),
      description: null, taskType: pick(['todo', 'todo', 'email', 'call', 'check_in', 'meeting']),
      dueDate: dateOnly(chance(0.5) ? daysAgo(randInt(0, 10)) : daysAhead(randInt(1, 21))),
      completedAt: completed ? daysAgo(randInt(0, 20)) : null, priority: pick(['low', 'normal', 'normal', 'high']),
      origin: pick(['manual', 'manual', 'playbook', 'ai_call', 'ai_recommendation', 'alert']), sourceActivityId: null, contactId: null,
    });
  }

  // ── calendar events (upcoming) + meeting prep ──────────────────────────────
  if (segment !== 'scaled' && chance(0.7)) {
    // Spread meeting start times across the working day (≈09:00–16:30) instead of
    // all landing at the seed's 09:00Z — otherwise every card reads "11:00 AM".
    const startDate = new Date(now + randInt(0, 6) * DAY);
    startDate.setUTCHours(randInt(9, 16), pick([0, 0, 15, 30, 45]), 0, 0);
    const startsAt = startDate.toISOString();
    const evId = uid('cal');
    const attendees = contacts.slice(0, 2);
    ds.calendarEvents.push({
      id: evId, companyId, gcalEventId: `gcal_${evId}`, title: `${name} — ${pick(['QBR', 'Renewal sync', 'Check-in'])}`,
      startsAt, endsAt: new Date(startDate.getTime() + 30 * 60000).toISOString(),
      attendeeEmails: [owner.email, ...attendees.map((a) => a.email!)], organizerEmail: owner.email,
      meetLink: 'https://meet.google.com/abc-defg-hij', status: 'confirmed', matchedContactIds: attendees.map((a) => a.id), loggedActivityId: null, fathomRecordingId: null,
    });
    ds.meetingPreps.push({
      id: uid('mp'), companyId, calendarEventId: evId,
      content: {
        accountSnapshot: { arr, phase, renewalCountdown: renewalDays, health: result.overall, healthDelta: deltaWow, topDrag: topDrag(result) },
        openItems: ['2 overdue tasks', 'Unresolved ask: SSO before renewal'],
        recentTouchpoints: ['QBR held 12d ago — positive', 'Support ticket resolved 5d ago', 'Exec email exchange 3d ago'],
        dealStatus: 'Renewal — Proposal Sent, 75% confidence. Next: confirm exec attendance.',
        attendees: attendees.map((a) => ({ name: `${a.firstName} ${a.lastName}`, role: a.contactRole, relationshipStrength: a.relationshipStrength, lastContact: a.lastTouchAt, note: a.isChampion ? 'Internal champion — advocate for expansion.' : null })),
        suggestedAgenda: ['Recap adoption progress vs success plan', 'Confirm FY26 renewal timeline', 'Address open SSO request', 'Explore analytics expansion', 'Agree next steps + owners'],
      },
      narrative: `${name} renews in ${renewalDays}d at $${(arr / 1000).toFixed(0)}k. Health ${result.overall} (${deltaWow >= 0 ? '+' : ''}${deltaWow} WoW), top drag ${topDrag(result)}. Come ready to confirm the renewal path and resolve the open SSO ask.`,
      generatedAt: daysAgo(0), stale: false,
    });
  }

  // ── alerts ─────────────────────────────────────────────────────────────────
  if (result.band === 'red') ds.alerts.push({ id: uid('al'), ruleId: 'rule_red', companyId, ownerId: owner.id, title: `${name} crossed into red`, detail: `Health ${result.overall}. Top drag: ${topDrag(result)}.`, severity: 'critical', status: 'open', dedupeKey: `${companyId}:red`, createdAt: daysAgo(randInt(0, 3)) });
  if (deltaWow <= -10) ds.alerts.push({ id: uid('al'), ruleId: 'rule_drop', companyId, ownerId: owner.id, title: `${name} health dropped ${deltaWow} WoW`, detail: 'Investigate recent activity and support tickets.', severity: 'warning', status: chance(0.3) ? 'acknowledged' : 'open', dedupeKey: `${companyId}:drop`, createdAt: daysAgo(randInt(0, 5)) });
  if (renewalDays <= 90 && renewalDays > 0 && result.overall < 60) ds.alerts.push({ id: uid('al'), ruleId: 'rule_renewal_risk', companyId, ownerId: owner.id, title: `At-risk renewal: ${name}`, detail: `Renews in ${renewalDays}d, health ${result.overall}.`, severity: 'critical', status: 'open', dedupeKey: `${companyId}:renrisk`, createdAt: daysAgo(randInt(0, 4)) });
  if (openP1 > 0) ds.alerts.push({ id: uid('al'), ruleId: 'rule_p1', companyId, ownerId: owner.id, title: `New P1 ticket — ${name}`, detail: 'Critical: data sync failing.', severity: 'critical', status: 'open', dedupeKey: `${companyId}:p1`, createdAt: daysAgo(randInt(0, 6)) });
}

function topDrag(result: ReturnType<typeof computeHealth>): string {
  const labels: Record<string, string> = { value: 'Value', engagement: 'Engagement', support: 'Support', sentiment: 'Sentiment', usage: 'Usage' };
  let worst = ''; let worstScore = 101;
  for (const [k, d] of Object.entries(result.dimensions)) {
    if (d.score != null && d.weight > 0 && d.score < worstScore) { worstScore = d.score; worst = k; }
  }
  return labels[worst] ?? 'Engagement';
}

function buildExplanation(name: string, result: ReturnType<typeof computeHealth>): string {
  const drag = topDrag(result);
  const dims = Object.entries(result.dimensions).filter(([, d]) => d.score != null && d.weight > 0);
  const strongest = dims.sort((a, b) => (b[1].score ?? 0) - (a[1].score ?? 0))[0];
  return `${name} scores ${result.overall} (${result.band}). ${drag} is the biggest drag on the weighted score, while ${strongest?.[0] ?? 'usage'} holds up strongest at ${strongest?.[1].score ?? 70}. The score reflects the current mix of support load, engagement cadence and usage trend across the account.`;
}

function pickRecs(result: ReturnType<typeof computeHealth>): HealthRecommendation[] {
  // deterministic-ish: pick 3 based on weakest dimensions
  const shuffled = [...RECS_POOL];
  return shuffled.slice(0, 3);
}

// Guarantee each CSM's renewal pipeline shows a live "Negotiation" column so the
// kanban reads as a real book rather than an empty stage. Moves 1–2 deals from a
// neighbouring stage when Negotiation would otherwise be empty, keeping stage
// probability / forecast / confidence consistent.
function ensureRenewalStageCoverage(ds: DemoDataset) {
  const owners = new Set(ds.deals.filter((d) => d.pipeline === 'renewal').map((d) => d.ownerId));
  for (const ownerId of owners) {
    const open = ds.deals.filter((d) => d.pipeline === 'renewal' && d.ownerId === ownerId && d.status === 'open');
    let need = 2 - open.filter((d) => d.stage === 'Negotiation').length; // aim for ~2 in Negotiation
    // Only ever pull from a neighbouring stage that would still keep ≥1 deal, so we
    // never trade the empty "Negotiation" column for a new empty column elsewhere.
    const sourceStages = ['Proposal Sent', 'Exec Check-in', 'Verbal Commit', 'T-120 Review'];
    while (need > 0) {
      const source = sourceStages
        .map((s) => ({ s, deals: open.filter((d) => d.stage === s) }))
        .filter((x) => x.deals.length >= 2)
        .sort((a, b) => b.deals.length - a.deals.length)[0];
      if (!source) break;
      const d = source.deals[source.deals.length - 1];
      d.stage = 'Negotiation';
      d.stageProbability = 0.75;
      d.forecastCategory = 'best_case';
      d.confidence = 75;
      d.nextSteps = NEXT_STEPS_BY_STAGE['Negotiation'];
      need--;
    }
  }
}

function seedAlertRules(): AlertRule[] {
  const all: Segment[] = ['scaled', 'mid_touch', 'enterprise'];
  return [
    { id: 'rule_drop', name: 'Health drop ≥10 WoW', description: 'Cached health fell 10+ points week-over-week', ruleType: 'health_drop', config: { points: 10 }, segment: all, enabled: true, severity: 'warning' },
    { id: 'rule_red', name: 'Crossed into red', description: 'Health band moved to red', ruleType: 'health_band_red', config: {}, segment: all, enabled: true, severity: 'critical' },
    { id: 'rule_notouch', name: 'No touch > SLA', description: 'No touch beyond the segment touch SLA', ruleType: 'no_touch_sla', config: {}, segment: all, enabled: true, severity: 'warning' },
    { id: 'rule_renewal_risk', name: 'Renewal ≤90d & health <60', description: 'At-risk renewal', ruleType: 'renewal_at_risk', config: { days: 90, health: 60 }, segment: all, enabled: true, severity: 'critical' },
    { id: 'rule_nps_detractor', name: 'NPS detractor received', description: 'A detractor NPS response landed', ruleType: 'nps_detractor', config: {}, segment: all, enabled: true, severity: 'warning' },
    { id: 'rule_deal_stale', name: 'Open deal no activity 14d', description: 'Open deal with no activity for 14 days', ruleType: 'deal_stale', config: { days: 14 }, segment: all, enabled: true, severity: 'warning' },
    { id: 'rule_playbook_overdue', name: 'Playbook step overdue 3d', description: 'A playbook step is 3+ days overdue', ruleType: 'playbook_overdue', config: { days: 3 }, segment: all, enabled: true, severity: 'info' },
    { id: 'rule_p1', name: 'New P1 ticket', description: 'A new P1 ticket was opened', ruleType: 'new_p1', config: {}, segment: all, enabled: true, severity: 'critical' },
    { id: 'rule_conn_broken', name: 'Gmail/Calendar connection broken', description: 'A Google connection is in error state', ruleType: 'connection_broken', config: {}, segment: all, enabled: true, severity: 'warning' },
  ];
}

function buildDigests(ds: DemoDataset) {
  // Build a daily digest for each CSM referencing their own book.
  const csms = ds.profiles.filter((p) => p.role === 'csm');
  for (const csm of csms) {
    const myCompanies = ds.companies.filter((c) => c.ownerId === csm.id);
    const myAlerts = ds.alerts.filter((a) => a.ownerId === csm.id && a.status === 'open');
    const myTasks = ds.tasks.filter((t) => myCompanies.some((c) => c.id === t.companyId) && !t.completedAt);
    const myMeetings = ds.calendarEvents.filter((e) => myCompanies.some((c) => c.id === e.companyId));
    const movers = myCompanies.filter((c) => Math.abs(c.healthDeltaWow ?? 0) >= 5).sort((a, b) => Math.abs(b.healthDeltaWow ?? 0) - Math.abs(a.healthDeltaWow ?? 0)).slice(0, 5);
    const renewalCheckpoints = myCompanies.filter((c) => { const d = c.renewalDate ? Math.ceil((new Date(c.renewalDate).getTime() - now) / DAY) : 999; return [120, 90, 60, 30].some((t) => Math.abs(d - t) <= 2); });

    // Top-3 priorities — deduplicated so a single account/signal never fills two
    // slots (e.g. an alert AND a health-mover for the same company). Draw from
    // alerts → renewal checkpoints → health movers → overdue tasks, skipping any
    // account already represented, and backfill the freed slot with the next signal.
    const sevRank = (s: string) => (s === 'critical' ? 2 : s === 'warning' ? 1 : 0);
    const usedCo = new Set<string>();
    const priorities: string[] = [];
    const overdueCount = myTasks.filter((t) => t.dueDate && new Date(t.dueDate).getTime() < now).length;
    const daysOut = (c: Company) => (c.renewalDate ? Math.ceil((new Date(c.renewalDate).getTime() - now) / DAY) : 0);
    for (const a of [...myAlerts].sort((x, y) => sevRank(y.severity) - sevRank(x.severity))) {
      if (priorities.length >= 3) break;
      if (a.companyId && usedCo.has(a.companyId)) continue;
      priorities.push(a.title);
      if (a.companyId) usedCo.add(a.companyId);
    }
    for (const r of renewalCheckpoints) {
      if (priorities.length >= 3 || usedCo.has(r.id)) continue;
      priorities.push(`${r.name} hits a renewal checkpoint (T-${daysOut(r)})`);
      usedCo.add(r.id);
    }
    for (const m of movers) {
      if (priorities.length >= 3 || usedCo.has(m.id)) continue;
      priorities.push(`${m.name} moved ${(m.healthDeltaWow ?? 0) >= 0 ? '+' : ''}${m.healthDeltaWow} pts WoW — review why`);
      usedCo.add(m.id);
    }
    if (priorities.length < 3 && overdueCount) priorities.push(`Clear ${overdueCount} overdue task${overdueCount > 1 ? 's' : ''}`);
    if (priorities.length < 3 && myMeetings.length) priorities.push(`Prep for ${myMeetings.length} upcoming meeting${myMeetings.length > 1 ? 's' : ''} using the briefs below`);
    while (priorities.length < 3) priorities.push('Review your book for accounts needing a proactive touch');
    const narrative = `Top 3 priorities today: ${priorities.slice(0, 3).map((p, i) => `(${i + 1}) ${p}`).join('. ')}.`;

    const content = {
      meetings: myMeetings.map((m) => ({ time: m.startsAt, company: ds.companies.find((c) => c.id === m.companyId)?.name ?? '', companyId: m.companyId!, health: ds.companies.find((c) => c.id === m.companyId)?.healthScore ?? null, calendarEventId: m.id })),
      tasksDue: myTasks.slice(0, 8).map((t) => ({ id: t.id, title: t.title, company: myCompanies.find((c) => c.id === t.companyId)?.name ?? '', companyId: t.companyId, dueDate: t.dueDate, overdue: !!t.dueDate && new Date(t.dueDate).getTime() < now })),
      unprocessedActionItems: [],
      alerts: myAlerts.map((a) => ({ id: a.id, title: a.title, severity: a.severity, companyId: a.companyId })),
      healthMovers: movers.map((c) => ({ companyId: c.id, company: c.name, delta: c.healthDeltaWow ?? 0, score: c.healthScore ?? 0 })),
      renewalCheckpoints: renewalCheckpoints.map((c) => ({ companyId: c.id, company: c.name, daysOut: c.renewalDate ? Math.ceil((new Date(c.renewalDate).getTime() - now) / DAY) : 0, arr: c.renewalArr ?? null })),
    };
    ds.digests.push({
      id: uid('dg'), userId: csm.id, digestType: 'daily', digestDate: dateOnly(daysAgo(0)),
      content,
      narrative,
    });
  }
}

// ── V1.1 seed builders ──────────────────────────────────────────────────────
function buildLibrary(ds: DemoDataset) {
  const items: Omit<LibraryItem, 'id' | 'createdAt'>[] = [
    { title: 'QBR deck template', description: 'Standard quarterly business review deck.', itemType: 'deck', url: null, storagePath: 'library/qbr-template.pptx', tags: ['qbr', 'template'], segments: ['enterprise', 'mid_touch'], uploadedBy: 'u_mgr', downloadCount: 42 },
    { title: 'Onboarding one-pager', description: 'First-30-days plan for new customers.', itemType: 'doc', url: null, storagePath: 'library/onboarding.pdf', tags: ['onboarding'], segments: ['scaled', 'mid_touch'], uploadedBy: 'u_admin', downloadCount: 18 },
    { title: 'Renewal email templates', description: 'T-60 / T-30 renewal sequences.', itemType: 'template', url: null, storagePath: 'library/renewal-emails.docx', tags: ['renewal', 'template'], segments: ['scaled'], uploadedBy: 'u_mgr', downloadCount: 63 },
    { title: 'ROI calculator', description: 'Value model for expansion conversations.', itemType: 'link', url: 'https://sheets.example.com/roi', storagePath: null, tags: ['expansion', 'value'], segments: ['enterprise'], uploadedBy: 'u_ent', downloadCount: 9 },
    { title: 'Executive value narrative', description: 'How to frame value for exec sponsors.', itemType: 'doc', url: null, storagePath: 'library/value-narrative.pdf', tags: ['value', 'exec'], segments: ['enterprise'], uploadedBy: 'u_admin', downloadCount: 27 },
    { title: 'Product datasheet — SEO Intelligence', description: 'Latest SEO Intelligence one-pager.', itemType: 'link', url: 'https://planhat.com/seo-intelligence', storagePath: null, tags: ['product', 'seo'], segments: ['mid_touch', 'enterprise'], uploadedBy: 'u_mgr', downloadCount: 12 },
  ];
  items.forEach((it) => ds.libraryItems.push({ id: uid('lib'), createdAt: daysAgo(randInt(5, 90)), ...it }));
}

function buildDashboards(ds: DemoDataset, csms: Profile[], manager: Profile) {
  // "My book at a glance" for each CSM + a shared "Renewal command centre" for the manager.
  csms.forEach((csm) => {
    const dashId = uid('dash');
    ds.dashboards.push({ id: dashId, name: 'My book at a glance', ownerId: csm.id, shared: false, layout: null });
    const widgets: Omit<DashboardWidget, 'id' | 'dashboardId'>[] = [
      { position: { x: 0, y: 0, w: 1, h: 1 }, kind: 'metric', dataset: 'companies', groupBy: 'segment', measure: 'count', filter: {}, title: 'Accounts' },
      { position: { x: 1, y: 0, w: 1, h: 1 }, kind: 'metric', dataset: 'companies', groupBy: 'segment', measure: 'sum_arr', filter: {}, title: 'Total ARR' },
      { position: { x: 0, y: 1, w: 2, h: 2 }, kind: 'donut', dataset: 'companies', groupBy: 'healthBand', measure: 'count', filter: {}, title: 'Health distribution' },
      { position: { x: 2, y: 0, w: 2, h: 2 }, kind: 'line', dataset: 'health_trend', groupBy: 'month', measure: 'avg_health', filter: {}, title: 'Health trend (12mo)' },
      { position: { x: 0, y: 3, w: 4, h: 2 }, kind: 'bar', dataset: 'renewals', groupBy: 'quarter', measure: 'sum_arr', filter: {}, title: 'Renewal ARR by quarter' },
    ];
    widgets.forEach((w) => ds.dashboardWidgets.push({ id: uid('dw'), dashboardId: dashId, ...w }));
  });

  const mgrDash = uid('dash');
  ds.dashboards.push({ id: mgrDash, name: 'Renewal command centre', ownerId: manager.id, shared: true, layout: null });
  const mgrWidgets: Omit<DashboardWidget, 'id' | 'dashboardId'>[] = [
    { position: { x: 0, y: 0, w: 2, h: 2 }, kind: 'bar', dataset: 'renewals', groupBy: 'stage', measure: 'sum_arr', filter: {}, title: 'Renewal pipeline by stage' },
    { position: { x: 2, y: 0, w: 2, h: 2 }, kind: 'donut', dataset: 'companies', groupBy: 'healthBand', measure: 'sum_arr', filter: {}, title: 'ARR by health band' },
    { position: { x: 0, y: 2, w: 2, h: 2 }, kind: 'bar', dataset: 'companies', groupBy: 'owner', measure: 'count', filter: {}, title: 'Accounts per CSM' },
    { position: { x: 2, y: 2, w: 2, h: 2 }, kind: 'line', dataset: 'nps', groupBy: 'month', measure: 'avg', filter: {}, title: 'NPS trend' },
  ];
  mgrWidgets.forEach((w) => ds.dashboardWidgets.push({ id: uid('dw'), dashboardId: mgrDash, ...w }));
}

function buildAskCompass(ds: DemoDataset, csm: Profile) {
  const threadId = uid('akt');
  ds.askThreads.push({ id: threadId, userId: csm.id, title: 'Q4 renewals with declining usage', createdAt: daysAgo(1) });
  ds.askMessages.push({ id: uid('akm'), threadId, role: 'user', content: 'Which of my accounts renew in Q4 with declining usage?', createdAt: daysAgo(1) });
  ds.askMessages.push({ id: uid('akm'), threadId, role: 'assistant', content: 'I checked your book and found accounts renewing in Q4 with a negative 4-week usage trend. Open the linked records to dig in.', toolCalls: [{ name: 'list_renewals' }, { name: 'get_usage' }], createdAt: daysAgo(1) });
}

function buildNotifications(ds: DemoDataset, csms: Profile[], manager: Profile) {
  csms.forEach((csm) => {
    const co = ds.companies.find((c) => c.ownerId === csm.id);
    if (co) {
      ds.notifications.push({ id: uid('ntf'), userId: csm.id, kind: 'mention', title: `${manager.fullName} mentioned you`, body: `In a note on ${co.name}: "@${csm.fullName.split(' ')[0]} can you confirm the renewal timeline?"`, link: `/company/${co.id}?tab=notes`, readAt: null, createdAt: daysAgo(0) });
      ds.notifications.push({ id: uid('ntf'), userId: csm.id, kind: 'task_assigned', title: 'New task assigned', body: `${manager.fullName} assigned you "Prep QBR deck" on ${co.name}.`, link: `/company/${co.id}?tab=tasks`, readAt: daysAgo(0), createdAt: daysAgo(2) });
    }
  });
}

const CHANGELOG_SEED: ChangelogEntry[] = [
  { id: 'cl_100', version: '1.0.0', releasedOn: '2026-07-14', category: 'new', title: 'Compass V1 launch', body: 'Portfolio review, 360s, health engine, renewals, playbooks, digests, ⌘K, integrations, Planhat migration.', position: 0 },
  { id: 'cl_110_1', version: '1.1.0', releasedOn: '2026-07-16', category: 'fixed', title: '360 quick actions wired', body: 'Log note / Task / Email / Meeting now open the right composer or modal; graceful disconnected-Gmail state.', position: 1 },
  { id: 'cl_110_2', version: '1.1.0', releasedOn: '2026-07-16', category: 'fixed', title: 'NPS page populated', body: 'Root-caused the empty NPS page, added manual "Log NPS response" and a proper empty state.', position: 2 },
  { id: 'cl_110_3', version: '1.1.0', releasedOn: '2026-07-16', category: 'improved', title: 'Collapsible sidebar', body: 'No more truncation; collapse toggle + "[" shortcut, persisted per user.', position: 3 },
  { id: 'cl_110_4', version: '1.1.0', releasedOn: '2026-07-16', category: 'improved', title: 'Everything is clickable', body: 'Portfolio KPI cards, report charts and dashboard widgets drill through to filtered views.', position: 4 },
  { id: 'cl_110_5', version: '1.1.0', releasedOn: '2026-07-16', category: 'new', title: 'Ask Compass', body: 'Chat with an agent about your book — renewals, usage, activity, all scoped to what you can see.', position: 5 },
  { id: 'cl_110_6', version: '1.1.0', releasedOn: '2026-07-16', category: 'new', title: 'Dashboards', body: 'Build, arrange and share widget dashboards from a safe dataset layer.', position: 6 },
  { id: 'cl_110_7', version: '1.1.0', releasedOn: '2026-07-16', category: 'new', title: 'CSV import', body: 'Import companies, contacts and usage metrics with mapping, validation and dedupe modes.', position: 7 },
  { id: 'cl_110_8', version: '1.1.0', releasedOn: '2026-07-16', category: 'new', title: 'Library', body: 'A shelf for QBR decks, one-pagers, templates and links.', position: 8 },
  { id: 'cl_110_9', version: '1.1.0', releasedOn: '2026-07-16', category: 'new', title: 'Whitespace map', body: 'Products × accounts heatmap to spot cross-sell plays; create expansion deals in a click.', position: 9 },
  { id: 'cl_110_10', version: '1.1.0', releasedOn: '2026-07-16', category: 'new', title: 'Contact 360', body: 'Every contact name links to a full record with activity, emails, meetings, NPS and tasks.', position: 10 },
  { id: 'cl_110_11', version: '1.1.0', releasedOn: '2026-07-16', category: 'new', title: 'Latest news', body: 'AI web-search news card on the 360, auto-refreshed weekly for enterprise accounts.', position: 11 },
  { id: 'cl_110_12', version: '1.1.0', releasedOn: '2026-07-16', category: 'new', title: 'Usage tab', body: 'Utilisation, per-metric charts and adoption grid driven by usage_metrics.', position: 12 },
  { id: 'cl_110_13', version: '1.1.0', releasedOn: '2026-07-16', category: 'new', title: '@mentions & notifications', body: 'Mention teammates in notes; in-app bell + optional Slack DM.', position: 13 },
  { id: 'cl_110_14', version: '1.1.0', releasedOn: '2026-07-16', category: 'improved', title: 'Editable everywhere', body: 'MEDDIC toggles, contact fields, success-plan statuses and deal qualification are all hand-editable.', position: 14 },
];

// ── V2 Playbooks demo seed (mirrors the DB seed; replaces the retired
//    src/lib/playbooks.ts constant so demo mode is DB-shaped too). ────────────
function seedPlaybooks(ds: DemoDataset): void {
  type Row = [title: string, after: number, priority: 'normal' | 'high', stepType?: PlaybookStepType];
  const defs: Array<{ id: string; name: string; desc: string; type: PlaybookType; seg: Segment[]; steps: Row[] }> = [
    { id: 'pt_onboarding_scaled', name: 'Onboarding — Scaled', desc: 'Automated first-90-days motion for scaled accounts.', type: 'project', seg: ['scaled'],
      steps: [['Welcome email sequence', 0, 'normal', 'email'], ['Activation check', 14, 'normal'], ['30-day value review', 30, 'high']] },
    { id: 'pt_renewal_120', name: 'Renewal 120-day motion', desc: 'Staged renewal motion for mid-touch and enterprise books.', type: 'project', seg: ['mid_touch', 'enterprise'],
      steps: [['T-120 internal review', 0, 'normal'], ['T-90 exec check-in', 30, 'high'], ['T-60 proposal', 60, 'high'], ['T-30 close plan', 90, 'high']] },
    { id: 'pt_renewal_scaled', name: 'Scaled renewal automation', desc: 'Low-touch renewal email sequence for scaled accounts.', type: 'sequence', seg: ['scaled'],
      steps: [['T-60 renewal email 1', 0, 'normal', 'email'], ['T-45 reminder', 15, 'normal', 'email'], ['T-15 final notice', 45, 'high', 'email']] },
    { id: 'pt_risk_turnaround', name: 'Risk turnaround', desc: 'Fires when cached health falls 10+ points week-over-week.', type: 'project', seg: ['scaled', 'mid_touch', 'enterprise'],
      steps: [['Root-cause call', 2, 'high'], ['Exec escalation', 5, 'high'], ['Path-to-green plan', 7, 'high']] },
    { id: 'pt_exec_cadence', name: 'Enterprise exec-sponsor cadence', desc: 'Keeps a steady exec touch and QBR rhythm on enterprise accounts.', type: 'project', seg: ['enterprise'],
      steps: [['Quarterly exec sync', 0, 'normal'], ['QBR prep', 80, 'normal'], ['QBR', 90, 'high']] },
  ];
  for (const d of defs) {
    ds.playbookTemplates.push({ id: d.id, name: d.name, description: d.desc, type: d.type, targetModel: 'company', status: 'live', entryCriteria: {}, exitCriteria: {}, exitArchiveAction: 'keep_remaining', createdBy: null, segment: d.seg });
    const groupId = `${d.id}_g0`;
    ds.playbookGroups.push({ id: groupId, templateId: d.id, name: 'Steps', position: 0, groupCondition: {}, expireBehavior: 'keep' });
    d.steps.forEach(([title, after, priority, stepType], i) => {
      ds.playbookSteps.push({
        id: `${d.id}_s${i}`, templateId: d.id, groupId, position: i, stepType: (stepType ?? 'task'),
        title, description: null, priority, ownerRef: { kind: 'role', value: 'account_owner' }, conversationType: null,
        checklist: [], attachments: [], customerVisible: false, startAfterDays: after, durationDays: null, workdaysOnly: true,
        dependsOnStepId: null, dependencyTrigger: null,
      });
    });
  }
}
