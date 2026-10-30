import request from 'supertest';
import pino from 'pino';
import { createApp } from '../../src/app.js';
import { stubPool } from '../helpers.js';

describe('B10 API access controls', () => {
  const app = createApp({ pool: stubPool(async () => { throw new Error('database must not be called before authentication'); }), logger: pino({ level: 'silent' }), readinessTimeoutMs: 100 });
  it('requires customer authentication to create a review', async () => {
    await request(app).post('/api/v1/reviews').set('idempotency-key', 'b10-review-api').send({ orderItemId: '10000000-0000-4000-8000-000000000001', rating: 5, title: 'Excellent', body: 'This review body is long enough.' }).expect(401);
  });
  it('requires staff authentication for moderation, banners, and reports', async () => {
    await request(app).get('/api/v1/admin/reviews').expect(401);
    await request(app).post('/api/v1/admin/banners').send({ title: 'Banner', imageUrl: '/banner.png' }).expect(401);
    await request(app).get('/api/v1/admin/reports/sales').expect(401);
  });
});
