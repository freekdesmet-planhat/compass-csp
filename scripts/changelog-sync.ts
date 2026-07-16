/**
 * scripts/changelog-sync.ts — parse CHANGELOG.md and upsert into changelog_entries
 * so the in-app "What's new" panel (D7) stays in sync. Idempotent: upserts on
 * (version, title). Run on deploy:  npm run changelog:sync
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run changelog:sync
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('✖ Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const here = dirname(fileURLToPath(import.meta.url));
const md = readFileSync(join(here, '..', 'CHANGELOG.md'), 'utf8');

type Entry = { version: string; released_on: string | null; category: string; title: string; body: string; position: number };
const entries: Entry[] = [];
let version = ''; let releasedOn: string | null = null; let category = ''; let pos = 0;

for (const line of md.split('\n')) {
  const ver = line.match(/^##\s+([\d.]+)\s*(?:—|-)\s*(\d{4}-\d{2}-\d{2})?/);
  if (ver) { version = ver[1]; releasedOn = ver[2] ?? null; continue; }
  const cat = line.match(/^###\s+(new|improved|fixed)/i);
  if (cat) { category = cat[1].toLowerCase(); continue; }
  const item = line.match(/^-\s+(.+?):\s+(.+)$/);
  if (item && version && category) {
    entries.push({ version, released_on: releasedOn, category, title: item[1].trim(), body: item[2].trim(), position: pos++ });
  }
}

if (!entries.length) { console.error('✖ No changelog entries parsed — check CHANGELOG.md format.'); process.exit(1); }

const { error } = await sb.from('changelog_entries').upsert(entries, { onConflict: 'version,title' });
if (error) { console.error('✖ Upsert failed:', error.message); process.exit(1); }
console.log(`✔ Synced ${entries.length} changelog entries across versions: ${[...new Set(entries.map((e) => e.version))].join(', ')}`);
