export const THEME_STORAGE_KEY = 'theme';

export function themeFromValue(value: string | null | undefined): 'light' | 'dark' {
  return value === 'light' ? 'light' : 'dark';
}
