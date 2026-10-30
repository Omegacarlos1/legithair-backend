import nodemailer, { type SendMailOptions } from 'nodemailer';
import type { AppConfig } from '../config.js';

export type EmailMessage =
  | { to: string; template: 'verification' | 'password_reset'; token: string }
  | { to: string; template: 'paid_receipt'; orderId: string; receiptNumber: string; amountMinor: number; currency: string }
  | { to: string; template: 'marketing'; subject: string; body: string; unsubscribeUrl: string };
export interface EmailProvider { send(message: EmailMessage): Promise<void> }

interface MailTransport {
  sendMail(message: SendMailOptions): Promise<unknown>;
  verify(): Promise<unknown>;
}

interface GmailProviderOptions {
  user: string;
  appPassword: string;
  fromName: string;
}

export class FakeEmailProvider implements EmailProvider {
  public readonly deliveries: EmailMessage[] = [];
  public async send(message: EmailMessage): Promise<void> { this.deliveries.push(structuredClone(message)); }
}

export class GmailEmailProvider implements EmailProvider {
  private readonly transport: MailTransport;

  public constructor(private readonly options: GmailProviderOptions, transport?: MailTransport) {
    this.transport = transport ?? nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: options.user, pass: options.appPassword }
    });
  }

  public async send(message: EmailMessage): Promise<void> {
    const content = createEmailContent(message);
    await this.transport.sendMail({
      from: { name: this.options.fromName, address: this.options.user },
      to: message.to,
      subject: content.subject,
      text: content.text,
      html: content.html,
      ...(message.template === 'marketing' ? { headers: { 'List-Unsubscribe': `<${message.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } } : {})
    });
  }

  public async verifyConnection(): Promise<void> { await this.transport.verify(); }
}

export function createEmailProvider(config: AppConfig): EmailProvider {
  if (config.EMAIL_PROVIDER === 'fake') return new FakeEmailProvider();
  return new GmailEmailProvider({
    user: config.GMAIL_USER!,
    appPassword: config.GMAIL_APP_PASSWORD!,
    fromName: config.EMAIL_FROM_NAME
  });
}

export function createGmailEmailProvider(config: AppConfig): GmailEmailProvider {
  if (config.EMAIL_PROVIDER !== 'gmail') throw new Error('EMAIL_PROVIDER must be gmail');
  return new GmailEmailProvider({
    user: config.GMAIL_USER!,
    appPassword: config.GMAIL_APP_PASSWORD!,
    fromName: config.EMAIL_FROM_NAME
  });
}

function createEmailContent(message: EmailMessage): { subject: string; text: string; html: string } {
  if (message.template === 'marketing') {
    return {
      subject: message.subject,
      text: `${message.body}\n\nUnsubscribe: ${message.unsubscribeUrl}`,
      html: `<div>${escapeHtml(message.body).replaceAll('\n', '<br>')}</div><p><a href="${escapeHtml(message.unsubscribeUrl)}">Unsubscribe</a></p>`
    };
  }
  if (message.template === 'paid_receipt') {
    const receiptNumber = escapeHtml(message.receiptNumber);
    const orderId = escapeHtml(message.orderId);
    const amount = `${message.currency} ${(message.amountMinor / 100).toFixed(2)}`;
    return {
      subject: `Your Legit Hair receipt ${message.receiptNumber}`,
      text: `Your payment is confirmed.\n\nReceipt: ${message.receiptNumber}\nOrder: ${message.orderId}\nAmount: ${amount}\n\nDownload the authoritative receipt from GET /api/v1/orders/${message.orderId}/receipt.`,
      html: `<h1>Payment confirmed</h1><p>Receipt: <strong>${receiptNumber}</strong></p><p>Order: <code>${orderId}</code></p><p>Amount: ${escapeHtml(amount)}</p><p>Download the authoritative receipt from your order history.</p>`
    };
  }
  const token = escapeHtml(message.token);
  if (message.template === 'verification') {
    return {
      subject: 'Verify your Legit Hair email address',
      text: `Welcome to Legit Hair.\n\nUse this verification token within 24 hours:\n\n${message.token}\n\nSubmit it to POST /api/v1/auth/verify-email. If you did not create this account, ignore this email.`,
      html: `<h1>Verify your email</h1><p>Welcome to Legit Hair.</p><p>Use this verification token within 24 hours:</p><p><code>${token}</code></p><p>Submit it to <code>POST /api/v1/auth/verify-email</code>.</p><p>If you did not create this account, ignore this email.</p>`
    };
  }
  return {
    subject: 'Reset your Legit Hair password',
    text: `A password reset was requested for your Legit Hair account.\n\nUse this reset token within one hour:\n\n${message.token}\n\nSubmit it to POST /api/v1/auth/reset-password. If you did not request this, ignore this email.`,
    html: `<h1>Reset your password</h1><p>Use this reset token within one hour:</p><p><code>${token}</code></p><p>Submit it to <code>POST /api/v1/auth/reset-password</code>.</p><p>If you did not request this, ignore this email.</p>`
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}
