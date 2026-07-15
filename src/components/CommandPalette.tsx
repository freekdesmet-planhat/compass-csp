// ⌘K global palette — search companies/contacts/deals/notes (search_all RPC in
// live mode; in-memory search in demo) + quick actions.
import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { useNavigate } from 'react-router-dom';
import { getDb } from '@/lib/store';
import { Building2, User, Handshake, FileText, CheckSquare, StickyNote, Compass } from 'lucide-react';
import type { Company, Contact, Deal, Activity } from '@/lib/types';

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  const db = getDb();
  const q = query.toLowerCase();
  const companies = q ? (db.companies as Company[]).filter((c) => c.name.toLowerCase().includes(q)).slice(0, 6) : (db.companies as Company[]).slice(0, 5);
  const contacts = q ? (db.contacts as Contact[]).filter((c) => `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q)).slice(0, 5) : [];
  const deals = q ? (db.deals as Deal[]).filter((d) => d.name.toLowerCase().includes(q)).slice(0, 4) : [];
  const notes = q ? (db.activities as Activity[]).filter((a) => a.type === 'note' && (a.title.toLowerCase().includes(q) || a.snippet?.toLowerCase().includes(q))).slice(0, 4) : [];

  const go = (path: string) => { setOpen(false); setQuery(''); navigate(path); };

  return (
    <Command.Dialog open={open} onOpenChange={setOpen} label="Command palette" className="fixed left-1/2 top-[18%] z-[100] w-full max-w-xl -translate-x-1/2 overflow-hidden rounded-lg border bg-white shadow-popover">
      <div className="flex items-center gap-2 border-b px-3">
        <Compass className="h-4 w-4 text-muted-foreground" />
        <Command.Input value={query} onValueChange={setQuery} placeholder="Search companies, contacts, deals, notes — or run a command…" className="h-11 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground" />
      </div>
      <Command.List className="max-h-[380px] overflow-y-auto p-1.5">
        <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">No results.</Command.Empty>

        <Command.Group heading="Quick actions" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground">
          <Item icon={CheckSquare} label="Create task" onSelect={() => go('/tasks')} />
          <Item icon={StickyNote} label="Log a note" onSelect={() => go('/portfolio')} />
          <Item icon={Handshake} label="Go to Renewals" onSelect={() => go('/renewals')} />
        </Command.Group>

        {companies.length > 0 && (
          <Command.Group heading="Companies" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground">
            {companies.map((c) => <Item key={c.id} icon={Building2} label={c.name} hint={c.segment ?? ''} onSelect={() => go(`/company/${c.id}`)} />)}
          </Command.Group>
        )}
        {contacts.length > 0 && (
          <Command.Group heading="Contacts" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground">
            {contacts.map((c) => <Item key={c.id} icon={User} label={`${c.firstName} ${c.lastName}`} hint={c.email ?? ''} onSelect={() => go(`/company/${c.companyId}?tab=contacts`)} />)}
          </Command.Group>
        )}
        {deals.length > 0 && (
          <Command.Group heading="Deals" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground">
            {deals.map((d) => <Item key={d.id} icon={Handshake} label={d.name} hint={d.stage ?? ''} onSelect={() => go(`/company/${d.companyId}?tab=deals`)} />)}
          </Command.Group>
        )}
        {notes.length > 0 && (
          <Command.Group heading="Notes" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground">
            {notes.map((n) => <Item key={n.id} icon={FileText} label={n.title} hint={n.snippet ?? ''} onSelect={() => go(`/company/${n.companyId}?tab=timeline`)} />)}
          </Command.Group>
        )}
      </Command.List>
    </Command.Dialog>
  );
}

function Item({ icon: Icon, label, hint, onSelect }: { icon: React.ComponentType<{ className?: string }>; label: string; hint?: string; onSelect: () => void }) {
  return (
    <Command.Item value={label + ' ' + (hint ?? '')} onSelect={onSelect} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-base data-[selected=true]:bg-panel">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span className="flex-1 truncate">{label}</span>
      {hint && <span className="truncate text-sm text-muted-foreground">{hint}</span>}
    </Command.Item>
  );
}
