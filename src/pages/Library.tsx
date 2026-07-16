// Library (D4) — internal best-practice shelf: decks, docs, templates, links.
// Card grid + search + tag/segment/type filters, download counter, upload modal.
import { useMemo, useState } from 'react';
import { PageHeader, PageBody } from '@/components/PageHeader';
import {
  Card, CardBody, Button, Input, Textarea, Chip, EmptyState, Select, SelectTrigger, SelectValue,
  SelectContent, SelectItem, Dialog, DialogContent, DialogTitle,
} from '@/components/ui';
import { useLibraryItems, useLibraryMutations } from '@/lib/hooks';
import { useToast } from '@/components/toast';
import { fmtNumber } from '@/lib/utils';
import { FileText, Presentation, FileCode, Link2, Search, Plus, Download, ExternalLink } from 'lucide-react';
import type { LibraryItem, LibraryItemType } from '@/lib/types';

const TYPE_META: Record<LibraryItemType, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  deck: { label: 'Deck', icon: Presentation },
  doc: { label: 'Doc', icon: FileText },
  template: { label: 'Template', icon: FileCode },
  link: { label: 'Link', icon: Link2 },
};

export default function LibraryPage() {
  const { data: items = [] } = useLibraryItems();
  const { incrementDownload } = useLibraryMutations();
  const { toast } = useToast();
  const [q, setQ] = useState('');
  const [type, setType] = useState('all');
  const [seg, setSeg] = useState('all');
  const [tag, setTag] = useState('all');
  const [uploadOpen, setUploadOpen] = useState(false);

  const allTags = useMemo(() => [...new Set(items.flatMap((i) => i.tags))].sort(), [items]);
  const rows = items.filter((i) => {
    if (q && !`${i.title} ${i.description ?? ''}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (type !== 'all' && i.itemType !== type) return false;
    if (seg !== 'all' && !i.segments.includes(seg)) return false;
    if (tag !== 'all' && !i.tags.includes(tag)) return false;
    return true;
  });

  const open = (it: LibraryItem) => {
    incrementDownload.mutate(it.id);
    if (it.url) window.open(it.url, '_blank', 'noopener');
    else toast(`Downloading ${it.title} (live mode serves from the library bucket)`);
  };

  return (
    <div>
      <PageHeader
        title="Library"
        subtitle={`${items.length} resources`}
        actions={<Button variant="primary" onClick={() => setUploadOpen(true)}><Plus className="h-3.5 w-3.5" /> Add resource</Button>}
      />
      <PageBody>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative"><Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" /><Input className="w-56 pl-7" placeholder="Search library…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <Select value={type} onValueChange={setType}><SelectTrigger className="w-32"><SelectValue placeholder="Type" /></SelectTrigger><SelectContent><SelectItem value="all">All types</SelectItem>{Object.entries(TYPE_META).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent></Select>
          <Select value={seg} onValueChange={setSeg}><SelectTrigger className="w-36"><SelectValue placeholder="Segment" /></SelectTrigger><SelectContent><SelectItem value="all">All segments</SelectItem><SelectItem value="scaled">Scaled</SelectItem><SelectItem value="mid_touch">Mid-touch</SelectItem><SelectItem value="enterprise">Enterprise</SelectItem></SelectContent></Select>
          {allTags.length > 0 && <Select value={tag} onValueChange={setTag}><SelectTrigger className="w-32"><SelectValue placeholder="Tag" /></SelectTrigger><SelectContent><SelectItem value="all">All tags</SelectItem>{allTags.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select>}
        </div>

        {rows.length === 0 ? <EmptyState icon={FileText} title="No resources match" /> : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((it) => {
              const Icon = TYPE_META[it.itemType].icon;
              return (
                <Card key={it.id} className="flex flex-col">
                  <CardBody className="flex flex-1 flex-col gap-2">
                    <div className="flex items-start gap-2">
                      <div className="rounded-md bg-panel p-2"><Icon className="h-4 w-4 text-[var(--accent)]" /></div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{it.title}</div>
                        <div className="text-xs text-muted-foreground">{TYPE_META[it.itemType].label} · {fmtNumber(it.downloadCount)} opens</div>
                      </div>
                    </div>
                    {it.description && <p className="line-clamp-2 text-sm text-muted-foreground">{it.description}</p>}
                    <div className="flex flex-wrap gap-1">
                      {it.tags.map((t) => <Chip key={t}>{t}</Chip>)}
                      {it.segments.map((s) => <Chip key={s} tone="accent">{s === 'mid_touch' ? 'mid-touch' : s}</Chip>)}
                    </div>
                    <div className="mt-auto pt-1">
                      <Button size="sm" variant="outline" className="w-full" onClick={() => open(it)}>
                        {it.itemType === 'link' ? <><ExternalLink className="h-3.5 w-3.5" /> Open</> : <><Download className="h-3.5 w-3.5" /> Download</>}
                      </Button>
                    </div>
                  </CardBody>
                </Card>
              );
            })}
          </div>
        )}
        <UploadModal open={uploadOpen} onOpenChange={setUploadOpen} />
      </PageBody>
    </div>
  );
}

function UploadModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { create } = useLibraryMutations();
  const { toast } = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [itemType, setItemType] = useState<LibraryItemType>('deck');
  const [url, setUrl] = useState('');
  const [tags, setTags] = useState('');
  const [segments, setSegments] = useState('');
  const submit = async () => {
    await create.mutateAsync({ title, description, itemType, url: itemType === 'link' ? url : null, storagePath: itemType === 'link' ? null : `library/${title.toLowerCase().replace(/\s+/g, '-')}`, tags: tags.split(',').map((t) => t.trim()).filter(Boolean), segments: segments.split(',').map((t) => t.trim()).filter(Boolean) });
    toast('Resource added');
    onOpenChange(false); setTitle(''); setDescription(''); setUrl(''); setTags(''); setSegments('');
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle className="text-md font-semibold">Add resource</DialogTitle>
        <div className="mt-3 space-y-3">
          <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Textarea rows={2} placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
          <Select value={itemType} onValueChange={(v) => setItemType(v as LibraryItemType)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(TYPE_META).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent></Select>
          {itemType === 'link'
            ? <Input placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
            : <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">File upload → Supabase Storage bucket <code className="rounded bg-panel px-1">library</code> (50MB) in live mode.</div>}
          <Input placeholder="Tags (comma-separated)" value={tags} onChange={(e) => setTags(e.target.value)} />
          <Input placeholder="Segments (scaled, mid_touch, enterprise)" value={segments} onChange={(e) => setSegments(e.target.value)} />
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" disabled={!title.trim()} onClick={submit}>Add</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
