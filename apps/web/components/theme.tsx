'use client';

import { createContext, useContext } from 'react';

/**
 * The app is designed for light mode only. This provider stays so existing
 * imports keep working; it always reports "light".
 */
export type Theme = 'light';

const value = { theme: 'light' as Theme, setTheme: (_theme: Theme) => undefined };
const ThemeContext = createContext(value);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
