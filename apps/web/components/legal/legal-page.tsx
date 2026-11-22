import Link from 'next/link';
import { Brand } from '@/components/shell/brand';
import { cn } from '@/lib/utils';

/**
 * Who runs Snaghunt, in one place. Fill in the bracketed details (or have a
 * lawyer do it) before launch: the pages read them from here.
 */
export const LEGAL = {
  product: 'Snaghunt',
  entity: '[Registered business name]',
  address: '[Registered business address]',
  jurisdiction: '[Country and state whose courts and laws apply]',
  email: 'hello@snaghunt.com',
  website: 'snaghunt.com',
  updated: '22 November 2026',
};

const PAGES = [
  { href: '/terms', label: 'Terms of Service' },
  { href: '/privacy', label: 'Privacy Policy' },
  { href: '/refunds', label: 'Refunds and cancellation' },
];

/** A legal page: plain, readable, on paper. */
export function LegalPage({ path, title, intro, children }: { path: string; title: string; intro: string; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[#faf9f6] text-[#141414]">
      <header className="border-b border-[#e4e1da]">
        <div className="mx-auto flex h-16 max-w-[1080px] items-center justify-between gap-4 px-4 sm:px-6">
          <Brand />
          <Link href="/" className="text-[13px] text-[#6e6b66] hover:text-[#141414]">
            Back to snaghunt.com
          </Link>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1080px] gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:py-16">
        <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2 text-[14px] lg:flex-col lg:gap-2">
          {PAGES.map((page) => (
            <Link
              key={page.href}
              href={page.href}
              aria-current={page.href === path ? 'page' : undefined}
              className={cn(page.href === path ? 'font-semibold text-[#141414]' : 'text-[#6e6b66] hover:text-[#141414]')}
            >
              {page.label}
            </Link>
          ))}
        </nav>
        <main className="legal max-w-[68ch]">
          <h1 className="display text-[30px] sm:text-[38px]">{title}</h1>
          <p className="mt-3 text-[13px] text-[#6e6b66]">Last updated {LEGAL.updated}</p>
          <p className="mt-6 text-[16px] leading-relaxed text-[#3a3733]">{intro}</p>
          <div className="mt-8">{children}</div>
          <p className="mt-12 border-t border-[#e4e1da] pt-6 text-[14px] text-[#6e6b66]">
            Questions about this page? Write to{' '}
            <a href={`mailto:${LEGAL.email}`} className="text-[#141414] underline underline-offset-4">
              {LEGAL.email}
            </a>
            .
          </p>
        </main>
      </div>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-9 first:mt-0">
      <h2 className="text-[18px] font-semibold">{title}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-[#3a3733] [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_ul]:space-y-1.5">
        {children}
      </div>
    </section>
  );
}
