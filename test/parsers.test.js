import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStatementLines } from '../src/lib/parse/statementText.js';
import { parseCSVStatement } from '../src/lib/parse/csv.js';
import { parseMoney, parsePrice } from '../src/lib/money.js';
import { parseDate, matchLeadingDate } from '../src/lib/dates.js';

// Build a fake pdf.js line: cells = [[x, text], ...] with ~5pt per char widths.
const line = (y, cells) => ({ page: 1, y, items: cells.map(([x, str]) => ({ x, w: str.length * 5, str })) });

test('money parsing', () => {
  assert.equal(parseMoney('£1,234.56').pence, 123456);
  assert.equal(parseMoney('-12.00').negative, true);
  assert.equal(parseMoney('(12.00)').negative, true);
  assert.equal(parseMoney('45.10CR').credit, true);
  assert.equal(parseMoney('hello'), null);
  assert.equal(parsePrice('£1,299'), 129900);
  assert.equal(parsePrice('1.2k'), 120000);
  assert.equal(parsePrice('49.99'), 4999);
});

test('dates', () => {
  assert.equal(parseDate('03/10/2026'), '2026-10-03');
  assert.equal(parseDate('3 Oct 26'), '2026-10-03');
  assert.equal(parseDate('12 October 2026'), '2026-10-12');
  assert.equal(parseDate('2026-10-12 14:22:01'), '2026-10-12');
  assert.equal(parseDate('12 Oct', 2025), '2025-10-12');
  assert.equal(matchLeadingDate('TESCO 12 Oct'), null);
});

test('columnar statement (paid out / paid in / balance)', () => {
  // Right edges: Paid out ~ 345, Paid in ~ 425, Balance ~ 505
  const lines = [
    line(800, [[40, 'Your statement 1 October 2026 to 31 October 2026']]),
    line(700, [[40, 'Date'], [100, 'Description'], [305, 'Paid out'], [390, 'Paid in'], [470, 'Balance']]),
    line(680, [[40, '01 Oct'], [100, 'BALANCE BROUGHT FORWARD'], [450, '1,000.00']]),
    line(660, [[40, '02 Oct'], [100, 'TESCO STORES 3297'], [320, '25.50'], [475, '974.50']]),
    line(640, [[100, 'CARD PAYMENT LONDON']]),
    line(620, [[40, '03 Oct'], [100, 'ACME LTD SALARY'], [385, '2,000.00'], [460, '2,974.50']]),
    line(600, [[100, 'NETFLIX.COM'], [320, '12.99'], [460, '2,961.51']]),
    line(580, [[40, '31 Oct'], [100, 'BALANCE CARRIED FORWARD'], [460, '2,961.51']]),
  ];
  const r = parseStatementLines(lines, { fallbackYear: 2020 });
  assert.equal(r.transactions.length, 3);
  assert.deepEqual(r.transactions.map((t) => t.amount), [-2550, 200000, -1299]);
  assert.equal(r.transactions[0].date, '2026-10-02');
  assert.match(r.transactions[0].description, /TESCO STORES 3297 CARD PAYMENT LONDON/);
  assert.equal(r.transactions[2].date, '2026-10-03'); // date carried forward
  assert.equal(r.closingBalance, 296151);
  assert.equal(r.openingBalance, 100000);
});

test('signed single-amount statement (Monzo style)', () => {
  const lines = [
    line(700, [[40, 'Date'], [120, 'Description'], [400, 'Amount'], [480, 'Balance']]),
    line(680, [[40, '05/11/2026'], [120, 'Pret A Manger'], [400, '-4.20'], [480, '95.80']]),
    line(660, [[40, '06/11/2026'], [120, 'Refund from Amazon'], [400, '20.00'], [480, '115.80']]),
  ];
  const r = parseStatementLines(lines);
  assert.deepEqual(r.transactions.map((t) => t.amount), [-420, 2000]);
});

test('credit card with CR and two dates, no headers matched', () => {
  const lines = [
    line(700, [[40, '12 Oct 26 13 Oct 26 DELIVEROO LONDON'], [450, '23.40']]),
    line(680, [[40, '15 Oct 26 15 Oct 26 PAYMENT RECEIVED - THANK YOU'], [450, '400.00CR']]),
  ];
  const r = parseStatementLines(lines);
  assert.deepEqual(r.transactions.map((t) => t.amount), [-2340, 40000]);
  assert.equal(r.transactions[0].description, 'DELIVEROO LONDON');
});

test('balance fixes wrong sign guess', () => {
  const lines = [
    line(700, [[40, '01/10/2026'], [100, 'Opening balance'], [450, '100.00']]),
    line(680, [[40, '02/10/2026'], [100, 'SOMETHING FROM SOMEONE'], [380, '10.00'], [450, '90.00']]),
  ];
  const r = parseStatementLines(lines);
  assert.equal(r.transactions[0].amount, -1000);
});

test('Dec to Jan rollover without years', () => {
  const lines = [
    line(800, [[40, 'Statement period 1 December 2025 to 31 January 2026']]),
    line(700, [[40, '30 Dec'], [100, 'SHOP A'], [400, '-5.00']]),
    line(680, [[40, '02 Jan'], [100, 'SHOP B'], [400, '-6.00']]),
  ];
  const r = parseStatementLines(lines);
  assert.deepEqual(r.transactions.map((t) => t.date), ['2025-12-30', '2026-01-02']);
});

test('CSV: Monzo style signed amount', () => {
  const csv = 'Transaction ID,Date,Time,Type,Name,Emoji,Category,Amount,Currency\ntx_1,05/11/2026,08:01:00,Card payment,Pret A Manger,,Eating out,-4.20,GBP\ntx_2,06/11/2026,09:00:00,Faster payment,"Acme, Ltd",,Income,2000.00,GBP\n';
  const r = parseCSVStatement(csv);
  assert.equal(r.transactions.length, 2);
  assert.equal(r.transactions[0].amount, -420);
  assert.equal(r.transactions[1].description, 'Acme, Ltd');
});

test('CSV: Barclays/Lloyds style debit/credit columns', () => {
  const csv = 'Transaction Date,Transaction Type,Sort Code,Account Number,Transaction Description,Debit Amount,Credit Amount,Balance\n02/10/2026,DEB,11-22-33,12345678,TESCO STORES,25.50,,974.50\n03/10/2026,FPI,11-22-33,12345678,ACME SALARY,,2000.00,2974.50\n';
  const r = parseCSVStatement(csv);
  assert.deepEqual(r.transactions.map((t) => t.amount), [-2550, 200000]);
  assert.equal(r.closingBalance, 297450);
});
