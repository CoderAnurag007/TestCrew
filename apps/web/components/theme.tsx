'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { THEME_STORAGE_KEY, themeFromValue } from '@/lib/theme-script';

export type Theme = 'light' | 'dark';

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (theme: Theme) => void;
}>({
  theme: 'dark',
  setTheme: () => undefined,
});

function persistTheme(theme: Theme) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* private mode */
  }
  document.cookie = `${THEME_STORAGE_KEY}=${theme}; path=/; max-age=31536000; samesite=lax`;
}

function readStoredTheme(): Theme {
  try {
    return themeFromValue(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'dark';
  }
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark');

  useEffect(() => {
    const next = readStoredTheme();
    setThemeState(next);
    persistTheme(next);
    applyTheme(next);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    persistTheme(next);
    applyTheme(next);
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
