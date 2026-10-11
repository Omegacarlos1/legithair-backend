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
  });
});
