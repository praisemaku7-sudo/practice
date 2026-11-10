import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStatementLines } from '../src/lib/parse/statementText.js';
import { categorize } from '../src/lib/categorize.js';
import { looksLikeCreditText } from '../src/lib/credit.js';

// Made-up statement rows laid out like the real PDFs (x positions in points).
const row = (...items) => ({ items: items.map(([str, x, w]) => ({ str, x, w })) });
const HEADER = row(['Date', 53, 17], ['Payment type and details', 117, 97], ['£ Paid out', 350, 38], ['£ Paid in', 438, 33], ['£ Balance', 513, 36]);

test('HSBC-style: "£" of the next heading does not shift the Paid out column', () => {
  const lines = [
    row(['01 Oct 26', 53, 32], ['BALANCE BROUGHT FORWARD', 117, 120], ['8.53', 532, 17], ['D', 552, 5]),
    HEADER,
    row(['02 Oct 26', 53, 32], ['CR', 113, 11], ['Alex Sample', 140, 40]),
    row(['Spending', 140, 31], ['86.00', 454, 18]),
    row(['VIS', 113, 13], ['COFFEE SHOP', 140, 50], ['2.30', 372, 15]),
    row(['CR', 113, 11], ['Alex Sample', 140, 40]),
    row(['Love you', 140, 30], ['20.00', 454, 18], ['95.17', 533, 18]),
    row(['03 Oct 26', 53, 32], ['BP', 113, 10], ['Sample Lettings', 140, 50], ['50.00', 369, 18], ['45.17', 533, 18]),
    row(['03 Oct 26', 53, 32], ['BALANCE CARRIED FORWARD', 117, 120], ['45.17', 533, 18]),
  ];
  const r = parseStatementLines(lines, { fallbackYear: 2026 });
  assert.equal(r.openingBalance, -853, 'overdrawn "D" opening balance');
  const amounts = r.transactions.map((t) => t.amount);
  assert.deepEqual(amounts, [8600, -230, 2000, -5000]);
  assert.ok(/Alex Sample/.test(r.transactions[2].description), 'payer name stays with its own credit');
  assert.equal(r.openingBalance + amounts.reduce((a, b) => a + b, 0), r.closingBalance);
});

test('foreign-currency lines are not counted as sterling payments', () => {
  const lines = [
    row(['Date', 40, 20], ['Description', 120, 50], ['Money out', 420, 40], ['Money in', 520, 40], ['Balance', 610, 40]),
    row(['27 Sept 2026', 40, 60], ['Sample Golf Club', 120, 80], ['£39.78', 422, 38], ['£479.78', 612, 38]),
    row(['Revolut Rate £1.00 = 64.39 TRY (ECB rate* £1.00 = 64.56 TRY)', 120, 280], ['2,561.00', 420, 40], ['TRY', 462, 18]),
    row(['To: Sample Golf Club, Antalya, TUR', 120, 160]),
  ];
  const r = parseStatementLines(lines, { fallbackYear: 2026 });
  assert.deepEqual(r.transactions.map((t) => t.amount), [-3978]);
});

test('bank payment codes are not merchants; council tax by Direct Debit', () => {
  assert.equal(categorize('BP Sample Lettings and Co 1 High Street', -200000, {}), 'housing');
  assert.notEqual(categorize('BP Sample Person Transfer', -160000, {}), 'transport');
  assert.equal(categorize('DD MANCHESTER C C', -17100, {}), 'bills');
  assert.equal(categorize('BP SHELL', -3000, {}), 'transport');
});

test('a current account statement with card small print is not a credit card', () => {
  const t = 'Revolut Bank\nAccount (Current Account)\nThe statement balance only reflects completed transactions. Interest rates may change.';
  assert.equal(looksLikeCreditText(t), false);
  assert.equal(looksLikeCreditText('Credit limit £1,500\nMinimum payment £25\nPayment due date 3 Nov'), true);
});

test('Apple Pay log lines from the Shortcut', async () => {
  globalThis.window ||= undefined;
  const { parseApplePayLog } = await import('../src/ui/import.js').catch(() => ({}));
  if (!parseApplePayLog) return; // the import module needs a browser; covered in the browser test
  const rows = parseApplePayLog('applepay|2026-11-10T12:30:00Z|Sample Cafe|£4.50|Sample Debit\nnot a line\napplepay|10 Nov 2026 at 13:05|Sample Shop|12.00|Card');
  assert.equal(rows.length, 2);
});
