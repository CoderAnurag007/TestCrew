'use client';

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
import { ThemeProvider } from '@/components/theme';
import { ApiError } from '@/lib/api';

/**
 * When any request comes back 401 (the session expired or the API restarted),
 * re-check who is signed in. The session provider then sends the user to the
 * login page instead of leaving them on a screen where nothing works.
 */
function createClient(): QueryClient {
  let notified = false;
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => handleUnauthorized(error, query.queryKey[0] === 'me'),
    }),
    mutationCache: new MutationCache({
      onError: (error) => handleUnauthorized(error, false),
    }),
    defaultOptions: {
      queries: { retry: false, staleTime: 10_000, refetchOnWindowFocus: false },
    },
  });

  function handleUnauthorized(error: unknown, isSessionCheck: boolean) {
    if (!(error instanceof ApiError) || error.status !== 401 || isSessionCheck) {
      return;
    }
    if (!notified && typeof window !== 'undefined' && !['/login', '/register', '/', '/forgot-password', '/reset-password', '/verify-email'].includes(window.location.pathname)) {
      notified = true;
      toast.error('Your session ended. Please sign in again.');
      setTimeout(() => {
        notified = false;
      }, 5_000);
    }
    void client.resetQueries({ queryKey: ['me'] });
  }

  return client;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(createClient);

  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>
        {children}
        <Toaster />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
