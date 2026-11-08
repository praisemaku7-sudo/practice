import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStatement, printedTotals } from '../src/lib/validate.js';
import { classifyDocument, isInvestmentDocument } from '../src/lib/parse/doctype.js';

const txs = [{ date: '2026-10-03', amount: -450, balance: 99550 }, { date: '2026-10-05', amount: 260340, balance: 359890 }];

test('balances and printed totals agree: read correctly', () => {
  const v = validateStatement({ transactions: txs, openingBalance: 100000, closingBalance: 359890, period: { start: '2026-10-01', end: '2026-10-31' }, printed: printedTotals('Total paid in £2,603.40\nTotal paid out £4.50') });
  assert.equal(v.level, 'ok');
  assert.ok(v.checks.every((c) => c.ok));
});
test('a column heading "Money in" is not a printed total', () => {
  assert.deepEqual(printedTotals('Date Description Money In (£) Money Out (£) Balance (£)\n01 Oct OPENING 500.00'), { in: [], out: [] });
});
test('closing balance that does not add up fails', () => {
  assert.equal(validateStatement({ transactions: txs, openingBalance: 100000, closingBalance: 7567020 }).level, 'fail');
});
test('screenshots are marked as not checkable', () => {
  assert.equal(validateStatement({ transactions: txs, screenshot: true }).level, 'unchecked');
});
test('investment and pension statements are recognised', () => {
  assert.ok(isInvestmentDocument('Quilter Investment statement Portfolio summary ISA Current value Adviser fees'));
  assert.ok(isInvestmentDocument('Hargreaves Lansdown Stocks and Shares ISA valuation date units held'));
  assert.equal(classifyDocument('Quilter Investment statement Portfolio summary').kind, 'investment');
  assert.equal(isInvestmentDocument('Nationwide FlexDirect statement Balance brought forward Paid out Paid in'), false);
});
test('a statement that only prints its end date is not failed on dates', () => {
  const v = validateStatement({ transactions: txs, openingBalance: 100000, closingBalance: 359890, period: { start: '2026-10-31', end: '2026-10-31' } });
  assert.equal(v.level, 'ok');
});
