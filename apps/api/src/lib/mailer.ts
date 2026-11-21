import type { FastifyInstance } from 'fastify';

export type Mail = { to: string; subject: string; text: string; html: string };

/**
 * Mails that could not be sent because SMTP is not set up. Kept so tests (and a
 * developer without SMTP) can still follow the links; the link is also logged.
 */
export const outbox: Mail[] = [];

let transport: { sendMail: (mail: Record<string, unknown>) => Promise<unknown> } | null = null;

/** Sends a mail through SMTP_URL. Without SMTP it logs the mail instead, so local sign-ups still work. */
export async function sendMail(app: FastifyInstance, mail: Mail): Promise<'sent' | 'logged'> {
  if (!app.env.SMTP_URL) {
    outbox.push(mail);
    if (outbox.length > 50) outbox.shift();
    const level = app.env.NODE_ENV === 'production' ? 'warn' : 'info';
    app.log[level]({ to: mail.to, subject: mail.subject, text: mail.text }, 'SMTP_URL is not set, so this email was logged instead of sent');
    return 'logged';
  }
  if (!transport) {
    const { createTransport } = await import('nodemailer');
    transport = createTransport(app.env.SMTP_URL);
  }
  await transport.sendMail({ from: app.env.MAIL_FROM, ...mail });
  return 'sent';
}

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

/** A plain, readable email with one button. */
export function actionMail(input: { to: string; subject: string; intro: string; action: string; url: string; outro: string }): Mail {
  const text = `${input.intro}\n\n${input.action}: ${input.url}\n\n${input.outro}\n\nSnaghunt`;
  const html = `<!doctype html><html><body style="margin:0;background:#f6f5f2;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#141414">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e4e1da;border-radius:10px">
<tr><td style="padding:28px 28px 8px;font-weight:800;letter-spacing:.08em;font-size:13px">SNAGHUNT</td></tr>
<tr><td style="padding:8px 28px 0;font-size:15px;line-height:1.6">${escape(input.intro)}</td></tr>
<tr><td style="padding:22px 28px"><a href="${escape(input.url)}" style="display:inline-block;background:#141414;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 18px;border-radius:999px">${escape(input.action)}</a></td></tr>
<tr><td style="padding:0 28px 8px;font-size:13px;line-height:1.6;color:#6e6b66">${escape(input.outro)}</td></tr>
<tr><td style="padding:8px 28px 26px;font-size:12px;line-height:1.6;color:#8a867f;word-break:break-all">If the button doesn’t work, paste this link into your browser:<br>${escape(input.url)}</td></tr>
</table></td></tr></table></body></html>`;
  return { to: input.to, subject: input.subject, text, html };
}
