import { useState } from 'react';
import { PageHeader, PageBody } from '@/components/PageHeader';
import { Card, CardHeader, CardTitle, CardBody, Button, Chip, Switch, Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui';
import { useSession } from '@/lib/session';
import { useToast } from '@/components/toast';
import { Mail, Clock, Bell } from 'lucide-react';

const TIMEZONES = ['Europe/Amsterdam', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Singapore', 'Australia/Sydney'];

export default function SettingsPage() {
  const { profile } = useSession();
  const { toast } = useToast();
  const [digestHour, setDigestHour] = useState(String(profile.digestHour));
  const [tz, setTz] = useState(profile.timezone);
  const [prefs, setPrefs] = useState({ emailAlerts: true, inAppAlerts: true, weeklyRecap: true });

  return (
    <div>
      <PageHeader title="Settings" subtitle={profile.email} />
      <PageBody>
        <div className="mx-auto max-w-2xl space-y-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Mail className="h-4 w-4 text-muted-foreground" /> Gmail & Calendar</CardTitle>
              <Chip tone="neutral">disconnected</Chip>
            </CardHeader>
            <CardBody className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Connect your Google account to auto-log domain-matched emails, send from the platform, and sync upcoming meetings for AI meeting prep. Base sign-in uses plain OpenID; connecting re-runs OAuth with Gmail + Calendar scopes and <code className="rounded bg-panel px-1">access_type=offline</code>, <code className="rounded bg-panel px-1">prompt=consent</code> to store a refresh token server-side.
              </p>
              <Button variant="primary" onClick={() => toast('Would run signInWithOAuth with Gmail + Calendar scopes (offline / consent) and store the refresh token', { tone: 'info' })}>Connect Gmail & Calendar</Button>
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
