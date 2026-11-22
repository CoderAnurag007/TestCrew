import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Free check',
  description: 'A free design review and quick bug scan of your website.',
  robots: { index: false, follow: false },
};

export default function CheckLayout({ children }: { children: React.ReactNode }) {
  return children;
}
