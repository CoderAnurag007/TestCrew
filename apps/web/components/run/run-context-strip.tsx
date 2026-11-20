import { CreditCard, FlaskConical, Globe, LayoutGrid, ShieldAlert, ShieldCheck, ShoppingCart } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/* Environment, app category and transaction permissions for a run. Renders nothing on older runs. */

type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Rec) : null;
const str = (value: unknown): string | undefined => (typeof value === 'string' && value.length ? value : undefined);

const CATEGORY_LABEL: Record<string, string> = {
  ecommerce: 'E-commerce',
  saas: 'SaaS / dashboard',
  booking: 'Booking',
  tools: 'Online tools',
  content: 'Content / media',
  generic: 'Generic',
};

export function RunContextStrip({ payload, className }: { payload: Rec; className?: string }) {
  const environment = rec(payload.environment);
  const category = rec(payload.category);
  if (!environment && !category) {
    return null;
  }
  const kind = str(environment?.kind);
  const mode = str(environment?.mode);
  const detected = str(category?.detected);
  const used = str(category?.used);
  const signals = Array.isArray(category?.signals)
    ? category.signals.filter((item): item is string => typeof item === 'string')
    : [];

  return (
    <section
      aria-label="Run context"
      className={cn(
        'grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 xl:grid-cols-4',
        className,
      )}
    >
      {environment ? (
        <Cell icon={kind === 'STAGING' ? FlaskConical : Globe} label="Environment">
          <div className="flex flex-wrap items-center gap-1.5">
            {kind ? (
              <Badge variant="outline">{kind === 'STAGING' ? 'Staging' : 'Production'}</Badge>
            ) : null}
            {mode ? (
              <Badge variant={mode === 'FULL' ? 'warning' : 'success'}>
                {mode === 'FULL' ? <ShieldAlert className="size-3" aria-hidden /> : <ShieldCheck className="size-3" aria-hidden />}
                {mode === 'FULL' ? 'Full functional' : 'Read-only'}
              </Badge>
            ) : null}
          </div>
        </Cell>
      ) : null}
      {category ? (
        <Cell icon={LayoutGrid} label="App category">
          <p className="text-sm font-medium text-ink">
            {used ? (CATEGORY_LABEL[used] ?? used) : 'Unknown'}
            {detected && used && detected !== used ? (
              <span className="font-normal text-muted-foreground"> (detected {CATEGORY_LABEL[detected] ?? detected})</span>
            ) : detected && used ? (
              <span className="font-normal text-muted-foreground"> (detected)</span>
            ) : null}
          </p>
          {signals.length ? (
            <p className="mt-0.5 line-clamp-2 text-[13px] text-muted-foreground" title={signals.join(', ')}>
              {signals.slice(0, 4).join(', ')}
              {signals.length > 4 ? ` and ${signals.length - 4} more` : ''}
            </p>
          ) : null}
        </Cell>
      ) : null}
      {environment ? (
        <>
          <Permission
            icon={ShoppingCart}
            label="Orders and bookings"
            allowed={environment.transactionsAllowed === true}
            reason={str(environment.transactionsReason)}
          />
          <Permission
            icon={CreditCard}
            label="Payments"
            allowed={environment.paymentAllowed === true}
            reason={str(environment.paymentReason)}
          />
        </>
      ) : null}
    </section>
  );
}

function Cell({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Globe;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 bg-card px-4 py-3.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </div>
      {children}
    </div>
  );
}

function Permission({
  icon,
  label,
  allowed,
  reason,
}: {
  icon: typeof Globe;
  label: string;
  allowed: boolean;
  reason?: string;
}) {
  return (
    <Cell icon={icon} label={label}>
      <Badge variant={allowed ? 'warning' : 'muted'}>{allowed ? 'Allowed' : 'Not allowed'}</Badge>
      {reason ? <p className="mt-1 break-words text-[13px] leading-relaxed text-muted-foreground">{reason}</p> : null}
    </Cell>
  );
}
