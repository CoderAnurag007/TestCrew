import type { Metadata } from 'next';
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import { Providers } from '@/components/providers';
import { SessionProvider } from '@/components/session-provider';
import './globals.css';
import './motion.css';

const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-sans',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
});

// Display face for the front pages only: set wide (font-stretch 125%) for headlines.
const archivo = Archivo({
  subsets: ['latin'],
  axes: ['wdth'],
  variable: '--font-archivo',
});

export const metadata: Metadata = {
  title: { default: 'Snaghunt · AI App Auditor', template: '%s · Snaghunt' },
  description: 'Autonomous quality audits for web applications: explores your app, writes and runs tests, and reports what is broken.',
};

// Runs before the first paint: decides whether the front page plays its opening
// (once per tab, never with reduced motion; add ?intro to see it again), so the
// page never flashes underneath it.
const INTRO_SCRIPT = `(function(){try{var d=document.documentElement;d.classList.add('reveal-ready');if(location.pathname!=='/')return;var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;var force=/[?&]intro(=|&|$)/.test(location.search);var seen=sessionStorage.getItem('snaghunt.intro');var play=!reduce&&(force||!seen);d.setAttribute('data-intro',play?'play':'done');if(play)sessionStorage.setItem('snaghunt.intro','1');}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${plexSans.variable} ${plexMono.variable} ${archivo.variable}`} style={{ colorScheme: 'light' }}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: INTRO_SCRIPT }} />
      </head>
      <body suppressHydrationWarning>
        <Providers>
          <SessionProvider>{children}</SessionProvider>
        </Providers>
      </body>
    </html>
  );
}
