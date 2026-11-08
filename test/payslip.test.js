import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePayslip, toMonthly } from '../src/lib/payslip.js';

test('monthly payslip', () => {
  const p = parsePayslip('ACME LTD Payslip\nEmployer: Acme Ltd\nPay Date 25/10/2026\nGross Pay 3,450.00\nTax 412.20\nNI 210.10\nNet Pay £2,603.40\nYear to date gross 24,000.00');
  assert.equal(p.net, 260340);
  assert.equal(p.gross, 345000);
  assert.equal(p.frequency, 'monthly');
  assert.equal(p.monthlyNet, 260340);
  assert.equal(p.payDate, '2026-10-25');
});

test('weekly and four-weekly payslips convert to monthly', () => {
  assert.equal(parsePayslip('Pay frequency: Weekly  Week no 31  NET PAY 500.00').monthlyNet, toMonthly(50000, 'weekly'));
  assert.equal(toMonthly(130000, 'four-weekly'), 140833);
  assert.equal(parsePayslip('Bank statement balance 100.00'), null);
});
