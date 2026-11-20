'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn('shrink-0', copied && 'text-success hover:text-success')}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error('Could not copy to the clipboard');
        }
      }}
    >
      {copied ? <Check /> : <Copy />}
      <span aria-live="polite">{copied ? 'Copied' : label}</span>
    </Button>
  );
}

export function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[13px] text-muted-foreground">{label}</div>
      <div className="flex items-center gap-2">
        <code className="mono flex h-8 min-w-0 flex-1 items-center truncate rounded-md border border-border bg-well px-3 text-xs text-ink">
          <span className="truncate">{value}</span>
        </code>
        <CopyButton value={value} />
      </div>
    </div>
  );
}
