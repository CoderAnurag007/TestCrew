'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { AuthLayout, FormError } from '@/components/pages/auth-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { track } from '@/lib/analytics';
import { authApi } from '@/lib/queries';
import { ApiError } from '@/lib/api';

const MIN_PASSWORD = 10;

export default function RegisterPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  // A free check to save into the new account (from /check/<token>).
  const [scan, setScan] = useState<string | null>(null);
  useEffect(() => {
    setScan(new URLSearchParams(window.location.search).get('scan'));
  }, []);

  const mutation = useMutation({
    mutationFn: authApi.register,
    onSuccess: async () => {
      track('signed_up', { via: scan ? 'free_check' : 'direct' });
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      // New accounts go through the welcome flow: add the site and start the first audit.
      router.replace(scan ? `/welcome?scan=${encodeURIComponent(scan)}` : '/welcome');
    },
    onError: (err) => {
      const message = err instanceof ApiError ? err.message : 'Unable to register';
      setError(message);
      toast.error(message);
    },
  });

  const shortPassword = password.length > 0 && password.length < MIN_PASSWORD;

  return (
    <AuthLayout
      title={scan ? 'Save your free check' : 'Create your account'}
      description={
        scan
          ? 'Create a free account to see every issue with its screenshot and fix. Your check is saved to it.'
          : 'Set up an account, then add your website and start your first audit.'
      }
      footer={
        <>
          Already have an account?{' '}
          <Link className="font-medium text-cobalt underline-offset-4 hover:underline" href={scan ? `/login?scan=${encodeURIComponent(scan)}` : '/login'}>
            Sign in
          </Link>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          mutation.mutate({ name, email, password });
        }}
      >
        <FormError message={error} />
        <div className="space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            autoComplete="name"
            placeholder="Ada Lovelace"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Work email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={shortPassword ? true : undefined}
            aria-describedby="password-help"
            required
          />
          <p
            id="password-help"
            className={shortPassword ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}
          >
            At least {MIN_PASSWORD} characters
            {shortPassword ? ` (${MIN_PASSWORD - password.length} more)` : ''}.
          </p>
        </div>
        <Button className="w-full" size="lg" type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? <Loader2 className="animate-spin" /> : null}
          {mutation.isPending ? 'Creating account…' : 'Create account'}
        </Button>
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          By creating an account you agree to the{' '}
          <Link href="/terms" className="text-ink underline underline-offset-4">
            Terms
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="text-ink underline underline-offset-4">
            Privacy Policy
          </Link>
          .
        </p>
      </form>
    </AuthLayout>
  );
}
