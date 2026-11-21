'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Suspense, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { AuthLayout, FormError } from '@/components/pages/auth-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { authApi } from '@/lib/queries';

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const reset = useMutation({
    mutationFn: () => authApi.resetPassword({ token, password }),
    // Every session ended with the reset, including this browser's: forget it before signing in again.
    onSuccess: () => {
      queryClient.clear();
      router.replace('/login?reset=1');
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not reset the password. Try again.'),
  });

  const footer = (
    <>
      Link expired?{' '}
      <Link className="font-medium text-cobalt underline-offset-4 hover:underline" href="/forgot-password">
        Send a new one
      </Link>
    </>
  );

  if (!token) {
    return (
      <AuthLayout title="Reset password" description="This page needs the link from your reset email." footer={footer}>
        <Button asChild className="w-full" size="lg">
          <Link href="/forgot-password">Send me a reset link</Link>
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="New password"
      description="Choose a new password. Every browser signed in to your account will be signed out."
      footer={footer}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          if (password.length < 10) return setError('Use at least 10 characters.');
          if (password !== confirm) return setError('The two passwords don’t match.');
          reset.mutate();
        }}
      >
        <FormError message={error} />
        <div className="space-y-1.5">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            minLength={10}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            autoFocus
          />
          <p className="text-[12px] text-muted-foreground">At least 10 characters.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm">Type it again</Label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            required
          />
        </div>
        <Button className="w-full" size="lg" type="submit" disabled={reset.isPending}>
          {reset.isPending ? <Loader2 className="animate-spin" /> : null}
          {reset.isPending ? 'Saving…' : 'Save new password'}
        </Button>
      </form>
    </AuthLayout>
  );
}
