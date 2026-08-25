'use client';

import { Toaster as Sonner } from 'sonner';
import { useTheme } from '@/components/theme';

export function Toaster() {
  const { theme } = useTheme();
  return <Sonner theme={theme as 'light' | 'dark' | 'system'} richColors />;
}
