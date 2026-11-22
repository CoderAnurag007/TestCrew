'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Loader2, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { CopyButton } from '@/components/copy-button';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { track } from '@/lib/analytics';
import { ApiError } from '@/lib/api';
import { launchApi } from '@/lib/queries';

/** Makes a read-only link to the report that works without signing in. */
export function ShareButton({ runId, projectId, shareToken }: { runId: string; projectId: string; shareToken?: string | null }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const link = shareToken ? `${origin}/r/${shareToken}` : null;

  const share = useMutation({
    mutationFn: () => launchApi.share(runId),
    onSuccess: async () => {
      track('share_link_created');
      await queryClient.invalidateQueries({ queryKey: ['run', runId] });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not create the link'),
  });
  const unshare = useMutation({
    mutationFn: () => launchApi.unshare(runId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['run', runId] });
      toast.success('The link no longer works');
      setOpen(false);
    },
    onError: () => toast.error('Could not stop sharing'),
  });

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true);
          if (!shareToken) share.mutate();
        }}
      >
        <Share2 />
        Share
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Share this report</DialogTitle>
            <DialogDescription>
              Anyone with the link can read the findings and their screenshots, without signing in. Bugs you marked
              “Not a bug” or Ignored are left out.
            </DialogDescription>
          </DialogHeader>
          {link ? (
            <div className="space-y-4">
              <div className="flex gap-2">
                <Input readOnly value={link} aria-label="Share link" onFocus={(event) => event.currentTarget.select()} />
                <CopyButton value={link} label="Copy link" />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" asChild>
                    <a href={link} target="_blank" rel="noreferrer">
                      <ExternalLink /> Preview
                    </a>
                  </Button>
                  <Button size="sm" variant="ghost" asChild>
                    <Link href={`/projects/${projectId}/settings?tab=integrations`}>Add your logo</Link>
                  </Button>
                </div>
                <Button size="sm" variant="ghost" disabled={unshare.isPending} onClick={() => unshare.mutate()}>
                  {unshare.isPending ? <Loader2 className="animate-spin" /> : null}
                  Stop sharing
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Creating link…
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
