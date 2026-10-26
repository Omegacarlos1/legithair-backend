import assert from 'node:assert/strict';
import type { SendMailOptions } from 'nodemailer';
import { FakeEmailProvider, GmailEmailProvider } from '../../src/email/provider.js';

describe('fake email provider', () => {
  it('captures synthetic email without external network access', async () => {
    const provider = new FakeEmailProvider();
    await provider.send({ to: 'fixture@example.test', template: 'verification', token: 'synthetic-token' });
    assert.deepEqual(provider.deliveries, [{ to: 'fixture@example.test', template: 'verification', token: 'synthetic-token' }]);
  });
});

describe('Gmail email provider', () => {
  it('uses authenticated Gmail SMTP content without making a network call', async () => {
    const messages: SendMailOptions[] = [];
    let verified = false;
    const provider = new GmailEmailProvider(
      { user: 'sender@gmail.com', appPassword: 'abcdefghijklmnop', fromName: 'Legit Hair' },
      {
        sendMail: async (message: SendMailOptions): Promise<unknown> => { messages.push(message); return { messageId: 'synthetic' }; },
        verify: async (): Promise<unknown> => { verified = true; return true; }
      }
    );
    await provider.verifyConnection();
    await provider.send({ to: 'customer@example.test', template: 'verification', token: '<synthetic-token>' });
    assert.equal(verified, true);
    assert.equal(messages.length, 1);
    assert.equal(messages[0]!.to, 'customer@example.test');
    assert.equal(messages[0]!.subject, 'Verify your Legit Hair email address');
    assert.match(String(messages[0]!.text), /<synthetic-token>/);
    assert.match(String(messages[0]!.html), /&lt;synthetic-token&gt;/);
    assert.deepEqual(messages[0]!.from, { name: 'Legit Hair', address: 'sender@gmail.com' });
  });

  it('renders paid receipt details without exposing provider secrets', async () => {
    const messages: SendMailOptions[] = [];
    const provider = new GmailEmailProvider(
      { user: 'sender@gmail.com', appPassword: 'abcdefghijklmnop', fromName: 'Legit Hair' },
      { sendMail: async (message: SendMailOptions): Promise<unknown> => { messages.push(message); return {}; }, verify: async (): Promise<unknown> => true }
    );
    await provider.send({ to: 'customer@example.test', template: 'paid_receipt', orderId: 'order-1', receiptNumber: 'LH-RECEIPT-1', amountMinor: 125050, currency: 'NGN' });
    assert.equal(messages[0]!.subject, 'Your Legit Hair receipt LH-RECEIPT-1');
    assert.match(String(messages[0]!.text), /NGN 1250\.50/);
  });
});
