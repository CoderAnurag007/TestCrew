import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * One settings section: heading and a line of help on the left, fields on the
 * right at lg widths, stacked on small screens. Sibling sections are separated
 * by a rule.
 */
export function SettingsSection({
  title,
  titleId,
  description,
  descriptionId,
  action,
  children,
  className,
  ...props
}: Omit<React.ComponentProps<'section'>, 'title'> & {
  title: React.ReactNode;
  titleId?: string;
  description?: React.ReactNode;
  descriptionId?: string;
  action?: React.ReactNode;
}) {
  const autoId = React.useId();
  const headingId = titleId ?? `${autoId}-title`;
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'grid gap-5 border-t border-border py-8 first:border-t-0 first:pt-2 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] lg:gap-12',
        className,
      )}
      {...props}
    >
      <div className="min-w-0">
        <h2 id={headingId} className="text-[15px] font-semibold text-ink">
          {title}
        </h2>
        {description ? (
          <p id={descriptionId} className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
        {action ? <div className="mt-3 flex flex-wrap items-center gap-2">{action}</div> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/** Checkbox row with a title and helper text. Uncontrolled unless `checked` is given. */
export function ToggleRow({
  name,
  title,
  description,
  defaultChecked,
  checked,
  onCheckedChange,
  tone = 'default',
}: {
  name?: string;
  title: string;
  description?: string;
  defaultChecked?: boolean;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  tone?: 'default' | 'warning';
}) {
  const id = React.useId();
  return (
    <label htmlFor={id} className="group flex cursor-pointer items-start gap-3">
      <input
        id={id}
        type="checkbox"
        name={name}
        defaultChecked={checked === undefined ? defaultChecked : undefined}
        checked={checked}
        onChange={onCheckedChange ? (event) => onCheckedChange(event.target.checked) : undefined}
        className="mt-0.5 size-4 shrink-0 cursor-pointer accent-[var(--ink)]"
      />
      <span className="min-w-0">
        <span
          className={cn(
            'block text-sm font-medium text-ink',
            tone === 'warning' && 'group-has-[:checked]:text-warning',
          )}
        >
          {title}
        </span>
        {description ? (
          <span className="mt-0.5 block text-[13px] leading-relaxed text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}

/** Accessible on/off switch (role="switch"). Pass a visible label via aria-labelledby or `label`. */
export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
  className,
  ...aria
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-[5px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt disabled:cursor-not-allowed disabled:opacity-45',
        checked ? 'bg-ink' : 'bg-[#cfd3d9]',
        className,
      )}
      {...aria}
    >
      <span
        aria-hidden
        className={cn(
          'inline-block size-4 rounded-[3px] bg-white transition-transform duration-100',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

/** A bordered list of rows. */
export function ItemList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <ul
      className={cn(
        'divide-y divide-border overflow-hidden rounded-lg border border-border',
        className,
      )}
    >
      {children}
    </ul>
  );
}

export function ItemRow({
  icon,
  title,
  meta,
  badge,
  action,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  meta?: React.ReactNode;
  badge?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 bg-card px-4 py-3">
      {icon ? (
        <span
          className="flex shrink-0 items-center text-muted-foreground [&_svg]:size-4"
          aria-hidden
        >
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
          <span className="truncate">{title}</span>
          {badge}
        </div>
        {meta ? (
          <div className="mono mt-0.5 truncate text-xs text-muted-foreground">{meta}</div>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </li>
  );
}

export function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-[#cfd3d9] px-4 py-5 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

export function FieldHint({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <p id={id} className="text-xs leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}
