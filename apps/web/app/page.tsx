import type { Metadata } from 'next';
import { LandingPage } from '@/components/landing/landing-page';

export const metadata: Metadata = {
  title: { absolute: 'TestCrew · Your app, audited by an AI QA engineer' },
  description:
    'TestCrew explores your web app, writes and runs tests from what it finds, and reports what is broken with evidence.',
};

export default function HomePage() {
  return <LandingPage />;
}
