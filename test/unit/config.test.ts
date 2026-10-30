import assert from 'node:assert/strict';
import { loadConfig } from '../../src/config.js';

describe('configuration', () => {
  it('fails without required values and does not echo secrets', () => {
    const secret = 'must-not-leak';
    assert.throws(() => loadConfig({ DATABASE_PASSWORD: secret }), (error: Error) => {
      assert.equal(error.message.includes(secret), false);
      assert.match(error.message, /Invalid application configuration/);
      return true;
    });
  });

  it('parses valid values', () => {
    const config = loadConfig({ NODE_ENV: 'test', PORT: '3000', DATABASE_HOST: 'localhost', DATABASE_USER: 'test', DATABASE_PASSWORD: '', DATABASE_NAME: 'legit_hair_test' });
    assert.equal(config.DATABASE_PORT, 3306);
    assert.equal(config.EMAIL_PROVIDER, 'fake');
    assert.deepEqual(config.CORS_ALLOWED_ORIGINS, []);
  });

  it('requires production database, origin, email, and HTTPS delivery configuration', () => {
    const base = { NODE_ENV: 'production', PORT: '3000', DATABASE_HOST: 'private-db', DATABASE_USER: 'app', DATABASE_PASSWORD: '', DATABASE_NAME: 'legit_hair' };
    assert.throws(() => loadConfig(base), /DATABASE_PASSWORD, CORS_ALLOWED_ORIGINS, EMAIL_PROVIDER/);
    const configured = loadConfig({ ...base, DATABASE_PASSWORD: 'synthetic-production-password', CORS_ALLOWED_ORIGINS: 'https://shop.example.test,https://admin.example.test', EMAIL_PROVIDER: 'gmail', GMAIL_USER: 'sender@example.test', GMAIL_APP_PASSWORD: 'abcdefghijklmnop', PAYSTACK_CALLBACK_URL: 'https://api.example.test/payments/callback', MARKETING_UNSUBSCRIBE_BASE_URL: 'https://api.example.test/api/v1/marketing/unsubscribe', TRUST_PROXY_HOPS: '1' });
    assert.deepEqual(configured.CORS_ALLOWED_ORIGINS, ['https://shop.example.test', 'https://admin.example.test']);
    assert.equal(configured.TRUST_PROXY_HOPS, 1);
  });

  it('rejects malformed CORS origins and insecure production callback URLs', () => {
    const base = { NODE_ENV: 'test', PORT: '3000', DATABASE_HOST: 'localhost', DATABASE_USER: 'test', DATABASE_PASSWORD: '', DATABASE_NAME: 'legit_hair_test' };
    assert.throws(() => loadConfig({ ...base, CORS_ALLOWED_ORIGINS: 'https://shop.example.test/path' }), /CORS_ALLOWED_ORIGINS/);
    assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production', DATABASE_PASSWORD: 'synthetic', CORS_ALLOWED_ORIGINS: 'https://shop.example.test', EMAIL_PROVIDER: 'gmail', GMAIL_USER: 'sender@example.test', GMAIL_APP_PASSWORD: 'abcdefghijklmnop', PAYSTACK_CALLBACK_URL: 'http://api.example.test/callback' }), /PAYSTACK_CALLBACK_URL/);
  });

  it('requires Gmail credentials only when Gmail delivery is selected', () => {
    const base = { NODE_ENV: 'test', PORT: '3000', DATABASE_HOST: 'localhost', DATABASE_USER: 'test', DATABASE_PASSWORD: '', DATABASE_NAME: 'legit_hair_test' };
    assert.throws(() => loadConfig({ ...base, EMAIL_PROVIDER: 'gmail' }), /GMAIL_USER, GMAIL_APP_PASSWORD/);
    const config = loadConfig({ ...base, EMAIL_PROVIDER: 'gmail', GMAIL_USER: 'sender@gmail.com', GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop' });
    assert.equal(config.GMAIL_APP_PASSWORD, 'abcdefghijklmnop');
  });

  it('keeps order policy disabled until explicit values are supplied', () => {
    const base = { NODE_ENV: 'test', PORT: '3000', DATABASE_HOST: 'localhost', DATABASE_USER: 'test', DATABASE_PASSWORD: '', DATABASE_NAME: 'legit_hair_test' };
    const disabled = loadConfig(base);
    assert.equal(disabled.COD_ENABLED, false);
    assert.equal(disabled.ORDER_COMMISSION_RATE_BPS, undefined);
    const configured = loadConfig({ ...base, ORDER_RESERVATION_TTL_SECONDS: '900', ORDER_COMMISSION_BASIS: 'line_item_gross', ORDER_COMMISSION_RATE_BPS: '1000', COD_ENABLED: 'true', ORDER_GUEST_TOKEN_SECRET: 'synthetic-config-secret-000000000001' });
    assert.equal(configured.ORDER_RESERVATION_TTL_SECONDS, 900);
    assert.equal(configured.ORDER_COMMISSION_RATE_BPS, 1000);
    assert.equal(configured.COD_ENABLED, true);
  });

  it('keeps Paystack fail-closed and validates an explicitly supplied server secret', () => {
    const base = { NODE_ENV: 'test', PORT: '3000', DATABASE_HOST: 'localhost', DATABASE_USER: 'test', DATABASE_PASSWORD: '', DATABASE_NAME: 'legit_hair_test' };
    assert.equal(loadConfig(base).PAYSTACK_SECRET_KEY, undefined);
    assert.throws(() => loadConfig({ ...base, PAYSTACK_SECRET_KEY: 'pk_test_public_key_must_not_be_used' }), /PAYSTACK_SECRET_KEY/);
    const configured = loadConfig({ ...base, PAYSTACK_SECRET_KEY: 'sk_test_syntheticsecret000001', PAYSTACK_TIMEOUT_MS: '1500' });
    assert.equal(configured.PAYSTACK_TIMEOUT_MS, 1500);
  });

  it('keeps return and delivery-refund policy fail-closed until explicitly configured', () => {
    const base = { NODE_ENV: 'test', PORT: '3000', DATABASE_HOST: 'localhost', DATABASE_USER: 'test', DATABASE_PASSWORD: '', DATABASE_NAME: 'legit_hair_test' };
    const disabled = loadConfig(base);
    assert.equal(disabled.RETURN_WINDOW_DAYS, undefined);
    assert.equal(disabled.REFUND_DELIVERY_MODE, undefined);
    const configured = loadConfig({ ...base, RETURN_WINDOW_DAYS: '14', REFUND_DELIVERY_MODE: 'full_order' });
    assert.equal(configured.RETURN_WINDOW_DAYS, 14);
    assert.equal(configured.REFUND_DELIVERY_MODE, 'full_order');
  });

  it('keeps earnings policy and money movement fail-closed until explicitly configured', () => {
    const base = { NODE_ENV: 'test', PORT: '3000', DATABASE_HOST: 'localhost', DATABASE_USER: 'test', DATABASE_PASSWORD: '', DATABASE_NAME: 'legit_hair_test' };
    const disabled = loadConfig(base);
    assert.equal(disabled.EARNINGS_HOLD_DAYS, undefined);
    assert.equal(disabled.PAYOUTS_ENABLED, false);
    const configured = loadConfig({ ...base, EARNINGS_HOLD_DAYS: '14', PAYOUTS_ENABLED: 'true' });
    assert.equal(configured.EARNINGS_HOLD_DAYS, 14);
    assert.equal(configured.PAYOUTS_ENABLED, true);
  });
});
