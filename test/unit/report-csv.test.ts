import assert from 'node:assert/strict';
import { renderCsv, safeCsvCell } from '../../src/reporting/csv.js';

describe('safe report CSV export', () => {
  it('quotes cells and neutralizes spreadsheet formulas', () => {
    assert.equal(safeCsvCell('=2+3'), '"\'=2+3"');
    assert.equal(safeCsvCell('  @SUM(A1:A2)'), '"\'  @SUM(A1:A2)"');
    assert.equal(safeCsvCell('safe, "quoted"'), '"safe, ""quoted"""');
    const csv = renderCsv(['name', 'amount'], [{ name: '+cmd', amount: '1000' }]);
    assert.equal(csv, '"name","amount"\r\n"\'+cmd","1000"\r\n');
  });
});
