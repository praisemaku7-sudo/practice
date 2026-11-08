import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthlyPayment, schedule, projection, byYear } from '../src/lib/mortgage.js';

test('repayment mortgage: £250,000 over 25 years at 4.5% is about £1,389.58/month', () => {
  assert.ok(Math.abs(monthlyPayment(25000000, 4.5, 300) - 138958) <= 2);
});
test('interest-only is principal × rate / 12', () => {
  assert.equal(monthlyPayment(25000000, 4.8, 300, { interestOnly: true }), 100000);
});
test('schedule pays off to zero; total interest matches payments minus principal', () => {
  const s = schedule({ principal: 20000000, rate: 4, termYears: 25, startMonth: '2027-01' });
  assert.equal(s.rows.at(-1).balance, 0);
  const paid = s.rows.reduce((a, r) => a + r.payment, 0);
  assert.ok(Math.abs(paid - 20000000 - s.totalInterest) <= 1);
  assert.equal(s.rows[0].month, '2027-01');
  assert.equal(byYear(s.rows).length, 25);
});
test('fixed then follow-on rate recalculates the payment', () => {
  const s = schedule({ principal: 20000000, rate: 4, termYears: 25, fixedYears: 5, followRate: 7, startMonth: '2027-01' });
  assert.ok(s.afterFix.payment > s.payment);
  assert.equal(s.rows[60].rate, 7);
});
test('overpaying shortens the term and saves interest', () => {
  const base = schedule({ principal: 20000000, rate: 4, termYears: 25 });
  const over = schedule({ principal: 20000000, rate: 4, termYears: 25, overpay: 20000 });
  assert.ok(over.months < base.months && over.totalInterest < base.totalInterest);
});
test('projection swaps rent for the mortgage from the start month', () => {
  const p = projection({ fromMonth: '2026-11', months: 4, income: 500000, everydaySpend: 200000, rent: 120000, mortgage: { principal: 20000000, rate: 4, termYears: 25, startMonth: '2027-01', extraCosts: 5000 } });
  assert.deepEqual(p.map((r) => r.mortgage), [false, false, true, true]);
  assert.equal(p[0].housing, 120000);
  assert.equal(p[2].housing, monthlyPayment(20000000, 4, 300) + 5000);
});
