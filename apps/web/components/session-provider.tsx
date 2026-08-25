'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { authApi, orgApi } from '@/lib/queries';
import type { Organization, SessionUser } from '@auditor/shared';

const ORG_KEY = 'auditor.organizationId';

interface SessionContextValue {
  user: SessionUser | undefined;
  isLoading: boolean;
  organizations: Organization[];
  currentOrg: Organization | undefined;
  setCurrentOrgId: (id: string) => void;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [orgId, setOrgId] = useState<string | undefined>(undefined);

  const me = useQuery({
    queryKey: ['me'],
    queryFn: authApi.me,
    retry: false,
  });

  const orgs = useQuery({
    queryKey: ['organizations'],
    queryFn: orgApi.list,
    enabled: Boolean(me.data),
  });

  useEffect(() => {
    const stored = window.localStorage.getItem(ORG_KEY) ?? undefined;
    setOrgId(stored);
  }, []);

  useEffect(() => {
    const isLanding = pathname === '/';
    const isAuthForm = pathname === '/login' || pathname === '/register';
    const publicPath = isLanding || isAuthForm;
    if (me.isLoading) {
      return;
    }
    if (!me.data && !publicPath) {
      router.replace('/login');
    }
    // Keep marketing `/` reachable when signed in; only bounce auth forms.
    if (me.data && isAuthForm) {
      router.replace('/dashboard');
    }
  }, [me.data, me.isLoading, pathname, router]);

  const currentOrg = useMemo(() => {
    const list = orgs.data ?? [];
    return list.find((org) => org.id === orgId) ?? list[0];
  }, [orgs.data, orgId]);

  const logoutMutation = useMutation({
    mutationFn: authApi.logout,
    onSuccess: async () => {
      await queryClient.clear();
      router.replace('/login');
    },
  });

  const value: SessionContextValue = {
    user: me.data,
    isLoading: me.isLoading,
    organizations: orgs.data ?? [],
    currentOrg,
    setCurrentOrgId: (id: string) => {
      window.localStorage.setItem(ORG_KEY, id);
      setOrgId(id);
    },
    logout: () => logoutMutation.mutateAsync(),
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within SessionProvider');
  }
  return context;
}
