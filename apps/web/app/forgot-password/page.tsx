'use client';

import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Loader2, MailCheck } from 'lucide-react';
import { AuthLayout, FormError } from '@/components/pages/auth-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { authApi } from '@/lib/queries';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: () => authApi.forgotPassword(email.trim()),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not send the link. Try again in a minute.'),
  });

  return (
    <AuthLayout
      title="Reset password"
      description="Enter the email you signed up with and we’ll send you a link to choose a new password."
      footer={
        <>
          Remembered it?{' '}
          <Link className="font-medium text-cobalt underline-offset-4 hover:underline" href="/login">
            Sign in
          </Link>
        </>
      }
    >
      {send.isSuccess ? (
        <div role="status" className="rounded-lg border border-border bg-card p-4">
          <p className="flex items-center gap-2 text-[15px] font-medium text-ink">
            <MailCheck className="size-4 text-success" aria-hidden /> Check your inbox
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            If an account exists for <span className="text-ink">{email.trim()}</span>, a reset link is on its way. It works for
            one hour. Not there in a few minutes? Check spam, or{' '}
            <button type="button" className="font-medium text-ink underline underline-offset-4" onClick={() => send.reset()}>
              try again
            </button>
            .
          </p>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            send.mutate();
          }}
        >
          <FormError message={error} />
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoFocus
            />
          </div>
          <Button className="w-full" size="lg" type="submit" disabled={send.isPending}>
            {send.isPending ? <Loader2 className="animate-spin" /> : null}
            {send.isPending ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
