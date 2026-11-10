import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectRecurring, likelyNewRegular } from '../src/lib/analysis.js';

let n = 0;
const tx = (date, amount, description, category, extra = {}) => ({ id: `t${n++}`, date, amount, description, merchant: null, category, accountId: 'a1', ...extra });
const TODAY = '2026-11-10';
const months = ['2026-07', '2026-08', '2026-09', '2026-10'];

test('two subscriptions under one name are both found', () => {
  const txs = [];
  for (const m of months) { txs.push(tx(`${m}-04`, -299, 'APPLE.COM/BILL', 'subscriptions', { merchant: 'APPLE.COM/BILL' })); txs.push(tx(`${m}-19`, -1099, 'APPLE.COM/BILL', 'subscriptions', { merchant: 'APPLE.COM/BILL' })); }
  const r = detectRecurring(txs, { today: TODAY }).filter((x) => x.name === 'APPLE.COM/BILL');
  assert.deepEqual(r.map((x) => x.amount).sort((a, b) => a - b), [299, 1099]);
});

test('a bill that changes every month (energy) is still regular', () => {
  const amounts = [-6200, -9100, -14800, -11500];
  const txs = months.map((m, i) => tx(`${m}-15`, amounts[i], 'SAMPLE ENERGY DD', 'bills'));
  const r = detectRecurring(txs, { today: TODAY });
  assert.equal(r.length, 1);
  assert.ok(r[0].variable);
  assert.equal(r[0].amount, 11500); // median of the last three
  assert.equal(r[0].priceChange, 0);
});

test('weekly and quarterly bills count, as a monthly amount', () => {
  const txs = [];
  for (let d = 0; d < 10; d++) { const day = new Date(Date.UTC(2026, 8, 7 + d * 7)).toISOString().slice(0, 10); txs.push(tx(day, -5000, 'SAMPLE NURSERY DD', 'childcare')); }
  for (const dt of ['2026-03-01', '2026-06-01', '2026-09-01']) txs.push(tx(dt, -12000, 'SAMPLE WATER CO', 'bills'));
  const r = detectRecurring(txs, { today: TODAY });
  const w = r.find((x) => x.freq === 'weekly');
  const q = r.find((x) => x.freq === 'quarterly');
  assert.ok(w && q, JSON.stringify(r.map((x) => [x.name, x.freq])));
  assert.equal(w.amount, Math.round((5000 * 52) / 12));
  assert.equal(w.perPayment, 5000);
  assert.equal(q.amount, 4000);
});

test('a reference code that changes each month does not split the payee', () => {
  const txs = months.map((m, i) => tx(`${m}-08`, -4500, `SAMPLE BROADBAND ${8500120 + i}A${i}B`, 'bills'));
  assert.equal(detectRecurring(txs, { today: TODAY }).length, 1);
});

test('a subscription paid through PayPal is found under its own name', () => {
  const txs = months.map((m) => tx(`${m}-12`, -1199, 'PAYPAL *SAMPLEMUSIC', 'subscriptions', { merchant: 'PAYPAL' }));
  const r = detectRecurring(txs, { today: TODAY });
  assert.equal(r.length, 1);
});

test('weekly food shops are still not bills', () => {
  const txs = [];
  for (let d = 0; d < 10; d++) txs.push(tx(new Date(Date.UTC(2026, 8, 5 + d * 7)).toISOString().slice(0, 10), -6000, 'SAMPLE SUPERMARKET', 'groceries'));
  assert.equal(detectRecurring(txs, { today: TODAY }).length, 0);
});

test('new payments seen once are suggested when they look regular', () => {
  const txs = [
    tx('2026-11-02', -37214, 'SAMPLE MOTOR FINANCE', 'debt'),
    tx('2026-11-03', -2500, 'SAMPLE GYM DD', 'other'),
    tx('2026-11-04', -4200, 'SAMPLE CAFE', 'eating_out'),
    tx('2026-11-05', -12000, 'SAMPLE CARD CREDIT CARD', 'debt'),
  ];
  const s = likelyNewRegular(txs, [], { today: TODAY });
  assert.deepEqual(s.map((x) => x.why), ['Loan or finance', 'Direct Debit']);
});

test('the calendar places weekly and quarterly payments on their real dates', async () => {
  const { occurrences } = await import('../src/lib/cashflow.js');
  const w = { key: 'w', day: 3, amount: 21667, perPayment: 5000, freq: 'weekly', lastDate: '2026-11-03' };
  assert.deepEqual(occurrences(w, '2026-12').map((o) => [o.date, o.r.amount]), [['2026-12-01', 5000], ['2026-12-08', 5000], ['2026-12-15', 5000], ['2026-12-22', 5000], ['2026-12-29', 5000]]);
  const q = { key: 'q', day: 1, amount: 4000, perPayment: 12000, freq: 'quarterly', lastDate: '2026-09-01' };
  assert.equal(occurrences(q, '2026-11').length, 0);
  assert.deepEqual(occurrences(q, '2026-12').map((o) => o.r.amount), [12000]);
  assert.equal(occurrences({ key: 'm', day: 15, amount: 900 }, '2026-12')[0].date, '2026-12-15');
});

test('a pub called "Under Water" is not a water bill', async () => {
  const { categorize } = await import('../src/lib/categorize.js');
  assert.notEqual(categorize('WETHERSPOONS TO: MOON UNDER WATER, MANCHESTER'), 'bills');
  assert.equal(categorize('SAMPLE WATER DD'), 'bills');
});
