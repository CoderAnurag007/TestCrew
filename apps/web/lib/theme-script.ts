export const THEME_STORAGE_KEY = 'theme';

/** TestCrew ships a single, light theme. */
export function themeFromValue(_value?: string | null): 'light' {
  return 'light';
}
