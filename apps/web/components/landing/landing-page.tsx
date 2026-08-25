'use client';

import { useSession } from '@/components/session-provider';
import { Separator } from '@/components/ui/separator';
import { LandingNav } from './landing-nav';
import { HeroSection } from './hero-section';
import { HowItWorksSection } from './how-it-works-section';
import { CtaSection } from './cta-section';

export function LandingPage() {
  const { user, isLoading } = useSession();
  const signedIn = Boolean(user) && !isLoading;
  const primaryHref = signedIn ? '/dashboard' : '/register';
  const primaryLabel = signedIn ? 'Open dashboard' : 'Get started';

  return (
    <div className="min-h-screen bg-background text-foreground">
      <LandingNav signedIn={signedIn} primaryHref={primaryHref} primaryLabel={primaryLabel} />
      <main>
        <HeroSection
          primaryHref={primaryHref}
          primaryLabel={primaryLabel}
          signedIn={signedIn}
        />
        <HowItWorksSection />
        <CtaSection primaryHref={primaryHref} primaryLabel={primaryLabel} />
      </main>
      <Separator />
      <footer className="py-8 text-center">
        <p className="text-sm text-muted-foreground">
          AI App Auditor · Control plane for autonomous web audits
        </p>
      </footer>
    </div>
  );
}
