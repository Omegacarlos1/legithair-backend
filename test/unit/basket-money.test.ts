import assert from 'node:assert/strict';
import { addMoney, convertNgnToUsdMinor, multiplyMoney } from '../../src/baskets/money.js';

describe('basket money calculations', () => {
  it('uses integer arithmetic and half-up USD display rounding', () => {
    assert.equal(multiplyMoney(100_001, 3), 300_003);
    assert.equal(addMoney([300_003, 450_000]), 750_003);
    assert.equal(convertNgnToUsdMinor(1_600_000, 1_500), 1_067);
  });

  it('rejects totals outside the JavaScript safe integer boundary', () => {
    assert.throws(() => multiplyMoney(9_000_000_000_000, 2_000), /safe limit/);
  });
});
