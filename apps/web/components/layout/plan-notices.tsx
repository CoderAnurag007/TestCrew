'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PLANS } from '@auditor/shared';
import { useSession } from '@/components/session-provider';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PLAN_LIMIT_EVENT } from '@/lib/api';
import { authApi, planApi } from '@/lib/queries';
import { toast } from 'sonner';

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

/** Asks a new user to confirm their email, with a button to send the link again. */
export function VerifyEmailBanner() {
  const { user } = useSession();
  const resend = useMutation({
    mutationFn: authApi.resendVerification,
    onSuccess: (result) =>
      toast.success(result.alreadyVerified ? 'Your email is already confirmed' : `Sent a new link to ${user?.email}`),
    onError: () => toast.error('Could not send the link. Try again in a minute.'),
  });
  if (!user || user.emailVerified !== false) return null;
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-sm text-ink">
        <span className="font-medium">Confirm your email.</span>{' '}
        <span className="text-muted-foreground">
          We sent a link to {user.email}, so audit results and alerts can reach you.
        </span>
      </p>
      <Button size="sm" variant="outline" disabled={resend.isPending || resend.isSuccess} onClick={() => resend.mutate()}>
        {resend.isSuccess ? 'Link sent' : 'Send it again'}
      </Button>
    </div>
  );
}
