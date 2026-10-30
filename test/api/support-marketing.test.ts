import pino from 'pino';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { stubPool } from '../helpers.js';

describe('B11 support and marketing API access controls', () => {
  const app = createApp({ pool: stubPool(async () => { throw new Error('database must not be called before authentication'); }), logger: pino({ level: 'silent' }), readinessTimeoutMs: 100 });
  it('requires authentication for support threads and marketing preferences', async () => {
    await request(app).post('/api/v1/support/threads').send({ subject: 'Help', message: 'Synthetic question', clientId: '10000000-0000-4000-8000-000000000001' }).expect(401);
    await request(app).get('/api/v1/support/threads/10000000-0000-4000-8000-000000000001/messages').expect(401);
    await request(app).put('/api/v1/me/marketing-preference').send({ optedIn: true }).expect(401);
  });
  it('requires admin authentication for campaigns and suppression changes', async () => {
    await request(app).post('/api/v1/admin/marketing/campaigns').send({ subject: 'Promotion', body: 'Synthetic promotional content.' }).expect(401);
    await request(app).put('/api/v1/admin/marketing/suppressions').send({ email: 'customer@example.test', suppressed: true, reason: 'manual' }).expect(401);
  });
});
