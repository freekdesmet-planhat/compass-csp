import type { ReactNode } from 'react';

export function PageHeader({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="sticky top-0 z-10 border-b bg-white/85 px-6 py-3 backdrop-blur">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="page-title">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function PageBody({ children }: { children: ReactNode }) {
  return <div className="px-6 py-4">{children}</div>;
}
