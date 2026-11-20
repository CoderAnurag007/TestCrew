import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-[4px] border px-1.5 text-[12px] font-medium leading-none',
  {
    variants: {
      variant: {
        default: 'border-border bg-well text-ink',
        muted: 'border-transparent bg-well text-muted-foreground',
        outline: 'border-border bg-card text-ink',
        // Severity: one ramp, darkest = most severe.
        critical: 'border-[#c42b1c] bg-[#c42b1c] text-white',
        high: 'border-[#f2c4bf] bg-[#fdf1ef] text-[#a32418]',
        medium: 'border-[#f0d6b3] bg-[#fdf6ec] text-[#8a4a00]',
        low: 'border-border bg-well text-[#4a4f57]',
        // Status
        success: 'border-[#bfe3cc] bg-[#eef8f1] text-[#127a3e]',
        warning: 'border-[#f0d6b3] bg-[#fdf6ec] text-[#8a4a00]',
        info: 'border-[#c9d2f6] bg-[#f0f3fd] text-[#2445d6]',
        live: 'border-[#c9d2f6] bg-[#f0f3fd] text-[#2445d6]',
        new: 'border-[#c9d2f6] bg-[#f0f3fd] text-[#2445d6]',
        regressed: 'border-[#f2c4bf] bg-[#fdf1ef] text-[#a32418]',
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
