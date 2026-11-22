'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { DEVICES, PLAN_ORDER, PLANS, type Device, type PlanId } from '@auditor/shared';
import { AppShell } from '@/components/layout/app-shell';
import { useSession } from '@/components/session-provider';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { track } from '@/lib/analytics';
import { planApi, type UsageView } from '@/lib/queries';
import { cn } from '@/lib/utils';

const CONTACT = 'mailto:hello@snaghunt.com?subject=Upgrade%20my%20Snaghunt%20plan';

function daysLeft(iso: string | null): number {
  if (!iso) return 0;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

export default function PlanPage() {
  const { currentOrg } = useSession();
  const orgId = currentOrg?.id;
  const usage = useQuery({
    queryKey: ['usage', orgId],
    queryFn: () => planApi.usage(orgId!),
    enabled: Boolean(orgId),
  });

  return (
    <AppShell>
      <header className="mb-8">
        <h1 className="text-[24px] font-semibold tracking-[-0.015em] text-ink">Plan and usage</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">
          {currentOrg ? `For the ${currentOrg.name} workspace.` : 'Loading your workspace…'}
        </p>
      </header>
      {usage.isLoading || !orgId ? <div className="shimmer h-48 rounded-lg" aria-label="Loading usage" /> : null}
      {usage.isError ? (
        <p className="text-sm text-danger" role="alert">
          Could not load your plan.
        </p>
      ) : null}
      {usage.data && orgId ? <PlanView orgId={orgId} usage={usage.data} /> : null}
    </AppShell>
  );
}

function PlanView({ orgId, usage }: { orgId: string; usage: UsageView }) {
  const queryClient = useQueryClient();
  const trial = usage.plan === 'FREE' && usage.effectivePlan !== 'FREE';
  const current = PLANS[usage.effectivePlan];
  const change = useMutation({
    mutationFn: (plan: PlanId) => {
      track('upgrade_clicked', { from: usage.effectivePlan, to: plan });
      return planApi.setPlan(orgId, plan);
    },
    onSuccess: async (data) => {
      queryClient.setQueryData(['usage', orgId], data);
      toast.success(`Switched to ${PLANS[data.plan].name}`);
    },
    onError: (error) =>
      toast.error(
        error instanceof ApiError && error.status === 404
          ? 'Online checkout is coming soon. Email us to upgrade.'
          : error instanceof ApiError
            ? error.message
            : 'Could not change the plan',
      ),
  });

  return (
    <div className="space-y-10">
      <section className="rounded-lg border border-border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[13px] text-muted-foreground">Current plan</p>
            <p className="mt-1 text-[22px] font-semibold text-ink">
              {current.name}
              {trial ? <span className="ml-2 text-[14px] font-medium text-cobalt">free trial · {daysLeft(usage.trialEndsAt)} days left</span> : null}
            </p>
            {trial ? (
              <p className="mt-1 text-[13px] text-muted-foreground">
                After the trial you move to Free (1 site, 3 audits a month) unless you choose a plan.
              </p>
            ) : null}
          </div>
          <p className="text-[13px] text-muted-foreground">
            Usage since {new Date(usage.periodStart).toLocaleDateString([], { day: 'numeric', month: 'long' })}
          </p>
        </div>

        <div className="mt-6 grid gap-5 sm:grid-cols-3">
          <Meter label="Sites" used={usage.sites} limit={usage.limits.sites} />
          <Meter label="Audits this month" used={usage.audits} limit={usage.limits.auditsPerMonth} />
          <Meter
            label="AI checks budget"
            used={Math.round((usage.aiSpendUsd / usage.limits.aiBudgetUsd) * 100)}
            limit={100}
            format={(used) => `${Math.min(used, 100)}% used`}
            hint="When it runs out, audits keep running with the built-in checks."
          />
        </div>

        <p className="mt-6 text-[13px] text-muted-foreground">
          Devices: {usage.limits.devices.map((device) => DEVICES[device as Device]?.label ?? device).join(', ')}
          {usage.limits.cadences.length ? ` · Scheduled audits: ${usage.limits.cadences.join(', ')}` : ' · No scheduled audits'}
        </p>
      </section>

      <section>
        <h2 className="text-[16px] font-semibold text-ink">Plans</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">Prices in USD per month. Pay yearly and save about 20%.</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {PLAN_ORDER.map((id) => {
            const plan = PLANS[id];
            const isCurrent = usage.plan === id && !trial;
            return (
              <div
                key={id}
                className={cn(
                  'flex flex-col rounded-lg border bg-card p-5',
                  id === 'AGENCY' ? 'border-ink' : 'border-border',
                )}
              >
                <p className="text-[15px] font-semibold text-ink">{plan.name}</p>
                <p className="mt-1 text-[13px] text-muted-foreground">{plan.tagline}</p>
                <p className="mt-4 text-[30px] font-semibold tabular-nums leading-none text-ink">
                  ${plan.priceUsd}
                  <span className="ml-1 text-[13px] font-normal text-muted-foreground">/month</span>
                </p>
                <p className="mt-1 h-4 text-[12px] text-muted-foreground">
                  {plan.priceUsd ? `$${plan.annualUsd}/month billed yearly · ₹${plan.priceInr.toLocaleString('en-IN')} in India` : ''}
                </p>
                <ul className="mt-5 flex-1 space-y-2">
                  {plan.highlights.map((item) => (
                    <li key={item} className="flex gap-2 text-[14px] text-ink">
                      <Check className="mt-0.5 size-4 shrink-0 text-[#1a7f37]" aria-hidden />
                      {item}
                    </li>
                  ))}
                </ul>
                <div className="mt-6">
                  {isCurrent ? (
                    <Button variant="outline" className="w-full" disabled>
                      Current plan
                    </Button>
                  ) : id === 'FREE' ? (
                    <Button variant="outline" className="w-full" disabled={change.isPending} onClick={() => change.mutate(id)}>
                      Switch to Free
                    </Button>
                  ) : (
                    <div className="space-y-2">
                      <Button className="w-full" disabled={change.isPending} onClick={() => change.mutate(id)}>
                        {change.isPending && change.variables === id ? <Loader2 className="animate-spin" /> : null}
                        Choose {plan.name}
                      </Button>
                      <a href={CONTACT} className="block text-center text-[12px] text-muted-foreground underline-offset-4 hover:underline">
                        or email us
                      </a>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function Meter({
  label,
  used,
  limit,
  format,
  hint,
}: {
  label: string;
  used: number;
  limit: number | null;
  format?: (used: number) => string;
  hint?: string;
}) {
  const share = limit ? Math.min(1, used / limit) : 0;
  const full = limit != null && used >= limit;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[13px] text-muted-foreground">{label}</p>
        <p className={cn('text-[14px] font-medium tabular-nums', full ? 'text-danger' : 'text-ink')}>
          {format ? format(used) : limit == null ? `${used} · unlimited` : `${used} of ${limit}`}
        </p>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-well" role="presentation">
        <div
          className={cn('h-full rounded-full transition-[width]', full ? 'bg-danger' : share > 0.8 ? 'bg-[#a85a00]' : 'bg-ink')}
          style={{ width: `${limit == null ? 0 : Math.max(share * 100, used ? 3 : 0)}%` }}
        />
      </div>
      {hint ? <p className="mt-1.5 text-[12px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
