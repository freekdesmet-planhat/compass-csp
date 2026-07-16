// External website + domain links (C1). Favicon + hostname, opens in a new tab
// with rel=noopener. Favicon falls back to a Globe glyph if it fails to load.
import { useState } from 'react';
import { Globe } from 'lucide-react';
import { Chip } from './ui';

function hostname(url: string): string {
  try { return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, ''); }
  catch { return url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]; }
}

function Favicon({ host }: { host: string }) {
  const [err, setErr] = useState(false);
  if (err) return <Globe className="h-3.5 w-3.5 text-muted-foreground" />;
  return <img src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`} alt="" className="h-3.5 w-3.5 rounded-sm" onError={() => setErr(true)} />;
}

export function WebsiteLink({ url, className }: { url: string; className?: string }) {
  const host = hostname(url);
  const href = url.startsWith('http') ? url : `https://${url}`;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1.5 font-medium text-[var(--accent)] hover:underline ${className ?? ''}`}>
      <Favicon host={host} />{host}
    </a>
  );
}

export function DomainChips({ domains }: { domains: string[] }) {
  return (
    <span className="flex flex-wrap justify-end gap-1">
      {domains.map((d) => (
        <a key={d} href={`https://${d}`} target="_blank" rel="noopener noreferrer">
          <Chip tone="neutral" className="hover:border-[var(--accent)]">{d}</Chip>
        </a>
      ))}
    </span>
  );
}
