import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { IBM_Plex_Mono, Outfit } from 'next/font/google';
import { Providers } from '@/components/providers';
import { SessionProvider } from '@/components/session-provider';
import { THEME_STORAGE_KEY, themeFromValue } from '@/lib/theme-script';
import './globals.css';

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-outfit',
});

const ibm = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-ibm',
});

export const metadata: Metadata = {
  title: 'AI App Auditor',
  description: 'Autonomous quality audits for web applications.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = themeFromValue((await cookies()).get(THEME_STORAGE_KEY)?.value);
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${theme === 'dark' ? 'dark' : ''} ${outfit.variable} ${ibm.variable}`.trim()}
      style={{ colorScheme: theme }}
    >
      <body suppressHydrationWarning>
        <Providers>
          <SessionProvider>{children}</SessionProvider>
        </Providers>
      </body>
    </html>
  );
}
