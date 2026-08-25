import type { Metadata } from 'next';
import { LandingPage } from '@/components/landing/landing-page';

export const metadata: Metadata = {
  title: 'AI App Auditor — Autonomous quality audits',
  description:
    'Explore web apps, generate executable tests, surface findings, and score quality from one control plane.',
};

export default function HomePage() {
  return <LandingPage />;
}
