import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Native select styled like Input. Keeps full keyboard and screen-reader support for free. */
export function NativeSelect({
  className,
  wrapperClassName,
  size = 'default',
  ...props
}: Omit<React.ComponentProps<'select'>, 'size'> & { wrapperClassName?: string; size?: 'default' | 'sm' }) {
  return (
    <div className={cn('relative min-w-0', wrapperClassName)}>
      <select
        className={cn(
          'w-full min-w-0 cursor-pointer appearance-none truncate rounded-md border border-input bg-card pl-3 pr-9 text-sm text-foreground outline-none transition-colors hover:border-[#b9bdc4] focus-visible:border-cobalt focus-visible:ring-[3px] focus-visible:ring-cobalt/15 disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-destructive',
          size === 'sm' ? 'h-8 pl-2.5 pr-8 text-xs' : 'h-9',
          className,
        )}
        {...props}
      />
      <ChevronDown
        aria-hidden
        className={cn(
          'pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground',
          size === 'sm' ? 'right-2.5 size-3.5' : 'right-3 size-4',
        )}
      />
    </div>
  );
}
