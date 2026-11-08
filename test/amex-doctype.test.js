import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStatementLines, cardSummaryBox } from '../src/lib/parse/statementText.js';
import { detectAccountRef } from '../src/lib/parse/layout.js';
import { classifyDocument } from '../src/lib/parse/doctype.js';
import { parseDate } from '../src/lib/dates.js';

const line = (page, y, cells) => ({ page, y, items: cells.map(([x, str]) => ({ x, w: str.length * 5, str })) });

test('month-first dates (American Express)', () => {
  assert.equal(parseDate('Jun 14', 2026), '2026-06-14');
  assert.equal(parseDate('Sep 26, 2026'), '2026-09-26');
  assert.equal(parseDate('Sep 2026'), null);
});

test('Amex-style layout: month-first dates, CR on the next line, totals, summary box', () => {
  // Synthetic statement in the same shape as an Amex PDF (no real data).
  const lines = [
    line(1, 800, [[40, 'Account Summary']]),
    line(1, 790, [[40, 'Previous Closing Balance'], [200, 'New Credits'], [300, 'New Debits'], [400, 'Closing Balance']]),
    line(1, 780, [[40, '£1,000.00'], [150, '-'], [200, '£300.00'], [260, '+'], [300, '£75.00'], [360, '='], [400, '£ 775.00']]),
    line(2, 700, [[40, 'Date'], [90, 'Date'], [140, 'Transaction Details'], [380, 'Foreign Spend'], [500, 'Amount £']]),
    line(2, 690, [[40, 'Sep 26'], [90, 'Sep 26'], [140, 'PAYMENT RECEIVED - THANK YOU'], [520, '200.00']]),
    line(2, 684, [[530, 'CR']]),
    line(2, 670, [[40, 'Sep 13'], [90, 'Sep 13'], [140, 'RESTAURANT'], [260, 'MANCHESTER'], [520, '63.00']]),
    line(2, 660, [[40, 'Total new spend transactions for A PERSON'], [520, '63.00']]),
    line(2, 650, [[40, 'Sep 16'], [90, 'Sep 16'], [140, 'RESTAURANT'], [520, '100.00']]),
    line(2, 645, [[140, 'Dining Benefit']]),
    line(2, 630, [[40, 'Sep 28'], [90, 'Sep 28'], [140, 'INTEREST CHARGE'], [520, '12.00']]),
    line(2, 620, [[40, 'Total of other account transactions'], [520, '88.00']]),
    line(2, 500, [[40, 'Internet Banking - Please use account name X, sort code 30-00-00, account number 00200476']]),
  ];
  const r = parseStatementLines(lines, { fallbackYear: 2026 });
  assert.deepEqual(r.transactions.map((t) => [t.date, t.amount]), [['2026-09-26', 20000], ['2026-09-13', -6300], ['2026-09-16', 10000], ['2026-09-28', -1200]]);
  assert.equal(r.closingBalance, -77500);
  // Spending listed before "Total new spend transactions for A PERSON" is that cardholder's.
  assert.deepEqual(r.transactions.map((t) => t.cardholder || null), ['A PERSON', 'A PERSON', null, null]);
  assert.equal(r.openingBalance, -100000);
  assert.deepEqual(cardSummaryBox('Previous Closing Balance New Credits New Debits Closing Balance\n £1,311.66 - £458.87 + £148.69 = £ 1,001.48'), { previous: 131166, credits: 45887, debits: 14869, closing: 100148 });
});

test('card number wins over the issuer bank details in the "how to pay" box', () => {
  const text = 'Membership Number xxxx-xxxxxx-41009\n...\nInternet Banking - Please use account name American Express, sort code 30-00-00, account number 00200476';
  assert.equal(detectAccountRef(text), '1009');
});

test('non-statements are recognised', () => {
  assert.equal(classifyDocument('PAYSLIP Gross pay £3,000 Net pay £2,300 Tax code 1257L NI number AB123456C Year to date', { transactions: [] }).kind, 'payslip');
  assert.equal(classifyDocument('Order confirmation. Thank you for your order. Order number 123. Subtotal £20. VAT no 123', { transactions: [{}] }).isStatement, false);
  assert.equal(classifyDocument('Current account statement. Sort code 20-00-00 Account number 12345678. Balance brought forward. Paid in Paid out Balance', { transactions: [{}, {}] }).isStatement, true);
  assert.equal(classifyDocument('Lorem ipsum '.repeat(40), { transactions: [] }).isStatement, false);
});
