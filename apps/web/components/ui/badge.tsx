import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary/15 text-primary',
        muted: 'border-transparent bg-muted text-muted-foreground',
        outline: 'text-foreground',
        critical: 'border-transparent bg-red-500/15 text-red-600 dark:text-red-400',
        high: 'border-transparent bg-orange-500/15 text-orange-600 dark:text-orange-400',
        success: 'border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
