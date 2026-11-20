'use client';

import { useEffect, useState } from 'react';
import { Download, FileText, ImageIcon, Maximize2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState, Skeleton } from '@/components/ui/premium';
import { runApi } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { isImageEvidence } from './run-utils';

/** Loads an evidence blob through the cookie-authenticated API and returns an object URL for it. */
function useEvidenceUrl(runId: string, evidenceId: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    void runApi.evidence(runId, evidenceId).then((blob) => {
      if (cancelled || !blob) {
        return;
      }
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [runId, evidenceId]);
  return url;
}

export function EvidenceImage({
  runId,
  evidenceId,
  alt = 'Evidence screenshot',
  className,
}: {
  runId: string;
  evidenceId: string;
  alt?: string;
  className?: string;
}) {
  const url = useEvidenceUrl(runId, evidenceId);
  if (!url) {
    return <Skeleton className={cn('h-40 w-full rounded-none', className)} />;
  }
  return <img src={url} alt={alt} className={cn('w-full bg-well object-contain', className)} />;
}

/** A screenshot thumbnail that opens a large view when clicked. */
export function EvidenceThumb({
  runId,
  evidenceId,
  caption,
  className,
}: {
  runId: string;
  evidenceId: string;
  caption?: string | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const label = caption ?? 'Screenshot';
  return (
    <>
      <figure
        className={cn(
          'group overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-[#cfd3d9]',
          className,
        )}
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="relative block w-full focus-visible:outline-offset-[-2px]"
          aria-label={`Enlarge ${label}`}
        >
          <EvidenceImage runId={runId} evidenceId={evidenceId} alt={label} className="max-h-64" />
          <span className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-md border border-border bg-card text-ink opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <Maximize2 className="size-3.5" />
          </span>
        </button>
        {caption ? (
          <figcaption className="mono truncate border-t border-border px-3 py-2 text-[12px] text-muted-foreground">{caption}</figcaption>
        ) : null}
      </figure>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-5xl overflow-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="pr-8 text-base">{label}</DialogTitle>
            <DialogDescription>Captured by the audit browser.</DialogDescription>
          </DialogHeader>
          {open ? (
            <EvidenceImage runId={runId} evidenceId={evidenceId} alt={label} className="rounded-md border border-border" />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function EvidenceLink({ runId, evidenceId, contentType }: { runId: string; evidenceId: string; contentType: string }) {
  const url = useEvidenceUrl(runId, evidenceId);
  if (!url) {
    return <span className="mono text-[12px] text-muted-foreground">{contentType}</span>;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium text-cobalt hover:bg-well"
    >
      <Download className="size-3.5" />
      Open
    </a>
  );
}

type EvidenceItem = { id: string; type: string; contentType: string; fileName?: string | null };

export function EvidenceGallery({ runId, items }: { runId: string; items: EvidenceItem[] }) {
  const images = items.filter(isImageEvidence);
  const files = items.filter((item) => !isImageEvidence(item));
  if (!items.length) {
    return (
      <EmptyState
        icon={ImageIcon}
        title="No evidence stored yet"
        description="Screenshots, logs and traces collected by the audit browser appear here."
      />
    );
  }
  return (
    <div className="space-y-8">
      {images.length > 0 ? (
        <section>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
            <ImageIcon className="size-4 text-muted-foreground" />
            Screenshots <span className="font-normal text-muted-foreground">({images.length})</span>
          </h3>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {images.slice(0, 80).map((item) => (
              <EvidenceThumb key={item.id} runId={runId} evidenceId={item.id} caption={item.fileName ?? item.type} />
            ))}
          </div>
          {images.length > 80 ? (
            <p className="mt-2 text-[13px] text-muted-foreground">Showing the first 80 of {images.length} screenshots.</p>
          ) : null}
        </section>
      ) : null}
      {files.length > 0 ? (
        <section>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
            <FileText className="size-4 text-muted-foreground" />
            Files <span className="font-normal text-muted-foreground">({files.length})</span>
          </h3>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {files.slice(0, 80).map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="rounded-[4px] bg-well px-1.5 py-0.5 text-[12px] font-medium text-muted-foreground">
                    {item.type}
                  </span>
                  <span className="mono truncate text-[12px] text-ink">{item.fileName ?? item.id}</span>
                </span>
                <EvidenceLink runId={runId} evidenceId={item.id} contentType={item.contentType} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
