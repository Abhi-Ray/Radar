/**
 * Email channel via nodemailer: SMTP_URL (smtp:// or smtps://, credentials inside the URL) and
 * ALERT_EMAIL_TO. The sender is the SMTP user when it is an address, otherwise ALERT_EMAIL_TO.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { formatAlertSubject, formatAlertText, optionalEnv, safeErrorText, type AlertChannel, type AlertMessage } from './channels';

export interface EmailConfig {
  smtpUrl: string;
  to: string;
  from: string;
}

export function emailConfig(): EmailConfig | null {
  const smtpUrl = optionalEnv('SMTP_URL');
  const to = optionalEnv('ALERT_EMAIL_TO');
  if (!smtpUrl || !to) return null;
  return { smtpUrl, to, from: senderFor(smtpUrl, to) };
}

/** The SMTP login when it looks like an address (most providers require from == login). */
export function senderFor(smtpUrl: string, fallback: string): string {
  try {
    const user = decodeURIComponent(new URL(smtpUrl).username);
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user)) return `RADAR <${user}>`;
  } catch {
    // Malformed URL: nodemailer will report it on send.
  }
  return `RADAR <${fallback}>`;
}

let cached: { url: string; transport: Transporter } | null = null;

function transportFor(smtpUrl: string): Transporter {
  if (cached?.url === smtpUrl) return cached.transport;
  const options: SMTPTransport.Options = { url: smtpUrl, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000 };
  const transport = nodemailer.createTransport(options);
  cached = { url: smtpUrl, transport };
  return transport;
}

export class EmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailError';
  }
}

export async function sendAlertEmail(subject: string, text: string, cfg: EmailConfig): Promise<void> {
  try {
    await transportFor(cfg.smtpUrl).sendMail({ from: cfg.from, to: cfg.to, subject, text });
  } catch (err) {
    // nodemailer errors can include the connection URL: redact before surfacing.
    throw new EmailError(`email: ${safeErrorText(err)}`);
  }
}

export const emailChannel: AlertChannel = {
  name: 'email',
  isConfigured: () => emailConfig() !== null,
  async send(msg: AlertMessage) {
    const cfg = emailConfig();
    if (!cfg) throw new EmailError('email: not configured');
    await sendAlertEmail(formatAlertSubject(msg), formatAlertText(msg, 20_000), cfg);
  },
};
