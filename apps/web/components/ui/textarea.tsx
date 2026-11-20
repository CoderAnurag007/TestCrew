import * as React from 'react';
import { cn } from '@/lib/utils';

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'flex min-h-24 w-full rounded-md border border-input bg-card px-3 py-2 text-sm leading-relaxed outline-none transition-colors placeholder:text-[#8a8f97] hover:border-[#b9bdc4] focus-visible:border-cobalt focus-visible:ring-[3px] focus-visible:ring-cobalt/15 disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      {...props}
    />
  );
}
