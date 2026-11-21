import type { Metadata } from 'next';
import { LEGAL, LegalPage, Section } from '@/components/legal/legal-page';

export const metadata: Metadata = { title: 'Privacy Policy' };

export default function PrivacyPage() {
  return (
    <LegalPage
      path="/privacy"
      title="Privacy Policy"
      intro={`This page explains what ${LEGAL.product} collects, why, who it is shared with and the choices you have. ${LEGAL.entity} is responsible for this data.`}
    >
      <Section title="What we collect">
        <ul>
          <li><strong>Account details:</strong> your name, email address and a scrambled (hashed) version of your password. We never store the password itself.</li>
          <li><strong>Workspace data:</strong> the sites you add, settings, schedules, alert and ticket settings, and who is a member.</li>
          <li><strong>Audit results:</strong> what the automated browser sees on the sites you audit: page addresses, page text and structure, screenshots, console messages, network errors, test results and findings. This can include personal data that is visible on those pages.</li>
          <li><strong>Secrets you give us:</strong> logins or saved sessions for audited sites, and tokens for GitHub, Jira, Linear or Slack. These are encrypted at rest and used only to run your audits and create your tickets and alerts.</li>
          <li><strong>Usage and security logs:</strong> sign-ins, important account actions, IP addresses and errors, so we can keep the service secure and fix problems.</li>
          <li><strong>Billing:</strong> handled by our payment provider. We see your plan and payment status, not your full card number.</li>
        </ul>
      </Section>

      <Section title="Why we use it">
        <ul>
          <li>To run the service: audit your sites, store and show results, send the alerts and tickets you set up.</li>
          <li>To run your account: sign-in, email confirmation, password resets, billing and support.</li>
          <li>To keep it secure and working: preventing abuse, fixing errors, enforcing plan limits.</li>
          <li>To tell you about important changes to the service or these policies.</li>
        </ul>
        <p>We don’t sell personal data, and we don’t use your audit results to train AI models.</p>
      </Section>

      <Section title="Who we share it with">
        <p>Only with the providers that help run the service, under agreements that protect the data:</p>
        <ul>
          <li>Hosting and storage, where the app, database and screenshots live.</li>
          <li>AI model providers (currently Google Gemini), which receive page text and screenshots from your audits to help write tests and review pages.</li>
          <li>Email delivery, for account emails and alerts.</li>
          <li>Payments, for subscriptions and invoices.</li>
          <li>The tools you connect yourself (Slack, GitHub, Jira, Linear, webhooks), which receive the findings you send them.</li>
        </ul>
        <p>We also share data when the law requires it, and with anyone you choose to give a share link to a report.</p>
      </Section>

      <Section title="How long we keep it">
        <ul>
          <li>Account and workspace data: while your account exists.</li>
          <li>Audit results and screenshots: while the project exists, or until you delete them.</li>
          <li>When you delete a project or your account, its audits, findings and screenshots are deleted. Backups roll over within 30 days.</li>
          <li>Security logs: up to 12 months.</li>
        </ul>
      </Section>

      <Section title="Cookies and storage">
        <p>
          We use one cookie to keep you signed in. The app also remembers small preferences in your browser (such as your
          current workspace and whether the welcome guide is hidden). We don’t use advertising or tracking cookies.
        </p>
      </Section>

      <Section title="Your choices and rights">
        <ul>
          <li>See and change your details in Account settings, and export your findings from each report.</li>
          <li>Delete your account at any time from Account settings.</li>
          <li>Ask us for a copy of your data, a correction, or deletion, or object to how we use it, at {LEGAL.email}. We answer within 30 days.</li>
          <li>Depending on where you live (for example the EU, UK or India), you may also complain to your data protection authority.</li>
        </ul>
      </Section>

      <Section title="Security">
        <p>
          Passwords are hashed, secrets are encrypted, connections use HTTPS, and audits run in isolated browsers that are
          closed after each run. No system is perfectly secure; if a breach affects your data we will tell you without undue
          delay.
        </p>
      </Section>

      <Section title="Data from sites you audit">
        <p>
          When you audit a site, you decide what is audited and are responsible for having the right to do so. If personal data
          of other people shows up on those pages, we process it on your behalf and only to produce your reports.
        </p>
      </Section>

      <Section title="Changes and contact">
        <p>
          We will post changes here and, if they are significant, tell you by email. Contact: {LEGAL.entity}, {LEGAL.address},{' '}
          {LEGAL.email}.
        </p>
      </Section>
    </LegalPage>
  );
}
