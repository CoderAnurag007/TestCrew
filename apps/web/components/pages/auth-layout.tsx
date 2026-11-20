import { InspectionScene } from '@/components/landing/inspection-scene';
import { SectionIndex } from '@/components/landing/section-index';
import { Brand } from '@/components/shell/brand';

/** Sign-in and sign-up: the form on paper, the night-shift inspection scene beside it. */
export function AuthLayout({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <main className="flex flex-col px-6 py-6 sm:px-10">
        <Brand />
        <div className="flex flex-1 items-center py-12">
          <div className="w-full max-w-[360px] lg:ml-[max(0px,calc((100%-360px)/2-40px))]">
            <h1 className="display text-[30px] text-ink">{title}</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
            <div className="mt-8">{children}</div>
            <div className="mt-8 border-t border-border pt-5 text-[13px] text-muted-foreground">{footer}</div>
          </div>
        </div>
      </main>

      <aside className="night hidden overflow-hidden lg:flex lg:flex-col lg:justify-center lg:px-12 xl:px-16">
        <div className="mx-auto w-full max-w-[620px]">
          <SectionIndex number="0.01" label="Live audit · staging.shop.example" />
          <p className="display mt-5 text-[30px] xl:text-[36px]">
            Every button clicked.
            <span className="block text-[#3a3e45]">Every bug on record.</span>
          </p>
          <InspectionScene compact className="mt-10" />
        </div>
      </aside>
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }
  return (
    <div role="alert" className="rounded-md border border-[#f2c4bf] bg-[#fdf1ef] px-3 py-2.5 text-sm text-[#a32418]">
      {message}
    </div>
  );
}
