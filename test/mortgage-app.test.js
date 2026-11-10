import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromAppAI, assessApplication } from '../src/lib/mortgageApp.js';

// Made-up example application (not anyone's real figures).
const ai = {
  lender: 'Example BS', loan_gbp: 200000, property_price_gbp: 300000, term_years: 38, repayment: true, first_time_buyers: true, new_build: true,
  builder_incentive_gbp: 10000, deposit_sources: [{ source: 'Gifted deposit', amount_gbp: 80000 }, { source: 'Savings', amount_gbp: 10000 }], submitted: '2026-11-01',
  applicants: [
    { employment: 'employed', current_job_start: '2026-06-01', gross_income_gbp: 50000, self_employed_latest_gbp: null, self_employed_previous_gbp: null, self_employed_average_gbp: null, rent_monthly_gbp: 750, pension_monthly_gbp: 100, dependants: 1, missed_payments_ever: true, arrears_last_2_years: false, ccj: false, insolvency: false, declined_before: false, other_credit_info: true, income_change_expected: false, commitments: [{ type: 'Credit card', provider: 'Card A', balance_gbp: 1000, monthly_gbp: 30, repaid_in_full: false, plan: 'To remain' }, { type: 'Student loan', provider: 'SLC', balance_gbp: 20000, monthly_gbp: 150, repaid_in_full: null, plan: 'To remain' }] },
    { employment: 'self-employed', current_job_start: '2024-01-01', gross_income_gbp: 40000, self_employed_latest_gbp: 40000, self_employed_previous_gbp: 30000, self_employed_average_gbp: 35000, rent_monthly_gbp: 750, pension_monthly_gbp: null, dependants: 0, missed_payments_ever: false, arrears_last_2_years: false, ccj: false, insolvency: false, declined_before: false, other_credit_info: false, income_change_expected: false, commitments: [{ type: 'Hire purchase', provider: 'Car Co', balance_gbp: 15000, monthly_gbp: 300, repaid_in_full: null, plan: 'To remain' }] },
  ],
  documents_required: ['Last 2 months payslips', 'SA302'],
};

test('application figures are converted to pence', () => {
  const app = fromAppAI(ai);
  assert.equal(app.loan, 20000000);
  assert.equal(app.deposits.length, 2);
  assert.equal(app.applicants[1].seAverage, 3500000);
  assert.equal(app.applicants[0].debts[0].monthly, 3000);
});

test('assessment: LTV, income multiple, conduct, new job, dependants, long term', () => {
  const app = fromAppAI(ai);
  const a = assessApplication(app, { today: '2026-11-10', rate: 4.5, takeHome: 500000, statementDebtMonthly: 48000 });
  assert.equal(a.deposit, 10000000);
  assert.equal(a.ltv, 66.7);
  // Self-employed income uses the lower of latest and 2-year average: 50k + 35k.
  assert.equal(a.gross, 8500000);
  assert.equal(a.lti, 2.35);
  assert.equal(a.declaredMonthly, 48000);
  assert.equal(a.rent, 150000);
  const titles = a.checks.map((c) => c.title).join(' | ');
  assert.match(titles, /Credit history to explain/);
  assert.match(titles, /new job for 5 months/);
  assert.match(titles, /Dependants don't match/);
  assert.ok(a.pay < a.pay25 && a.interest > a.interest25, 'longer term: lower payment, more interest');
});

test('statements showing more debt than declared are flagged', () => {
  const app = fromAppAI(ai);
  const a = assessApplication(app, { today: '2026-11-10', rate: 4.5, statementDebtMonthly: 120000 });
  const d = a.checks.find((c) => /Declared debts/.test(c.title));
  assert.equal(d.ok, false);
});
