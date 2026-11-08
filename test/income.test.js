import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMonthly, personFor, householdFor, incomeTimeline } from '../src/lib/income.js';
import { addMonths } from '../src/lib/dates.js';

const settings = {
  people: [{ id: 'p1', name: 'Alex' }, { id: 'p2', name: 'Jane' }],
  scoped: { p1: { income: 260340 }, p2: { income: 249235 } },
  payslips: { p1: { monthlyNet: 260340, payDate: '2026-10-23' } },
  sa302s: { p2: [{ taxYear: '2024-25', net: 2990820 }] },
  tempIncome: { p2: { label: 'Maternity Allowance', monthly: 84205, weekly: 19432, from: '2026-11', until: '2027-07' } },
  otherIncome: [{ label: 'Child Benefit', amount: 2605, freq: 'week', from: '2026-12', until: null, owner: null }],
};

test('weekly, 4-weekly and yearly amounts to monthly', () => {
  assert.equal(toMonthly(19432, 'week'), 84205); // 194.32 × 52 ÷ 12 = 842.05
  assert.equal(toMonthly(2605, 'week'), 11288);
  assert.equal(toMonthly(120000, 'year'), 10000);
  assert.equal(toMonthly(100000, '4week'), 108333);
});

test('payslip is the source of take-home pay; maternity replaces usual pay while it lasts', () => {
  assert.deepEqual([personFor(settings, 'p1', '2026-11').kind, personFor(settings, 'p1', '2026-11').monthly], ['payslip', 260340]);
  assert.equal(personFor(settings, 'p2', '2026-11').kind, 'temp');
  assert.equal(personFor(settings, 'p2', '2027-08').kind, 'sa302');
  assert.equal(personFor(settings, 'p2', '2026-10').kind, 'sa302', 'not before it starts');
});

test('household total month by month, with Child Benefit starting and maternity ending', () => {
  assert.equal(householdFor(settings, '2026-11').total, 260340 + 84205);
  assert.equal(householdFor(settings, '2026-12').total, 260340 + 84205 + 11288);
  const tl = incomeTimeline(settings, '2026-11', 10, { addMonths });
  assert.deepEqual(tl.changes.map((c) => [c.month, c.name, c.why]), [['2026-12', 'Child Benefit', 'starts'], ['2027-08', 'Jane', 'Maternity Allowance ends']]);
});
