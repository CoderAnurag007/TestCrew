'use client';

import Link from 'next/link';
import { useSession } from '@/components/session-provider';
import { Brand } from '@/components/shell/brand';
import { CtaSection } from './cta-section';
import { EvidenceSection } from './evidence-section';
import { FeaturesSection } from './features-section';
import { HeroSection } from './hero-section';
import { HowItWorksSection } from './how-it-works-section';
import { LandingNav } from './landing-nav';

export function LandingPage() {
  const { user, isLoading } = useSession();
  const signedIn = Boolean(user) && !isLoading;
  const primaryHref = signedIn ? '/dashboard' : '/register';
  const primaryLabel = signedIn ? 'Open dashboard' : 'Start an audit';

  return (
    <div className="night min-h-screen overflow-x-hidden">
      <LandingNav signedIn={signedIn} primaryHref={primaryHref} primaryLabel={signedIn ? 'Dashboard' : 'Start an audit'} />
      <main>
        <HeroSection primaryHref={primaryHref} primaryLabel={primaryLabel} signedIn={signedIn} />
        <HowItWorksSection />
        <EvidenceSection />
        <FeaturesSection />
        <CtaSection primaryHref={primaryHref} primaryLabel={primaryLabel} />
      </main>
      <footer>
        <div className="mx-auto flex max-w-[1280px] flex-col items-start justify-between gap-4 px-4 py-8 sm:flex-row sm:items-center sm:px-6 lg:px-10">
          <Brand tone="night" />
          <nav aria-label="Footer" className="flex gap-6 text-[13px] text-[var(--night-dim)]">
            <Link href="#how-it-works" className="hover:text-[var(--night-ink)]">
              How it works
            </Link>
            <Link href="#evidence" className="hover:text-[var(--night-ink)]">
              Evidence
            </Link>
            <Link href={signedIn ? '/dashboard' : '/login'} className="hover:text-[var(--night-ink)]">
              {signedIn ? 'Dashboard' : 'Sign in'}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
