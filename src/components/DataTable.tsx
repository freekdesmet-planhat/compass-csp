// Dense, keyboard-navigable table primitive (Attio-style). ↑↓ move, Enter opens.
// 36px rows, 1px borders, sortable columns, optional row click.
import { useState, useRef, useCallback, type ReactNode, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import { ArrowUp, ArrowDown } from 'lucide-react';

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
}

export function DataTable<T>({ columns, rows, rowKey, onRowClick, defaultSort, empty, dense }: DataTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(defaultSort ?? null);
  const [active, setActive] = useState(0);
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

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, sortedRows.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === 'Enter' && onRowClick && sortedRows[active]) {
        e.preventDefault();
        onRowClick(sortedRows[active]);
      }
    },
    [active, sortedRows, onRowClick]
  );

  if (rows.length === 0 && empty) return <>{empty}</>;

  return (
    <div ref={containerRef} tabIndex={0} onKeyDown={onKeyDown} className="overflow-x-auto rounded-lg border bg-white outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]">
      <table className="w-full border-collapse text-base">
        <thead>
          <tr className="border-b bg-panel/60">
            {columns.map((col) => (
              <th
                key={col.key}
                style={{ width: col.width }}
                className={cn(
                  'select-none px-3 py-2 text-left text-sm font-medium text-muted-foreground',
                  col.align === 'right' && 'text-right',
                  col.align === 'center' && 'text-center',
                  col.sortValue && 'cursor-pointer hover:text-foreground'
                )}
                onClick={() => col.sortValue && toggleSort(col.key)}
              >
                <span className={cn('inline-flex items-center gap-1', col.align === 'right' && 'flex-row-reverse')}>
                  {col.header}
                  {sort?.key === col.key && (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, i) => (
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
    </div>
  );
}
