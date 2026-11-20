'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PLANS } from '@auditor/shared';
import { useSession } from '@/components/session-provider';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PLAN_LIMIT_EVENT } from '@/lib/api';
import { planApi } from '@/lib/queries';

/** "Pro trial: 9 days left" line for the sidebar. */
export function TrialNotice() {
  const { currentOrg } = useSession();
  const usage = useQuery({
    queryKey: ['usage', currentOrg?.id],
    queryFn: () => planApi.usage(currentOrg!.id),
    enabled: Boolean(currentOrg?.id),
    staleTime: 60_000,
  });
  if (!usage.data) return null;
  const trial = usage.data.plan === 'FREE' && usage.data.effectivePlan !== 'FREE' && usage.data.trialEndsAt;
  const label = trial
    ? `${PLANS[usage.data.effectivePlan].name} trial · ${Math.max(0, Math.ceil((new Date(usage.data.trialEndsAt!).getTime() - Date.now()) / 86_400_000))} days left`
    : `${PLANS[usage.data.effectivePlan].name} plan`;
  return (
    <Link
      href="/plan"
      className="flex h-8 items-center justify-between gap-2 rounded-md px-2.5 text-[13px] text-[#3d4148] hover:bg-[#e9ebed] hover:text-ink"
    >
      <span className="truncate">{label}</span>
      {usage.data.plan === 'FREE' ? <span className="shrink-0 font-medium text-cobalt">Upgrade</span> : null}
    </Link>
  );
}

/** Opens when the API says a plan limit was reached. */
export function PlanLimitDialog() {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const onLimit = (event: Event) => setMessage((event as CustomEvent<string>).detail);
    window.addEventListener(PLAN_LIMIT_EVENT, onLimit);
    return () => window.removeEventListener(PLAN_LIMIT_EVENT, onLimit);
  }, []);
  return (
    <Dialog open={Boolean(message)} onOpenChange={(open) => (open ? null : setMessage(null))}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>That needs a bigger plan</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setMessage(null)}>
            Not now
          </Button>
          <Button asChild onClick={() => setMessage(null)}>
            <Link href="/plan">See plans</Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
