'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { useSession } from '@/components/session-provider';
import { Brand } from '@/components/shell/brand';
import { CtaSection } from './cta-section';
import { EvidenceSection } from './evidence-section';
import { FeaturesSection } from './features-section';
import { HeroSection } from './hero-section';
import { HowItWorksSection } from './how-it-works-section';
import { IntroCurtain } from './intro-curtain';
import { LandingNav } from './landing-nav';
import { PricingSection } from './pricing-section';

export function LandingPage() {
  const { user, isLoading } = useSession();
  const signedIn = Boolean(user) && !isLoading;
  const primaryHref = signedIn ? '/dashboard' : '/register';
  const primaryLabel = signedIn ? 'Open dashboard' : 'Start an audit';

  // After deleting an account the app lands here.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('deleted')) {
      toast.success('Your account was deleted. Thanks for trying Snaghunt.');
      window.history.replaceState(null, '', '/');
    }
  }, []);

  // Sections fade up as they come into view (see [data-reveal] in motion.css).
  useEffect(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (!('IntersectionObserver' in window)) {
      for (const item of items) item.dataset.shown = '';
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.shown = '';
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.12 },
    );
    for (const item of items) observer.observe(item);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="night min-h-screen overflow-x-hidden">
      <IntroCurtain />
      <LandingNav signedIn={signedIn} primaryHref={primaryHref} primaryLabel={signedIn ? 'Dashboard' : 'Start an audit'} />
      <main>
        <HeroSection primaryHref={primaryHref} primaryLabel={primaryLabel} signedIn={signedIn} />
        <HowItWorksSection />
        <EvidenceSection />
        <FeaturesSection />
        <PricingSection signedIn={signedIn} />
        <CtaSection primaryHref={primaryHref} primaryLabel={primaryLabel} />
      </main>
      <footer>
        <div className="mx-auto flex max-w-[1280px] flex-col items-start justify-between gap-4 px-4 py-8 sm:flex-row sm:items-center sm:px-6 lg:px-10">
          <Brand tone="night" />
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-[var(--night-dim)]">
            <Link href="#how-it-works" className="hover:text-[var(--night-ink)]">
              How it works
            </Link>
            <Link href="#evidence" className="hover:text-[var(--night-ink)]">
              Evidence
            </Link>
            <Link href="#pricing" className="hover:text-[var(--night-ink)]">
              Pricing
            </Link>
            <Link href={signedIn ? '/dashboard' : '/login'} className="hover:text-[var(--night-ink)]">
              {signedIn ? 'Dashboard' : 'Sign in'}
            </Link>
          </nav>
          <nav aria-label="Legal" className="flex gap-6 text-[13px] text-[#6b7079]">
            <Link href="/terms" className="hover:text-[var(--night-ink)]">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-[var(--night-ink)]">
              Privacy
            </Link>
            <Link href="/refunds" className="hover:text-[var(--night-ink)]">
              Refunds
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
