import * as React from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm outline-none transition-colors placeholder:text-[#8a8f97] hover:border-[#b9bdc4] focus-visible:border-cobalt focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-cobalt/15 disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-destructive',
        className,
      )}
      {...props}
    />
  );
}
