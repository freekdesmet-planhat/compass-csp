import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader, PageBody } from '@/components/PageHeader';
import { Card, CardHeader, CardTitle, CardBody, Button, Chip, Switch, Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui';
import { useSession } from '@/lib/session';
import { useAlertRules } from '@/lib/hooks';
import { useToast } from '@/components/toast';
import { gmailConnected, setGmailConnected } from '@/lib/integrations';
import { DEFAULT_HEALTH_WEIGHTS, DEFAULT_HEALTH_THRESHOLDS, HEALTH_DIMENSIONS, SEGMENT_LABELS, type Segment } from '@/lib/segments';
import { Mail, Clock, Bell, SlidersHorizontal, UserCircle, Upload, ArrowRight } from 'lucide-react';

const TIMEZONES = ['Europe/Amsterdam', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Singapore', 'Australia/Sydney'];

export default function SettingsPage() {
  const { profile, allProfiles } = useSession();
  const { data: alertRules = [] } = useAlertRules();
  const { toast } = useToast();
  const [digestHour, setDigestHour] = useState(String(profile.digestHour));
  const [tz, setTz] = useState(profile.timezone);
  const [prefs, setPrefs] = useState({ emailAlerts: true, inAppAlerts: true, weeklyRecap: true });
  const [gmail, setGmail] = useState(gmailConnected());
  const isAdmin = profile.role === 'admin';
  const healthSegment: Segment = profile.segment ?? 'enterprise';
  const weights = DEFAULT_HEALTH_WEIGHTS[healthSegment];
  const managerName = profile.managerId ? allProfiles.find((p) => p.id === profile.managerId)?.fullName : null;

  return (
    <div>
      <PageHeader title="Settings" subtitle={profile.email} />
      <PageBody>
        <div className="mx-auto max-w-2xl space-y-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Mail className="h-4 w-4 text-muted-foreground" /> Gmail & Calendar</CardTitle>
              <Chip tone={gmail ? 'green' : 'neutral'}>{gmail ? 'connected' : 'disconnected'}</Chip>
            </CardHeader>
            <CardBody className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Connect your Google account to auto-log domain-matched emails, send from the platform, and sync upcoming meetings for AI meeting prep. Base sign-in uses plain OpenID; connecting re-runs OAuth with Gmail + Calendar scopes and <code className="rounded bg-panel px-1">access_type=offline</code>, <code className="rounded bg-panel px-1">prompt=consent</code> to store a refresh token server-side.
              </p>
              {gmail
                ? <Button onClick={() => { setGmailConnected(false); setGmail(false); toast('Gmail disconnected'); }}>Disconnect Gmail</Button>
                : <Button variant="primary" onClick={() => { setGmailConnected(true); setGmail(true); toast('Gmail connected (live mode runs signInWithOAuth with Gmail + Calendar scopes)', { tone: 'info' }); }}>Connect Gmail & Calendar</Button>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Clock className="h-4 w-4 text-muted-foreground" /> Morning digest</CardTitle></CardHeader>
            <CardBody className="space-y-3">
              <Row label="Digest hour">
                <Select value={digestHour} onValueChange={setDigestHour}>
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>{Array.from({ length: 24 }, (_, i) => <SelectItem key={i} value={String(i)}>{String(i).padStart(2, '0')}:00</SelectItem>)}</SelectContent>
                </Select>
              </Row>
              <Row label="Timezone">
                <Select value={tz} onValueChange={setTz}>
                  <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                  <SelectContent>{TIMEZONES.map((z) => <SelectItem key={z} value={z}>{z}</SelectItem>)}</SelectContent>
                </Select>
              </Row>
              <Button variant="primary" onClick={() => toast('Digest settings saved')}>Save</Button>
            </CardBody>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Bell className="h-4 w-4 text-muted-foreground" /> Notifications</CardTitle></CardHeader>
            <CardBody className="space-y-2">
              <ToggleRow label="Email alerts" checked={prefs.emailAlerts} onChange={(v) => { setPrefs((p) => ({ ...p, emailAlerts: v })); toast('Preference updated'); }} />
              <ToggleRow label="In-app alerts" checked={prefs.inAppAlerts} onChange={(v) => { setPrefs((p) => ({ ...p, inAppAlerts: v })); toast('Preference updated'); }} />
              <ToggleRow label="Weekly recap email" checked={prefs.weeklyRecap} onChange={(v) => { setPrefs((p) => ({ ...p, weeklyRecap: v })); toast('Preference updated'); }} />
            </CardBody>
          </Card>

          {/* Profile & team */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><UserCircle className="h-4 w-4 text-muted-foreground" /> Profile & team</CardTitle></CardHeader>
            <CardBody className="space-y-2 text-base">
              <Row label="Name"><span className="font-medium">{profile.fullName}</span></Row>
              <Row label="Email"><span className="text-muted-foreground">{profile.email}</span></Row>
              <Row label="Role"><Chip tone="accent" className="capitalize">{profile.role}</Chip></Row>
              <Row label="Book"><span>{profile.segment ? SEGMENT_LABELS[profile.segment] : 'All segments'}</span></Row>
              {managerName && <Row label="Manager"><span>{managerName}</span></Row>}
            </CardBody>
          </Card>

          {/* Health score configuration */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-muted-foreground" /> Health score configuration</CardTitle>
              <Chip tone="neutral">{SEGMENT_LABELS[healthSegment]}</Chip>
            </CardHeader>
            <CardBody className="space-y-2">
              {HEALTH_DIMENSIONS.map((d) => (
                <div key={d.key}>
                  <div className="mb-0.5 flex items-center justify-between text-sm"><span className="font-medium">{d.label}</span><span className="tnum text-muted-foreground">{weights[d.key]}%</span></div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-[#eef0f3]"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${weights[d.key]}%` }} /></div>
                </div>
              ))}
              <div className="flex items-center gap-3 border-t pt-2 text-sm text-muted-foreground">
                <span>Bands:</span>
                <Chip tone="red">red &lt; {DEFAULT_HEALTH_THRESHOLDS.red}</Chip>
                <Chip tone="amber">amber &lt; {DEFAULT_HEALTH_THRESHOLDS.amber}</Chip>
                <Chip tone="green">green ≥ {DEFAULT_HEALTH_THRESHOLDS.amber}</Chip>
              </div>
              {isAdmin
                ? <Link to="/admin" className="inline-flex items-center gap-1 text-sm text-[var(--accent)] hover:underline">Edit weights & thresholds in Admin <ArrowRight className="h-3.5 w-3.5" /></Link>
                : <p className="text-xs text-muted-foreground">Read-only — weights are configured per segment by an admin.</p>}
            </CardBody>
          </Card>

          {/* Alert rules */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Bell className="h-4 w-4 text-muted-foreground" /> Alert rules</CardTitle><span className="text-xs text-muted-foreground">{alertRules.filter((r) => r.enabled).length} active</span></CardHeader>
            <CardBody className="space-y-1.5">
              {alertRules.map((r) => (
                <div key={r.id} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
                  <Chip tone={r.severity === 'critical' ? 'red' : r.severity === 'warning' ? 'amber' : 'neutral'}>{r.severity}</Chip>
                  <span className="flex-1 font-medium">{r.name}</span>
                  <Chip tone={r.enabled ? 'green' : 'neutral'}>{r.enabled ? 'on' : 'off'}</Chip>
                </div>
              ))}
              {isAdmin
                ? <Link to="/admin" className="inline-flex items-center gap-1 pt-1 text-sm text-[var(--accent)] hover:underline">Edit thresholds & toggles in Admin <ArrowRight className="h-3.5 w-3.5" /></Link>
                : <p className="pt-1 text-xs text-muted-foreground">Read-only — thresholds are configured by an admin.</p>}
            </CardBody>
          </Card>

          {/* Data / import */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Upload className="h-4 w-4 text-muted-foreground" /> Data</CardTitle></CardHeader>
            <CardBody className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">Import companies, contacts and usage metrics from CSV with column mapping, validation and create / update / upsert modes.</p>
              <Link to="/import"><Button variant="outline" size="sm"><Upload className="h-3.5 w-3.5" /> Import CSV</Button></Link>
            </CardBody>
          </Card>
        </div>
      </PageBody>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between"><span className="text-base">{label}</span>{children}</div>;
}
function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <label className="flex items-center justify-between py-1"><span className="text-base">{label}</span><Switch checked={checked} onCheckedChange={onChange} /></label>;
}
