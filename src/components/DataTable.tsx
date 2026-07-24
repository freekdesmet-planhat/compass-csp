// Dense, keyboard-navigable table primitive (Attio-style). ↑↓ move, Enter opens.
// 36px rows, 1px borders, sortable columns, optional row click.
import { useState, useRef, useCallback, useEffect, type ReactNode, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import { ArrowUp, ArrowDown, ChevronLeft, ChevronRight } from 'lucide-react';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number | null | undefined;
  width?: string;
  align?: 'left' | 'right' | 'center';
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  defaultSort?: { key: string; dir: 'asc' | 'desc' };
  empty?: ReactNode;
  dense?: boolean;
  /** When set, rows are paginated this many at a time with prev/next controls. */
  pageSize?: number;
}

export function DataTable<T>({ columns, rows, rowKey, onRowClick, defaultSort, empty, dense, pageSize }: DataTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(defaultSort ?? null);
  const [active, setActive] = useState(0);
  const [page, setPage] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const sortedRows = (() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return sort.dir === 'asc' ? -1 : 1;
      if (av > bv) return sort.dir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  })();

  const toggleSort = (key: string) => {
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  };

  // Pagination (opt-in). Clamp the page + reset the active row when the row set
  // changes (search/filter/sort) so we never point past the end.
  const total = sortedRows.length;
  const pageCount = pageSize ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = pageSize ? sortedRows.slice(safePage * pageSize, safePage * pageSize + pageSize) : sortedRows;
  useEffect(() => { if (page > pageCount - 1) setPage(0); setActive(0); }, [total, sort, page, pageCount]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, pageRows.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === 'Enter' && onRowClick && pageRows[active]) {
        e.preventDefault();
        onRowClick(pageRows[active]);
      }
    },
    [active, pageRows, onRowClick]
  );

  if (rows.length === 0 && empty) return <>{empty}</>;

  return (
    <div ref={containerRef} tabIndex={0} onKeyDown={onKeyDown} className="overflow-x-auto rounded-lg border bg-white outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]">
      <table className="w-full border-collapse text-base">
        <thead>
          <tr className="border-b bg-panel/60">
            {columns.map((col) => {
              const sorted = sort?.key === col.key;
              return (
                <th
                  key={col.key}
                  style={{ width: col.width }}
                  aria-sort={col.sortValue ? (sorted ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
                  className={cn(
                    'select-none px-3 py-2 text-left text-sm font-medium text-muted-foreground',
                    col.align === 'right' && 'text-right',
                    col.align === 'center' && 'text-center'
                  )}
                >
                  {col.sortValue ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      aria-label={`Sort by ${typeof col.header === 'string' ? col.header : col.key}`}
                      className={cn('inline-flex items-center gap-1 hover:text-foreground', col.align === 'right' && 'flex-row-reverse', col.align === 'center' && 'justify-center')}
                    >
                      {col.header}
                      {sorted && (sort!.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                    </button>
                  ) : (
                    <span className={cn('inline-flex items-center gap-1', col.align === 'right' && 'flex-row-reverse')}>{col.header}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {pageRows.map((row, i) => (
            <tr
              key={rowKey(row)}
              onClick={() => { setActive(i); onRowClick?.(row); }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                'border-b last:border-0 transition-colors',
                onRowClick && 'cursor-pointer',
                i === active ? 'bg-[var(--accent-tint)]/40' : 'hover:bg-panel/60'
              )}
              style={{ height: dense ? 32 : 36 }}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn('px-3 tnum align-middle', col.align === 'right' && 'text-right', col.align === 'center' && 'text-center', col.className)}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {pageSize && total > pageSize && (
        <div className="flex items-center justify-between border-t px-3 py-2 text-sm text-muted-foreground">
          <span className="tnum">{safePage * pageSize + 1}–{Math.min(safePage * pageSize + pageSize, total)} of {total}</span>
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Previous page" disabled={safePage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 hover:bg-panel disabled:opacity-40">
              <ChevronLeft className="h-3.5 w-3.5" /> Prev
            </button>
            <span className="tnum px-1">{safePage + 1} / {pageCount}</span>
            <button type="button" aria-label="Next page" disabled={safePage >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 hover:bg-panel disabled:opacity-40">
              Next <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
