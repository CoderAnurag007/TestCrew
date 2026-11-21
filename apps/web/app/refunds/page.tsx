import type { Metadata } from 'next';
import { LEGAL, LegalPage, Section } from '@/components/legal/legal-page';

export const metadata: Metadata = { title: 'Refunds and cancellation' };

export default function RefundsPage() {
  return (
    <LegalPage
      path="/refunds"
      title="Refunds and cancellation"
      intro="Try everything free for 14 days first. If a paid plan isn’t right for you, here is how cancelling and refunds work."
    >
      <Section title="Free trial">
        <p>
          Every new workspace starts with 14 days of the Pro plan, free and without a card. Nothing is charged when it ends:
          the workspace simply moves to the Free plan unless you choose a paid one.
        </p>
      </Section>

      <Section title="Cancelling">
        <ul>
          <li>You can cancel a paid plan at any time from the Plan and usage page, or by writing to {LEGAL.email}.</li>
          <li>Your plan stays active until the end of the period you have paid for, then the workspace moves to the Free plan.</li>
          <li>Nothing is deleted when you cancel: your sites and past reports stay, and the Free plan’s limits apply to new audits.</li>
        </ul>
      </Section>

      <Section title="Refunds">
        <ul>
          <li><strong>First payment:</strong> if you are not happy, ask within 14 days of your first payment on a plan and we refund it in full.</li>
          <li><strong>Yearly plans:</strong> within 14 days of a yearly renewal you can ask for a full refund of that renewal.</li>
          <li><strong>Monthly renewals:</strong> are not refunded, but you can cancel anytime so the next month isn’t charged.</li>
          <li><strong>Problems on our side:</strong> if the service was unavailable or broken for a significant time, write to us and we will credit or refund that time.</li>
        </ul>
        <p>
          Refunds go back to the original payment method, usually within 5–10 business days depending on your bank. Where your
          local consumer law gives you more rights, those rights apply.
        </p>
      </Section>

      <Section title="How to ask">
        <p>
          Write to {LEGAL.email} from the email on your account with the workspace name. We reply within two business days.
        </p>
      </Section>
    </LegalPage>
  );
}
