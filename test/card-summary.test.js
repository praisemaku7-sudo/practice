import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStatementLines } from '../src/lib/parse/statementText.js';
import { cardSummaryFields } from '../src/lib/parse/cardSummary.js';
import { reconcile } from '../src/lib/parse/layout.js';

const line = (page, y, cells) => ({ page, y, items: cells.map(([x, str]) => ({ x, w: str.length * 5, str })) });

test('Aqua-style summary in columns, interest only in the summary', () => {
  // Synthetic (no real data): figures printed under their headings.
  const lines = [
    line(1, 820, [[40, 'Aqua Classic credit card statement']]),
    line(1, 810, [[40, 'Statement date 3 August 2026']]),
    line(1, 800, [[40, 'Previous balance'], [140, 'Payments'], [230, 'New spending'], [330, 'Interest'], [420, 'New balance'], [520, 'Minimum payment']]),
    line(1, 790, [[40, '£1,240.00'], [140, '£100.00'], [230, '£60.00'], [330, '£35.40'], [420, '£1,235.40'], [520, '£37.00']]),
    line(1, 770, [[40, 'Credit limit £1,500.00'], [200, 'Available to spend £264.60'], [360, 'APR 34.9%']]),
    line(2, 700, [[40, 'Date'], [100, 'Description'], [450, 'Amount']]),
    line(2, 690, [[40, '10 Jul'], [100, 'TESCO STORES'], [450, '35.00']]),
    line(2, 680, [[40, '20 Jul'], [100, 'SHELL PETROL'], [450, '25.00']]),
    line(2, 670, [[40, '25 Jul'], [100, 'PAYMENT RECEIVED - THANK YOU'], [450, '100.00 CR']]),
  ];
  const r = parseStatementLines(lines, { fallbackYear: 2026 });
  assert.equal(r.openingBalance, -124000);
  assert.equal(r.closingBalance, -123540); // not the £37 minimum payment or the credit limit
  assert.ok(r.balanceProven);
  const interest = r.transactions.find((t) => /interest/i.test(t.description));
  assert.equal(interest?.amount, -3540);
  assert.equal(reconcile(r).confident, true);
});

test('summary one figure per line, with fees', () => {
  const t = ['Your account summary', 'Previous balance £500.00', 'Payments and credits -£200.00', 'Purchases £80.00', 'Interest charged £10.50', 'Fees £12.00', 'New balance £402.50 Minimum payment £25.00'].join('\n');
  assert.deepEqual(cardSummaryFields(t), { previous: 50000, credits: 20000, debits: 8000, interest: 1050, fees: 1200, closing: 40250 });
});

test('figures that do not add up are not trusted', () => {
  assert.equal(cardSummaryFields('Previous balance £500.00\nPayments £200.00\nPurchases £80.00\nNew balance £999.00'), null);
});

test('new balance and minimum payment on one line: takes the balance', () => {
  const lines = [
    line(1, 800, [[40, 'Credit card statement. Credit limit £2,000.00. APR 29.9%. Minimum payment due 25 Aug']]),
    line(1, 790, [[40, 'New balance'], [140, '£820.00'], [260, 'Minimum payment'], [380, '£25.00']]),
    line(2, 700, [[40, 'Date'], [100, 'Description'], [450, 'Amount']]),
    line(2, 690, [[40, '10 Jul'], [100, 'TESCO STORES'], [450, '35.00']]),
  ];
  assert.equal(parseStatementLines(lines, { fallbackYear: 2026 }).closingBalance, 82000);
});

import { cardSummary } from '../src/lib/credit.js';
import { accountChecks } from '../src/lib/checks.js';

test('owed counts every transaction on the card, not just the ones in view', () => {
  const accounts = [{ id: 'aq', type: 'credit', balance: -50000, balanceDate: '2026-05-20' }];
  const allTxs = [{ accountId: 'aq', date: '2026-05-28', amount: -4000, category: 'groceries' }, { accountId: 'aq', date: '2026-06-10', amount: -6000, category: 'groceries', cardholder: 'Sarah' }];
  const r = cardSummary({ accounts, txs: [], allTxs, today: '2026-06-15', trackFrom: '2026-06-01' });
  assert.equal(r.cards[0].owed, 60000);
});

test('sense check: latest statement disagrees with the app', () => {
  const accounts = [{ id: 'aq', name: 'Aqua', type: 'credit', balance: -50000, balanceDate: '2026-07-03', balanceUnverified: { amount: -70000, date: '2026-08-03', file: 'Aug.pdf' } }];
  const txs = [{ accountId: 'aq', date: '2026-07-10', amount: -6000 }];
  const c = accountChecks({ accounts, txs, today: '2026-08-10' });
  assert.equal(c[0].level, 'bad');
  assert.match(c[0].detail, /£700\.00.*£560\.00 \(too low\)/);
});
