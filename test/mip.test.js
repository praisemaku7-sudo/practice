import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMIP, isMIP } from '../src/lib/mip.js';

const sample = `Halifax
Agreement in Principle
Date of issue: 03/11/2026
This Agreement in Principle is valid for 90 days.
Applicant 1  Applicant 2
Joint application
Purchase price £300,000
Deposit £30,000
Loan amount £270,000
Mortgage term 30 years
Repayment method: Capital and interest (repayment)
Loan to value 90%`;

test('reads a typical agreement in principle', () => {
  assert.ok(isMIP(sample));
  const m = parseMIP(sample);
  assert.equal(m.lender, 'Halifax');
  assert.equal(m.amount, 27000000);
  assert.equal(m.price, 30000000);
  assert.equal(m.deposit, 3000000);
  assert.equal(m.termYears, 30);
  assert.equal(m.ltv, 90);
  assert.equal(m.applicants, 2);
  assert.equal(m.issued, '2026-11-03');
  assert.equal(m.expires, '2027-02-01');
  assert.equal(m.interestOnly, false);
});

test('wording variants: "you could borrow up to", named dates, rate', () => {
  const m = parseMIP(`Nationwide Decision in Principle
Issued on 12 October 2026. Valid until 9 January 2027.
Based on what you told us, you could borrow up to £245,500.
Term: 25 years 6 months. Initial rate 4.29% fixed for 5 years`);
  assert.equal(m.lender, 'Nationwide');
  assert.equal(m.amount, 24550000);
  assert.equal(m.termYears, 25.5);
  assert.equal(m.rate, 4.29);
  assert.equal(m.issued, '2026-10-12');
  assert.equal(m.expires, '2027-01-09');
});

test('not a mortgage document', () => {
  assert.equal(isMIP('Tesco Clubcard statement'), false);
  assert.equal(parseMIP(''), null);
});
