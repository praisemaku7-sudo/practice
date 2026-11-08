import { test } from 'node:test';
import assert from 'node:assert/strict';
import { propertyTax, borrowingRange, ltvBands, savingTimeline } from '../src/lib/mortgage.js';

const gbp = (n) => n * 100;
test('stamp duty: England standard and first-time buyer relief', () => {
  assert.equal(propertyTax(gbp(300000)).tax, gbp(5000));
  assert.equal(propertyTax(gbp(300000), { firstTime: true }).tax, 0);
  assert.equal(propertyTax(gbp(450000), { firstTime: true }).tax, gbp(7500));
  // Over £500k: no relief, standard rates.
  const big = propertyTax(gbp(550000), { firstTime: true });
  assert.equal(big.tax, gbp(17500)); assert.equal(big.relief, false);
  assert.equal(propertyTax(gbp(100000)).tax, 0);
});
test('Scotland and Wales', () => {
  assert.equal(propertyTax(gbp(300000), { region: 'scotland' }).tax, gbp(4600));
  assert.equal(propertyTax(gbp(300000), { region: 'scotland', firstTime: true }).tax, gbp(4000));
  assert.equal(propertyTax(gbp(300000), { region: 'wales' }).tax, gbp(4500));
});
test('borrowing, deposit bands and saving timeline', () => {
  assert.deepEqual(borrowingRange(gbp(60000)), { low: gbp(240000), high: gbp(270000) });
  const b = ltvBands(gbp(300000), gbp(30000));
  assert.equal(b.find((x) => x.ltv === 90).reached, true);
  assert.equal(b.find((x) => x.ltv === 85).short, gbp(15000));
  assert.deepEqual(savingTimeline({ need: gbp(10000), saved: gbp(4000), monthly: gbp(500), fromMonth: '2026-11' }), { gap: gbp(6000), months: 12, month: '2027-11' });
  assert.equal(savingTimeline({ need: gbp(100), saved: gbp(200), fromMonth: '2026-11' }).months, 0);
});
