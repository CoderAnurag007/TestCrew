'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Radar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authApi } from '@/lib/queries';
import { ApiError } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const mutation = useMutation({
    mutationFn: authApi.login,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      router.replace('/dashboard');
      router.refresh();
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : 'Unable to sign in');
    },
  });

  return (
    <div className="command-grid flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-3 flex size-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Radar className="size-5" />
          </div>
          <CardTitle className="text-xl">Sign in to Auditor</CardTitle>
          <CardDescription>Inspect application quality from a single control plane.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              mutation.mutate({ email, password });
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button className="w-full" type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
          <p className="mt-4 text-sm text-muted-foreground">
            No account?{' '}
            <Link className="text-primary underline-offset-4 hover:underline" href="/register">
              Create one
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
