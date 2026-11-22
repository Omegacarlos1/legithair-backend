import assert from 'node:assert/strict';
import type { Pool } from 'mysql2/promise';
import { FinanceReadService } from '../../src/finance/service.js';

describe('read-only finance projections', () => {
  it('returns paginated decimal-string amounts without customer identity or provider credentials', async () => {
    const sql: string[] = [];
    const pool = { query: async (statement: string) => {
      sql.push(statement);
      if (statement.includes('COUNT(*)')) return [[{ total: 1 }], []];
      return [[{ id: 'payment-id', order_id: 'order-id', provider_reference: 'LH-TEST', status: 'succeeded', order_status: 'paid', expected_amount_minor: '9007199254740993', currency: 'NGN', paid_at: null, verified_at: null, created_at: new Date('2026-11-17T10:00:00Z'), updated_at: new Date('2026-11-17T10:00:00Z') }], []];
    } } as unknown as Pool;
    const result = await new FinanceReadService(pool).listPayments({ page: 1, limit: 20, status: 'succeeded' });
    assert.equal(result.payments.length, 1);
    assert.equal((result.payments[0] as { expectedAmountMinor: string }).expectedAmountMinor, '9007199254740993');
    assert.equal(JSON.stringify(result).includes('customer_email'), false);
    assert.equal(JSON.stringify(result).includes('access_code'), false);
    assert.equal(sql.some((statement) => statement.includes('p.status = ?')), true);
  });
});
