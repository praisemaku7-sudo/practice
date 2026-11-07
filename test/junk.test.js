import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSummaryLine } from '../src/lib/parse/junk.js';
import { parseStatementLines } from '../src/lib/parse/statementText.js';
import { detectRecurring } from '../src/lib/analysis.js';
import { toTransactions } from '../src/lib/importer.js';

test('statement summary lines are recognised', () => {
  for (const s of ['YOUR NEW BALANCE', 'Standard purchase rate', "You've incurred up to £25.54 interest", 'You’ve incurred', 'Minimum payment', 'Credit limit', 'Previous balance', 'Total amount due', 'APR 24.9%', 'Estimated interest']) {
    assert.equal(isSummaryLine(s), true, s);
  }
  for (const s of ['TESCO STORES', 'INTEREST CHARGED', 'AMERICAN EXPRESS', 'PAYBYPHONE PARKING', 'APRIL CAFE', 'BLACK HORSE', 'AMAZON NV8DN5LJ4 LND', 'SUMMARY CAFE LTD'.replace('SUMMARY ', 'SUMMIT ')]) {
    assert.equal(isSummaryLine(s), false, s);
  }
});

test('credit card PDF summary box is not read as transactions, and new balance becomes the closing balance', () => {
  const line = (y, cells) => ({ page: 1, y, items: cells.map(([x, str]) => ({ x, w: str.length * 5, str })) });
  const r = parseStatementLines([
    line(800, [[40, 'Statement 8 October 2026 to 7 November 2026']]),
    line(780, [[40, '07 Nov'], [100, 'Your new balance'], [420, '1,348.16']]),
    line(770, [[40, '07 Nov'], [100, 'Standard purchase rate'], [420, '1,348.16']]),
    line(760, [[40, '07 Nov'], [100, "You've incurred up to"], [420, '25.54']]),
    line(740, [[40, '12 Oct'], [100, 'DELIVEROO'], [420, '23.40']]),
    line(730, [[40, '15 Oct'], [100, 'PAYMENT RECEIVED - THANK YOU'], [420, '400.00CR']]),
  ]);
  assert.deepEqual(r.transactions.map((t) => t.description), ['DELIVEROO', 'PAYMENT RECEIVED - THANK YOU']);
  assert.equal(r.closingBalance, 134816);
});

test('summary lines never become a fake subscription', () => {
  const rows = [];
  for (const m of ['08', '09', '10']) rows.push({ date: `2026-${m}-07`, description: 'YOUR NEW BALANCE', amount: -134816 }, { date: `2026-${m}-07`, description: 'NETFLIX.COM', amount: -1299 });
  const rec = detectRecurring(toTransactions(rows, { accountId: 'c' }), { today: '2026-11-08' });
  assert.deepEqual(rec.map((r) => r.name), ['NETFLIX']);
});
