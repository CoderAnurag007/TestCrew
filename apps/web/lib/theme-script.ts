export const THEME_STORAGE_KEY = 'theme';

/** Snaghunt ships a single, light theme. */
export function themeFromValue(_value?: string | null): 'light' {
  return 'light';
}
