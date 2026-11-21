import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { cn } from '@/lib/utils';

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export function DropdownMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        className={cn(
          'z-50 min-w-48 rounded-lg border bg-popover p-1 text-popover-foreground shadow-[var(--shadow-float)]',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        'flex cursor-pointer items-center rounded-[4px] px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-well',
        className,
      )}
      {...props}
    />
  );
}

/** A menu row with a tick box; the menu stays open so several can be changed. */
export function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      checked={checked}
      onSelect={(event) => event.preventDefault()}
      className={cn(
        'flex cursor-pointer items-start gap-2.5 rounded-[4px] px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-well data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border',
          checked ? 'border-ink bg-ink text-white' : 'border-[#c4c7cc] bg-card',
        )}
      >
        <DropdownMenuPrimitive.ItemIndicator>
          <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2.5 6.5l2.2 2.2 4.8-5" />
          </svg>
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn('px-2 py-1.5 text-xs font-medium text-muted-foreground', className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return <DropdownMenuPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
}
