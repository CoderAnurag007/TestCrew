'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { EmptyRow, SettingsSection } from '@/components/pages/settings-ui';
import { ApiError } from '@/lib/api';
import { projectApi } from '@/lib/queries';

export function HiddenFindingsCard({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const suppressions = useQuery({
    queryKey: ['suppressions', projectId],
    queryFn: () => projectApi.suppressions(projectId),
  });

  const unhide = useMutation({
    mutationFn: (suppressionId: string) => projectApi.deleteSuppression(projectId, suppressionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['suppressions', projectId] });
      toast.success('Finding will show again in future runs');
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not unhide finding'),
  });

  return (
    <SettingsSection
      title="Hidden findings"
      description={
        'Findings marked "Not a bug". They stay hidden in future runs until you unhide them.'
      }
    >
      {suppressions.isLoading ? (
        <div className="shimmer h-24 rounded-md" aria-label="Loading hidden findings" />
      ) : null}
      {suppressions.isError ? (
        <p className="text-sm text-danger" role="alert">
          Could not load hidden findings.
        </p>
      ) : null}
      {suppressions.data?.length ? (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {suppressions.data.map((item) => (
            <li key={item.id} className="flex items-center gap-3 bg-card px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-ink">{item.title}</div>
                <div className="mt-0.5 flex min-w-0 gap-x-3 text-xs text-muted-foreground">
                  {item.reason ? <span className="truncate">{item.reason}</span> : null}
                  <span className="shrink-0">
                    Hidden {new Date(item.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={unhide.isPending}
                aria-label={`Unhide ${item.title}`}
                onClick={() => unhide.mutate(item.id)}
              >
                <Eye />
                Unhide
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {suppressions.data && !suppressions.data.length && (
        <EmptyRow>
          No hidden findings. Findings you mark as &quot;Not a bug&quot; show up here.
        </EmptyRow>
      )}
    </SettingsSection>
  );
}
