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
  });

  it('requires Gmail credentials only when Gmail delivery is selected', () => {
    const base = { NODE_ENV: 'test', PORT: '3000', DATABASE_HOST: 'localhost', DATABASE_USER: 'test', DATABASE_PASSWORD: '', DATABASE_NAME: 'legit_hair_test' };
    assert.throws(() => loadConfig({ ...base, EMAIL_PROVIDER: 'gmail' }), /GMAIL_USER, GMAIL_APP_PASSWORD/);
    const config = loadConfig({ ...base, EMAIL_PROVIDER: 'gmail', GMAIL_USER: 'sender@gmail.com', GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop' });
    assert.equal(config.GMAIL_APP_PASSWORD, 'abcdefghijklmnop');
  });
});
