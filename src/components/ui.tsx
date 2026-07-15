// Compact shadcn-style primitives styled to the Compass (Attio) design tokens.
// Kept in one module to keep the component surface small and consistent.
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as SelectPrimitive from '@radix-ui/react-select';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as SliderPrimitive from '@radix-ui/react-slider';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import { Check, ChevronDown, X } from 'lucide-react';
import { cn, initials, type HealthBand } from '@/lib/utils';

// ── Button ───────────────────────────────────────────────────────────────────
type BtnVariant = 'default' | 'primary' | 'ghost' | 'outline' | 'destructive';
type BtnSize = 'sm' | 'md' | 'icon';
const btnVariants: Record<BtnVariant, string> = {
  default: 'bg-white border text-foreground hover:bg-panel',
  primary: 'bg-accent text-white hover:opacity-90 border border-transparent',
  ghost: 'text-foreground hover:bg-panel border border-transparent',
  outline: 'bg-white border text-foreground hover:bg-panel',
  destructive: 'bg-[var(--red)] text-white hover:opacity-90 border border-transparent',
};
const btnSizes: Record<BtnSize, string> = {
  sm: 'h-7 px-2 text-sm gap-1',
  md: 'h-8 px-3 text-base gap-1.5',
  icon: 'h-7 w-7 p-0 justify-center',
};
export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: BtnSize }
>(({ className, variant = 'default', size = 'md', ...props }, ref) => (
  <button
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
      btnVariants[variant],
      btnSizes[size],
      className
    )}
    {...props}
  />
));
Button.displayName = 'Button';

// ── Card ─────────────────────────────────────────────────────────────────────
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border bg-white', className)} {...props} />;
}
export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center justify-between px-4 py-3 border-b', className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('text-md font-semibold', className)} {...props} />;
}
export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4', className)} {...props} />;
}

// ── Chip / Badge ───────────────────────────────────────────────────────────────
export function Chip({
  className,
  tone = 'neutral',
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: 'neutral' | 'green' | 'amber' | 'red' | 'accent' }) {
  const tones = {
    neutral: 'bg-panel text-muted-foreground border-transparent',
    green: 'bg-[var(--green-tint)] text-[var(--green)] border-transparent',
    amber: 'bg-[var(--amber-tint)] text-[var(--amber)] border-transparent',
    red: 'bg-[var(--red-tint)] text-[var(--red)] border-transparent',
    accent: 'bg-[var(--accent-tint)] text-[var(--accent)] border-transparent',
  };
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-sm font-medium tnum', tones[tone], className)} {...props}>
      {children}
    </span>
  );
}

// ── Input ─────────────────────────────────────────────────────────────────────
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn('h-8 w-full rounded-md border bg-white px-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-[var(--accent)]', className)}
      {...props}
    />
  )
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn('w-full rounded-md border bg-white px-2 py-1.5 text-base outline-none placeholder:text-muted-foreground focus-visible:border-[var(--accent)]', className)} {...props} />
  )
);
Textarea.displayName = 'Textarea';

// ── Dialog ────────────────────────────────────────────────────────────────────
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export function DialogContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/20 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=open]:fade-in" />
      <DialogPrimitive.Content
        className={cn('fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-white p-4 shadow-popover focus:outline-none', className)}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-3 top-3 rounded p-1 text-muted-foreground hover:bg-panel">
          <X className="h-4 w-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

// ── Slide-over (right sheet) ────────────────────────────────────────────────────
export function Sheet({ open, onOpenChange, children }: { open: boolean; onOpenChange: (o: boolean) => void; children: React.ReactNode }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/20" />
        <DialogPrimitive.Content className="fixed right-0 top-0 z-50 h-full w-[440px] max-w-[92vw] border-l bg-white shadow-popover focus:outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right">
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ── Popover ──────────────────────────────────────────────────────────────────
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export function PopoverContent({ className, align = 'start', ...props }: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content align={align} sideOffset={4} className={cn('z-50 min-w-[180px] rounded-lg border bg-white p-1 shadow-popover focus:outline-none', className)} {...props} />
    </PopoverPrimitive.Portal>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
export const Tabs = TabsPrimitive.Root;
export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn('flex items-center gap-0.5 border-b overflow-x-auto', className)} {...props} />;
}
export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'relative whitespace-nowrap px-2.5 py-1.5 text-base font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=active]:text-foreground data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:-bottom-px data-[state=active]:after:h-0.5 data-[state=active]:after:bg-[var(--accent)]',
        className
      )}
      {...props}
    />
  );
}
export const TabsContent = TabsPrimitive.Content;

// ── Tooltip ──────────────────────────────────────────────────────────────────
export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <TooltipPrimitive.Provider delayDuration={200}>{children}</TooltipPrimitive.Provider>;
}
export function Tooltip({ content, children }: { content: React.ReactNode; children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content sideOffset={4} className="z-50 max-w-xs rounded-md border bg-white px-2 py-1 text-sm shadow-popover">
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

// ── Select ────────────────────────────────────────────────────────────────────
export const Select = SelectPrimitive.Root;
export function SelectTrigger({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger className={cn('inline-flex h-8 items-center justify-between gap-1 rounded-md border bg-white px-2 text-base outline-none focus-visible:border-[var(--accent)]', className)} {...props}>
      {children}
      <SelectPrimitive.Icon><ChevronDown className="h-3.5 w-3.5 opacity-60" /></SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}
export function SelectValue(props: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value {...props} />;
}
export function SelectContent({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content position="popper" sideOffset={4} className={cn('z-50 min-w-[160px] rounded-lg border bg-white p-1 shadow-popover', className)} {...props}>
        <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}
export function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item className={cn('relative flex cursor-pointer select-none items-center rounded px-2 py-1.5 pr-7 text-base outline-none data-[highlighted]:bg-panel', className)} {...props}>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2"><Check className="h-3.5 w-3.5" /></SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

// ── Switch ───────────────────────────────────────────────────────────────────
export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root className={cn('peer inline-flex h-4.5 w-8 shrink-0 cursor-pointer items-center rounded-full border transition-colors data-[state=checked]:bg-[var(--accent)] data-[state=unchecked]:bg-[#e4e7ec]', className)} style={{ height: 18, width: 32 }} {...props}>
      <SwitchPrimitive.Thumb className="pointer-events-none block h-3.5 w-3.5 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[15px]" />
    </SwitchPrimitive.Root>
  );
}

// ── Slider ───────────────────────────────────────────────────────────────────
export function Slider({ className, ...props }: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root className={cn('relative flex w-full touch-none select-none items-center', className)} {...props}>
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-[#e4e7ec]">
        <SliderPrimitive.Range className="absolute h-full bg-[var(--accent)]" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="block h-3.5 w-3.5 rounded-full border border-[var(--accent)] bg-white shadow-sm focus:outline-none" />
    </SliderPrimitive.Root>
  );
}

// ── Avatar ───────────────────────────────────────────────────────────────────
export function Avatar({ name, url, className }: { name?: string | null; url?: string | null; className?: string }) {
  return (
    <AvatarPrimitive.Root className={cn('inline-flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-[var(--accent-tint)] text-xs font-semibold text-[var(--accent)]', className)}>
      {url && <AvatarPrimitive.Image src={url} className="h-full w-full object-cover" />}
      <AvatarPrimitive.Fallback>{initials(name)}</AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

// ── Progress ──────────────────────────────────────────────────────────────────
export function Progress({ value, className, tone = 'accent' }: { value: number; className?: string; tone?: 'accent' | 'green' | 'amber' | 'red' }) {
  const color = tone === 'green' ? 'var(--green)' : tone === 'amber' ? 'var(--amber)' : tone === 'red' ? 'var(--red)' : 'var(--accent)';
  return (
    <ProgressPrimitive.Root className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-[#eef0f3]', className)}>
      <ProgressPrimitive.Indicator className="h-full transition-all" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} />
    </ProgressPrimitive.Root>
  );
}

// ── ScrollArea ──────────────────────────────────────────────────────────────────
export function ScrollArea({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <ScrollAreaPrimitive.Root className={cn('overflow-hidden', className)}>
      <ScrollAreaPrimitive.Viewport className="h-full w-full">{children}</ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar orientation="vertical" className="flex w-2 touch-none select-none p-0.5">
        <ScrollAreaPrimitive.Thumb className="flex-1 rounded-full bg-[#e4e7ec]" />
      </ScrollAreaPrimitive.Scrollbar>
    </ScrollAreaPrimitive.Root>
  );
}

// ── Skeleton / EmptyState ───────────────────────────────────────────────────────
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-[#f1f3f5]', className)} />;
}
export function EmptyState({ icon: Icon, title, hint, action }: { icon?: React.ComponentType<{ className?: string }>; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-12 text-center">
      {Icon && <Icon className="h-6 w-6 text-muted-foreground" />}
      <div className="text-base font-medium">{title}</div>
      {hint && <div className="max-w-sm text-sm text-muted-foreground">{hint}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

// ── Health dot / chip / delta arrow ───────────────────────────────────────────
export function HealthDot({ band, className }: { band: HealthBand | null; className?: string }) {
  const color = band === 'green' ? 'var(--green)' : band === 'amber' ? 'var(--amber)' : band === 'red' ? 'var(--red)' : '#d0d5dd';
  return <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', className)} style={{ background: color }} />;
}
export function HealthChip({ score, band, delta }: { score: number | null; band: HealthBand | null; delta?: number | null }) {
  const tone = band ?? 'neutral';
  return (
    <span className="inline-flex items-center gap-1.5">
      <Chip tone={tone as 'green' | 'amber' | 'red' | 'neutral'}>
        <HealthDot band={band} />
        <span className="tnum">{score ?? '—'}</span>
      </Chip>
      {delta != null && delta !== 0 && <DeltaArrow delta={delta} />}
    </span>
  );
}
export function DeltaArrow({ delta }: { delta: number }) {
  const up = delta > 0;
  return (
    <span className={cn('inline-flex items-center text-sm font-medium tnum', up ? 'text-[var(--green)]' : 'text-[var(--red)]')}>
      {up ? '▲' : '▼'} {Math.abs(delta).toFixed(0)}
    </span>
  );
}

// ── Segment badge ────────────────────────────────────────────────────────────
export function SegmentBadge({ segment }: { segment?: string | null }) {
  if (!segment) return <span className="text-muted-foreground">—</span>;
  const label = segment === 'mid_touch' ? 'Mid-touch' : segment.charAt(0).toUpperCase() + segment.slice(1);
  return <Chip tone="neutral">{label}</Chip>;
}
