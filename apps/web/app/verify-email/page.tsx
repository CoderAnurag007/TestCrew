'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Suspense, useEffect, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, Loader2 } from 'lucide-react';
import { AuthLayout } from '@/components/pages/auth-layout';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { authApi } from '@/lib/queries';

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmail />
    </Suspense>
  );
}

function VerifyEmail() {
  const token = useSearchParams().get('token') ?? '';
  const queryClient = useQueryClient();
  const [state, setState] = useState<{ status: 'working' | 'done' | 'failed'; message?: string }>({ status: 'working' });
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    if (!token) {
      setState({ status: 'failed', message: 'This page needs the link from your confirmation email.' });
      return;
    }
    authApi
      .verifyEmail(token)
      .then(async () => {
        setState({ status: 'done' });
        await queryClient.invalidateQueries({ queryKey: ['me'] });
      })
      .catch((error) =>
        setState({ status: 'failed', message: error instanceof ApiError ? error.message : 'Could not confirm your email.' }),
      );
  }, [token, queryClient]);

  return (
    <AuthLayout
      title="Confirm email"
      description="One click, and your audit results and alerts can reach you."
      footer={
        <>
          Need help? Write to{' '}
          <a className="font-medium text-cobalt underline-offset-4 hover:underline" href="mailto:hello@snaghunt.com">
            hello@snaghunt.com
          </a>
        </>
      }
    >
      <div role="status" className="rounded-lg border border-border bg-card p-4">
        {state.status === 'working' ? (
          <p className="flex items-center gap-2 text-[15px] text-ink">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Confirming…
          </p>
        ) : state.status === 'done' ? (
          <>
            <p className="flex items-center gap-2 text-[15px] font-medium text-ink">
              <CircleCheck className="size-4 text-success" aria-hidden /> Email confirmed
            </p>
            <Button asChild className="mt-4 w-full" size="lg">
              <Link href="/dashboard">Go to your dashboard</Link>
            </Button>
          </>
        ) : (
          <>
            <p className="flex items-center gap-2 text-[15px] font-medium text-ink">
              <CircleAlert className="size-4 text-danger" aria-hidden /> Not confirmed
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{state.message}</p>
            <Button asChild variant="outline" className="mt-4 w-full" size="lg">
              <Link href="/dashboard">Sign in to send a new link</Link>
            </Button>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
