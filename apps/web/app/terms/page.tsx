import type { Metadata } from 'next';
import { LEGAL, LegalPage, Section } from '@/components/legal/legal-page';

export const metadata: Metadata = { title: 'Terms of Service' };

export default function TermsPage() {
  return (
    <LegalPage
      path="/terms"
      title="Terms of Service"
      intro={`These terms are an agreement between you and ${LEGAL.entity} (“we”), which runs ${LEGAL.product}. By creating an account or using the service you accept them. If you use ${LEGAL.product} for a company, you accept them for that company.`}
    >
      <Section title="1. What the service does">
        <p>
          {LEGAL.product} opens websites and web apps in an automated browser, clicks through their pages, controls and forms,
          runs tests, takes screenshots and reports problems it finds. Reports are produced with automated checks and AI
          models. They help you find problems; they are not a guarantee that a site is free of bugs, secure or accessible.
        </p>
      </Section>

      <Section title="2. Only audit sites you are allowed to test">
        <p>You may only point {LEGAL.product} at websites and apps that you own, or that you have the owner’s permission to test. You are responsible for that permission.</p>
        <ul>
          <li>Audits run read-only by default: requests that would change data are blocked.</li>
          <li>Full mode, which can submit forms and place test orders, only runs on domains you have verified you control, and payments only with sandbox test cards.</li>
          <li>If you give us login details or a saved session for a site, you confirm you are allowed to use them for testing.</li>
        </ul>
        <p>We may stop audits, or suspend an account, that target sites without permission or that put a site under unreasonable load.</p>
      </Section>

      <Section title="3. Acceptable use">
        <p>You agree not to use the service to:</p>
        <ul>
          <li>attack, overload, scrape at scale, or try to break into any system;</li>
          <li>get around CAPTCHAs, bot protection or access controls you are not entitled to pass;</li>
          <li>collect other people’s personal data, or test sites that are illegal;</li>
          <li>resell or copy the service, or reverse-engineer it, except where the law allows;</li>
          <li>share an account between companies, or create accounts to avoid plan limits.</li>
        </ul>
      </Section>

      <Section title="4. Your account">
        <p>
          Keep your password safe and tell us at {LEGAL.email} if you think someone else has used your account. You are
          responsible for what happens in your workspaces, including what members you invite do there.
        </p>
      </Section>

      <Section title="5. Plans, trials and payment">
        <ul>
          <li>New workspaces get a free 14-day trial of the Pro plan, without a card. After it, the workspace moves to the Free plan unless you choose a paid one.</li>
          <li>Paid plans are billed monthly or yearly in advance, through our payment provider, and renew until you cancel.</li>
          <li>Prices are shown on the pricing page and may change; a new price applies from your next billing period after we tell you.</li>
          <li>Taxes are added where the law requires.</li>
          <li>Plan limits (sites, audits, devices and features) are enforced by the app.</li>
        </ul>
        <p>Cancellation and refunds are described on the Refunds and cancellation page.</p>
      </Section>

      <Section title="6. Your content">
        <p>
          You own the sites you audit, the data you give us and the reports made for you. You give us permission to process
          it only to run the service for you: to audit your sites, store results, send alerts and tickets you set up, and keep
          the service working and secure. How we handle personal data is described in the Privacy Policy.
        </p>
      </Section>

      <Section title="7. Our service">
        <p>
          We own {LEGAL.product}, its software and its brand. We work to keep it available and secure, but it is provided “as
          is”: we don’t promise it will be uninterrupted, error-free, or find every problem. We may change features, and we
          will give reasonable notice before removing something important you pay for.
        </p>
      </Section>

      <Section title="8. Liability">
        <p>
          To the extent the law allows, we are not liable for indirect or consequential losses (such as lost profits, revenue
          or data), and our total liability for any claim is limited to what you paid us in the 12 months before the claim.
          Nothing here limits liability that cannot be limited by law.
        </p>
        <p>
          You are responsible for claims from site owners that arise because you audited a site without permission, and you
          agree to cover our reasonable costs from such claims.
        </p>
      </Section>

      <Section title="9. Ending the agreement">
        <p>
          You can stop using the service and delete your account at any time from Account settings. We may suspend or close
          accounts that break these terms, with notice where reasonable. When an account is deleted, its workspaces where
          nobody else is a member are deleted with their data.
        </p>
      </Section>

      <Section title="10. Changes and law">
        <p>
          We may update these terms; if a change is significant we will tell you by email or in the app before it applies.
          These terms are governed by the laws of {LEGAL.jurisdiction}, whose courts handle any dispute.
        </p>
        <p>
          Contact: {LEGAL.entity}, {LEGAL.address}, {LEGAL.email}.
        </p>
      </Section>
    </LegalPage>
  );
}
