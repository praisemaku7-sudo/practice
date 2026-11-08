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

test('payslip with Net Pay as a column heading (amount underneath)', () => {
  const t = `Employee: Mr Alex Doe         Pay date 23/10/2026
Gross Pay        Deductions        Net Pay
3,450.00         846.60            2,603.40
Tax code 1257L   NI number AB123456C`;
  const p = parsePayslip(t);
  assert.equal(p.net, 260340);
  assert.equal(p.gross, 345000);
});

import { typicalPay } from '../src/lib/payslip.js';
test('table payslips (heading row, amounts underneath in the same order) and the payment date', () => {
  const t = [
    'Name          Company        Employee ID     Pay Period Begin    Pay Period End    Payment Date    Payroll ID',
    'Alex Doe      Acme LLP       12345           01/10/2026          31/10/2026        28/10/2026      PR1',
    '',
    '              Gross Pay      GBR Employer Taxes    GBR Employee Taxes    GBR Deductions    Net Pay',
    'Current       4,627.77       631.61                1,232.65              0.00              3,395.12',
    'YTD           23,660.89      3,173.83              5,625.23              0.00              18,035.66',
  ].join('\n');
  const p = parsePayslip(t);
  assert.deepEqual([p.net, p.gross, p.payDate], [339512, 462777, '2026-10-28']);
});

test('typical take-home: latest normal months, one-off correction month left out', () => {
  const r = typicalPay([{ payDate: '2026-06-26', monthlyNet: 356260 }, { payDate: '2026-07-28', monthlyNet: 218504 }, { payDate: '2026-08-28', monthlyNet: 336399 }, { payDate: '2026-09-28', monthlyNet: 336419 }, { payDate: '2026-10-28', monthlyNet: 339512 }]);
  assert.equal(r.monthly, 337443);
  assert.deepEqual(r.oneOffs.map((x) => x.payDate), ['2026-07-28']);
  assert.equal(typicalPay([{ payDate: '2026-10-28', monthlyNet: 339512 }]).monthly, 339512);
});
