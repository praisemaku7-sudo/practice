import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSA302, isSA302 } from '../src/lib/sa302.js';

test('SA302 tax calculation → yearly and monthly take-home', () => {
  const t = `HM Revenue & Customs  SA302  Tax calculation
Tax year 2024-25   Year ended 5 April 2025
Total income received          £36,000.00
minus Personal Allowance       £12,570.00
Total income on which tax has been charged  £23,430.00
Income Tax due after allowances and reliefs  £4,686.00
Class 4 National Insurance contributions  £1,405.80
Total Income Tax and Class 2 and 4 NIC due  £6,091.80`;
  const r = parseSA302(t);
  assert.equal(r.taxYear, '2024-25');
  assert.equal(r.totalIncome, 3600000);
  assert.equal(r.taxDue, 609180);
  assert.equal(r.monthlyNet, Math.round((3600000 - 609180) / 12));
});

test('adds the tax parts when there is no single total, and ignores non-SA302s', () => {
  const r = parseSA302('SA302 Tax year 2023-24\nTotal income received 30,000.00\nIncome Tax due 3,486.00\nClass 4 NIC 1,000.00\nClass 2 NIC 179.40');
  assert.equal(r.taxDue, 466540);
  assert.equal(isSA302('Current account statement. Balance brought forward'), false);
});

test('tax calculation without the word SA302, amounts underneath or without pence', async () => {
  const { parseSA302 } = await import('../src/lib/sa302.js');
  const t = `HM Revenue & Customs
Tax calculation for the year 6 April 2024 to 5 April 2025
Total income received
£36,000
Total Income Tax and Class 2 and 4 NIC due     £6,091.80`;
  const r = parseSA302(t, 'SA302 2025.pdf');
  assert.equal(r.totalIncome, 3600000);
  assert.equal(r.taxDue, 609180);
  assert.equal(r.taxYear, '2024-25');
});
