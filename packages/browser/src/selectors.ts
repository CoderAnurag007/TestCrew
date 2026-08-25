import type { SelectorMeta } from '@auditor/shared';

const CSS_ESCAPE = /([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g;

export function cssEscape(value: string): string {
  return value.replace(CSS_ESCAPE, '\\$1');
}

export function isStableId(id: string): boolean {
  if (!id || id.length > 80) {
    return false;
  }
  return !/^(ember|react-select|radix|mui-|:)/i.test(id) && !/\d{6,}/.test(id);
}

export interface RawSelectorParts {
  testId?: string | null;
  id?: string | null;
  role?: string | null;
  accessibleName?: string | null;
  label?: string | null;
  name?: string | null;
  text?: string | null;
  tag?: string | null;
  type?: string | null;
  href?: string | null;
}

export function buildSelectorMeta(parts: RawSelectorParts): SelectorMeta {
  const testId = parts.testId?.trim() || null;
  const id = parts.id && isStableId(parts.id) ? parts.id : null;
  const role = parts.role?.trim() || null;
  const accessibleName = parts.accessibleName?.trim() || null;
  const label = parts.label?.trim() || null;
  const name = parts.name?.trim() || null;
  const text = parts.text?.trim().slice(0, 80) || null;
  const tag = (parts.tag ?? 'div').toLowerCase();

  let css: string | null = null;
  if (testId) {
    css = `[data-testid="${cssEscape(testId)}"]`;
  } else if (id) {
    css = `#${cssEscape(id)}`;
  } else if (name) {
    css = `${tag}[name="${cssEscape(name)}"]`;
  } else if (parts.type) {
    css = `${tag}[type="${cssEscape(parts.type)}"]`;
  } else if (parts.href) {
    css = `a[href="${cssEscape(parts.href)}"]`;
  } else {
    css = tag;
  }

  const primary =
    (testId ? `[data-testid="${cssEscape(testId)}"]` : null) ??
    (id ? `#${cssEscape(id)}` : null) ??
    (role && accessibleName ? `role=${role}|name=${accessibleName}` : null) ??
    (label ? `label=${label}` : null) ??
    (name ? `[name="${cssEscape(name)}"]` : null) ??
    (text ? `text=${text}` : null) ??
    css;

  return {
    testId,
    id,
    role,
    accessibleName,
    label,
    name,
    text,
    css,
    primary,
  };
}
