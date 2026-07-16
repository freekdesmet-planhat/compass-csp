// Whitespace / expansion map (C5). One cell per product, status-coloured; a
// popover sets the status or creates a pre-filled expansion deal. Reused by the
// 360 "Products & whitespace" strip and the Renewals → Expansion heatmap.
import { useNavigate } from 'react-router-dom';
import { Popover, PopoverTrigger, PopoverContent, Button } from './ui';
import { useProducts, useCompanyProducts, useUpsertCompanyProduct, useCreateDeal } from '@/lib/hooks';
import { useToast } from './toast';
import { cn } from '@/lib/utils';
import type { CompanyProduct, CompanyProductStatus, Product } from '@/lib/types';

export const STATUS_META: Record<CompanyProductStatus, { label: string; cell: string; dot: string }> = {
  current: { label: 'Current', cell: 'bg-[var(--green)] text-white border-transparent', dot: 'var(--green)' },
  active_opp: { label: 'Active opp', cell: 'bg-[var(--accent)] text-white border-transparent', dot: 'var(--accent)' },
  need_to_discuss: { label: 'Need to discuss', cell: 'border-[var(--amber)] text-[var(--amber)] bg-[var(--amber-tint)]', dot: 'var(--amber)' },
  rejected: { label: 'Rejected', cell: 'bg-[#f1f3f5] text-muted-foreground line-through border-transparent', dot: '#98a2b3' },
  none: { label: 'Whitespace', cell: 'border-dashed text-muted-foreground bg-white', dot: '#d0d5dd' },
};
const ORDER: CompanyProductStatus[] = ['current', 'active_opp', 'need_to_discuss', 'rejected', 'none'];

export function WhitespaceCell({ companyId, product, cp, compact }: { companyId: string; product: Product; cp?: CompanyProduct; compact?: boolean }) {
  const upsert = useUpsertCompanyProduct();
  const createDeal = useCreateDeal();
  const { toast } = useToast();
  const navigate = useNavigate();
  const status = cp?.status ?? 'none';
  const meta = STATUS_META[status];

  const createExpansion = async () => {
    await upsert.mutateAsync({ companyId, productId: product.id, status: 'active_opp' });
    await createDeal.mutateAsync({ companyId, name: `${product.name} expansion`, pipeline: 'expansion', stage: 'Discovery' });
    toast('Expansion deal created');
    navigate(`/company/${companyId}?tab=deals`);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          title={`${product.name} — ${meta.label}`}
          className={cn('flex items-center justify-center rounded-md border text-xs font-medium transition-colors hover:ring-1 hover:ring-[var(--accent)]', meta.cell, compact ? 'h-7 w-full' : 'h-9 w-full px-2')}
        >
          {compact ? '' : (status === 'none' ? '+' : meta.label)}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52">
        <div className="px-2 py-1 text-xs text-muted-foreground">{product.name}</div>
        {ORDER.map((s) => (
          <button key={s} onClick={() => upsert.mutate({ companyId, productId: product.id, status: s })} className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-panel', s === status && 'bg-panel')}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_META[s].dot }} />{STATUS_META[s].label}
          </button>
        ))}
        <div className="my-1 border-t" />
        <Button size="sm" variant="primary" className="w-full" onClick={createExpansion}>Create expansion deal</Button>
      </PopoverContent>
    </Popover>
  );
}

// The 360 strip: one row of product cells for a single account.
export function WhitespaceStrip({ companyId }: { companyId: string }) {
  const { data: products = [] } = useProducts();
  const { data: cps = [] } = useCompanyProducts(companyId);
  const cpFor = (pid: string) => cps.find((c) => c.productId === pid);
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-muted-foreground">Products &amp; whitespace</div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${products.length}, minmax(0, 1fr))` }}>
        {products.map((p) => (
          <div key={p.id}>
            <div className="mb-1 truncate text-center text-[10px] text-muted-foreground" title={p.name}>{p.name}</div>
            <WhitespaceCell companyId={companyId} product={p} cp={cpFor(p.id)} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        {ORDER.map((s) => <span key={s} className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: STATUS_META[s].dot }} />{STATUS_META[s].label}</span>)}
      </div>
    </div>
  );
}
