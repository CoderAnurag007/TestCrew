'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useSession } from '@/components/session-provider';
import { ApiError } from '@/lib/api';
import { orgApi } from '@/lib/queries';

/**
 * New accounts have no workspace yet. This creates "<First name>'s workspace"
 * once the session and the (empty) workspace list have loaded, so the first
 * thing a new user does is add their site. Returns the workspace to use.
 */
export function useEnsureWorkspace() {
  const { user, isLoading, currentOrg, setCurrentOrgId } = useSession();
  const queryClient = useQueryClient();
  const orgList = useQuery({ queryKey: ['organizations'], queryFn: orgApi.list, enabled: Boolean(user) });

  const create = useMutation({
    mutationFn: orgApi.create,
    onSuccess: async (org) => {
      setCurrentOrgId(org.id);
      await queryClient.invalidateQueries({ queryKey: ['organizations'] });
      await queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not create your workspace'),
  });

  const started = useRef(false);
  useEffect(() => {
    if (isLoading || !user || started.current || !orgList.isSuccess || orgList.data.length > 0) return;
    started.current = true;
    const first = user.name?.trim().split(/\s+/)[0];
    create.mutate({ name: first ? `${first}'s workspace` : 'My workspace' });
  }, [isLoading, user, orgList.isSuccess, orgList.data, create]);

  return {
    workspace: currentOrg,
    creating: create.isPending,
    failed: create.isError,
  };
}
