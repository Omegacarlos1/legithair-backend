import assert from 'node:assert/strict';
import { FakeEmailProvider } from '../../src/email/provider.js';

describe('fake email provider', () => {
  it('captures synthetic email without external network access', async () => {
    const provider = new FakeEmailProvider();
    await provider.send({ to: 'fixture@example.test', template: 'verification', token: 'synthetic-token' });
    assert.deepEqual(provider.deliveries, [{ to: 'fixture@example.test', template: 'verification', token: 'synthetic-token' }]);
  });
});
