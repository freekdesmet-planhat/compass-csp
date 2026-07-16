// Reusable optimistic inline-edit primitives (B4 / C4 / C6). Match V1's quiet
// Attio editing pattern: click text to edit, Enter/blur commits, Esc cancels.
import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Minus, Plus } from 'lucide-react';

export function InlineText({ value, onSave, placeholder = '—', className }: { value: string; onSave: (v: string) => void; placeholder?: string; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);
  useEffect(() => { setVal(value); }, [value]);

  const commit = () => { setEditing(false); if (val !== value) onSave(val); };
  if (editing) {
    return (
      <input
        ref={ref}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setVal(value); setEditing(false); } }}
        className={cn('h-6 w-full rounded border bg-white px-1 text-sm outline-none focus-visible:border-[var(--accent)]', className)}
      />
    );
  }
  return (
    <button onClick={() => setEditing(true)} className={cn('rounded px-1 text-left hover:bg-panel', !value && 'text-muted-foreground', className)}>
      {value || placeholder}
    </button>
  );
}

export function InlineStepper({ value, onSave, min = 0, max = 10 }: { value: number; onSave: (v: number) => void; min?: number; max?: number }) {
  const dec = () => onSave(Math.max(min, value - 1));
  const inc = () => onSave(Math.min(max, value + 1));
  return (
    <span className="inline-flex items-center gap-1">
      <button onClick={dec} className="rounded border p-0.5 text-muted-foreground hover:bg-panel" aria-label="decrease"><Minus className="h-3 w-3" /></button>
      <span className="tnum w-8 text-center text-sm">{value || '—'}/{max}</span>
      <button onClick={inc} className="rounded border p-0.5 text-muted-foreground hover:bg-panel" aria-label="increase"><Plus className="h-3 w-3" /></button>
    </span>
  );
}
