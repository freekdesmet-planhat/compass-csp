/**
 * scripts/backfill-email-contacts.ts — populate emails.contact_ids on historical
 * rows by matching from_email / to_emails / cc_emails against contacts.email and
 * contacts.other_emails within the same company (A6). Re-runnable: only touches
 * rows whose contact_ids is empty, and recomputes the full set each time.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run backfill:email-contacts
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('✖ Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// contacts: build company_id → (email → contact_id) map
const { data: contacts, error: cErr } = await sb.from('contacts').select('id, company_id, email, other_emails');
if (cErr) { console.error('✖', cErr.message); process.exit(1); }
const byCompany = new Map<string, Map<string, string>>();
for (const c of contacts ?? []) {
  const m = byCompany.get(c.company_id) ?? byCompany.set(c.company_id, new Map()).get(c.company_id)!;
  for (const e of [c.email, ...((c.other_emails as string[]) ?? [])]) if (e) m.set(String(e).toLowerCase(), c.id);
}

// Emails with empty/null contact_ids
const PAGE = 1000;
let offset = 0, scanned = 0, updated = 0;
for (;;) {
  const { data: emails, error } = await sb
    .from('emails')
    .select('id, company_id, from_email, to_emails, cc_emails, contact_ids')
    .range(offset, offset + PAGE - 1);
  if (error) { console.error('✖', error.message); process.exit(1); }
  if (!emails || emails.length === 0) break;
  for (const em of emails) {
    scanned++;
    if (Array.isArray(em.contact_ids) && em.contact_ids.length > 0) continue;
    const map = byCompany.get(em.company_id);
    if (!map) continue;
    const addrs = [em.from_email, ...((em.to_emails as string[]) ?? []), ...((em.cc_emails as string[]) ?? [])].filter(Boolean).map((a) => String(a).toLowerCase());
    const ids = [...new Set(addrs.map((a) => map.get(a)).filter(Boolean))] as string[];
    if (ids.length) { await sb.from('emails').update({ contact_ids: ids }).eq('id', em.id); updated++; }
  }
  offset += PAGE;
}
console.log(`✔ Scanned ${scanned} emails; populated contact_ids on ${updated}.`);
