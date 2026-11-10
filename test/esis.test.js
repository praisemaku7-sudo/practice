import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isESIS, parseESIS } from '../src/lib/esis.js';

// Made-up illustration in the standard section layout, joined the way the app joins PDF lines.
const TEXT = `Mortgage Illustration
This document was produced for Example Customer on 02 March 2026.
1 Lender
Example Building Society
3 Main features of the loan
Amount and currency of the loan to be granted: £180,000.00
Duration of the loan: 30 years
The mortgage in this illustration is for a house purchase based on a purchase price of £240,000.00.
This is a repayment mortgage, where you gradually pay off the amount you have borrowed
Your mortgage is on a fixed rate of 4.75% until 01 - MAR - 2031.
After 01 - MAR - 2031, the rate that will apply is our Standard Variable Rate, currently 7.25%.
Total amount to be repaid: £350,000.00
4 Interest rate and other costs
The APRC applicable to your loan is 6.4%.
Arrangement fee payable when you apply for the loan or, if the fee is added to the
£1,495.00
loan amount, when the loan starts.
Funds release fee deducted from the advance when the loan starts
£25.00
5 Frequency and number of payments
Number of payments: 360
6 Amount of each instalment
60 payments at a fixed rate of 4.75% £938.97
Followed by
300 payments at a variable rate currently 7.25% £1,170.10
then for a one percentage point increase in our Standard Variable Rate your monthly payment will increase by around £110.00.
8 Early repayment
ALL 02 - MAR - 2026 to 01 - MAR - 2029 3.00% of the amount repaid. £5,400.00
ALL 02 - MAR - 2029 to 01 - MAR - 2031 2.00% of the amount repaid. £3,600.00
Overpayments
During the early repayment charge period you can make overpayments on this mortgage, of up to 10% of the outstanding balance`;

test('recognises a mortgage illustration', () => {
  assert.ok(isESIS(TEXT));
  assert.ok(!isESIS('Statement of account\nOpening balance'));
});

test('reads the figures from a mortgage illustration', () => {
  const e = parseESIS(TEXT);
  assert.equal(e.lender, 'Example Building Society');
  assert.equal(e.loan, 18000000);
  assert.equal(e.termYears, 30);
  assert.equal(e.price, 24000000);
  assert.equal(e.interestOnly, false);
  assert.equal(e.rate, 4.75);
  assert.equal(e.fixedUntil, '2031-03-01');
  assert.equal(e.followRate, 7.25);
  assert.equal(e.aprc, 6.4);
  assert.equal(e.produced, '2026-03-02');
  assert.equal(e.payFixed, 93897);
  assert.equal(e.payAfter, 117010);
  assert.equal(e.steps[0].count, 60);
  assert.equal(e.perPoint, 11000);
  assert.deepEqual(e.fees.map((f) => f.amount), [149500, 2500]);
  assert.equal(e.ercs.length, 2);
  assert.equal(e.ercs[0].pct, 3);
  assert.equal(e.ercs[1].to, '2031-03-01');
  assert.equal(e.overpayPct, 10);
  assert.equal(e.total, 35000000);
});
