'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, ApiError } from '@/lib/api';
import type { ProjectDetail } from '@/lib/queries';
import { DIALOG_CLASS } from './create-project-dialog';
import { SettingsSection } from './settings-ui';

/**
 * Deletes the project. Uses the existing DELETE /projects/:id endpoint
 * directly because lib/queries has no wrapper for it yet.
 */
export function DangerZone({ project }: { project: ProjectDetail }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');

  const remove = useMutation({
    mutationFn: () => api<void>(`/projects/${project.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setOpen(false);
      queryClient.removeQueries({ queryKey: ['project', project.id] });
      queryClient.removeQueries({ queryKey: ['runs', project.id] });
      await queryClient.invalidateQueries({ queryKey: ['projects', project.organizationId] });
      await queryClient.invalidateQueries({ queryKey: ['stats', project.organizationId] });
      toast.success(`Deleted ${project.name}`);
      router.replace('/projects');
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not delete project'),
  });

  return (
    <SettingsSection
      titleId="danger-zone-title"
      title="Danger zone"
      description="Actions here cannot be undone."
    >
      <div className="flex flex-col gap-4 rounded-lg border border-[#f2c4bf] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-medium text-ink">Delete this project</div>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
            Removes the project with all its runs, findings, environments, credentials and tokens.
            This cannot be undone.
          </p>
        </div>
        <Button variant="destructive" className="shrink-0" onClick={() => setOpen(true)}>
          <Trash2 />
          Delete project
        </Button>
      </div>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setConfirm('');
        }}
      >
        <DialogContent className={DIALOG_CLASS}>
          <DialogHeader>
            <DialogTitle>Delete {project.name}?</DialogTitle>
            <DialogDescription>
              All runs, findings, evidence, credentials and CI tokens for this project are deleted
              permanently. CI jobs using its tokens will stop working.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (confirm === project.name) remove.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="confirm-delete">
                Type{' '}
                <span className="mono rounded-[4px] bg-well px-1.5 py-0.5 text-xs">
                  {project.name}
                </span>{' '}
                to confirm
              </Label>
              <Input
                id="confirm-delete"
                autoComplete="off"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
              />
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="submit"
                variant="destructive"
                disabled={confirm !== project.name || remove.isPending}
              >
                {remove.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
                {remove.isPending ? 'Deleting…' : 'Delete permanently'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}
