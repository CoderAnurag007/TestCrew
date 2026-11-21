'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { AuthLayout, FormError } from '@/components/pages/auth-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

  const mutation = useMutation({
    mutationFn: authApi.register,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      router.replace('/dashboard');
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
      title="Create your account"
      description="Set up an account, then add your website and start your first audit."
      footer={
        <>
          Already have an account?{' '}
          <Link className="font-medium text-cobalt underline-offset-4 hover:underline" href="/login">
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
      </form>
    </AuthLayout>
  );
}
