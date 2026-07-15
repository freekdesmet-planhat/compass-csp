import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';

interface Toast {
  id: number;
  message: string;
  tone: 'success' | 'error' | 'info';
  action?: { label: string; onClick: () => void };
}

interface ToastCtx {
  toast: (message: string, opts?: { tone?: Toast['tone']; action?: Toast['action'] }) => void;
}

const Ctx = createContext<ToastCtx | null>(null);
let seq = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const toast = useCallback<ToastCtx['toast']>((message, opts) => {
    const id = seq++;
    setToasts((t) => [...t, { id, message, tone: opts?.tone ?? 'success', action: opts?.action }]);
    setTimeout(() => dismiss(id), 5000);
  }, [dismiss]);

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={cn('flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-base shadow-popover', 'min-w-[240px] max-w-sm')}>
            {t.tone === 'success' && <CheckCircle2 className="h-4 w-4 text-[var(--green)]" />}
            {t.tone === 'error' && <AlertCircle className="h-4 w-4 text-[var(--red)]" />}
            <span className="flex-1">{t.message}</span>
            {t.action && (
              <button className="font-medium text-[var(--accent)]" onClick={() => { t.action!.onClick(); dismiss(t.id); }}>
                {t.action.label}
              </button>
            )}
            <button onClick={() => dismiss(t.id)} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
