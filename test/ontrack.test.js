import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthOutlook, budgetAlerts, outlook } from '../src/lib/forecast.js';
import { extractPlan, suggestBudget, mapCategory } from '../src/lib/plan.js';
import { parseCreditReport, creditChecks, isCreditReport } from '../src/lib/creditreport.js';

const tx = (date, amount, category) => ({ id: date + amount + category, date, amount, category, description: category, merchant: category.toUpperCase() });
const budget = { income: 300000, goalsMonthly: 0, personalAllowance: 10000, byCategory: { eating_out: 10000, groceries: 40000, housing: 120000 }, lines: [{ category: 'eating_out', kind: 'personal', budget: 10000 }, { category: 'groceries', kind: 'essential', budget: 40000 }, { category: 'housing', kind: 'fixed', budget: 120000 }] };

test('this month at today\'s pace: £100 eating out by the 10th of a 30-day month heads to £300', () => {
  const txs = [tx('2026-11-01', -120000, 'housing'), tx('2026-11-05', -6000, 'eating_out'), tx('2026-11-09', -4000, 'eating_out'), tx('2026-11-03', -10000, 'groceries')];
  const o = monthOutlook({ txs, today: '2026-11-10', budget });
  assert.equal(o.spent, 140000);
  assert.equal(o.variableEnd, 60000); // (100 + 100) / 10 days × 30
  assert.equal(o.spendEnd, 180000);
  assert.equal(o.left, 120000);
  const a = budgetAlerts({ txs, today: '2026-11-10', budget });
  assert.equal(a.find((r) => r.category === 'eating_out').status, 'heading');
  assert.equal(a.find((r) => r.category === 'housing').status, 'ok');
});

test('outlook swaps rent for the mortgage from its start month', () => {
  const txs = [];
  for (const m of ['08', '09', '10']) txs.push(tx(`2026-${m}-01`, -250000, 'housing'), tx(`2026-${m}-25`, 300000, 'income'));
  const o = outlook({ txs, today: '2026-11-10', budget, months: 4, housingNow: 250000, mortgage: { principal: 20000000, rate: 4, termYears: 25, startMonth: '2027-01' } });
  assert.equal(o.months[0].spend, 250000); // December: rent
  assert.ok(o.months[1].spend < 250000); // January: a £1,056 mortgage instead of £2,500 rent
});

test('spreadsheet plan: debts, suggested budget, savings and steps found by their headings', () => {
  const sheets = [
    { name: 'Debts', rows: [['DEBTS'], ['Debt', 'Balance (£)', 'APR', 'Min / payment (£)', 'Limit (£)', 'Status'], ['Card A', 1446.1, 0.4095, 60, 1450, 'Highest'], ['Loan B', 0, 0, 338.3, '-', 'Fixed'], ['TOTAL OWED', 1446.1]] },
    { name: 'Suggested Budget', rows: [['Category', 'Now (£)', 'Suggested (£)', 'Change', 'Notes'], ['Eating out', 250, 50, -200, 'Quick win'], ['Card repayments', 450, 450, 0, ''], ['TOTAL OUTGOINGS', 700, 500]] },
    { name: 'Savings Plan', rows: [['Item', 'Now £/mo', 'Action', 'New £/mo', 'Saving £/mo'], ['CANCEL OR DOWNGRADE'], ['Gym', 52.49, 'Freeze', 0, 52.49], ['TOTAL', 52.49]] },
    { name: 'Action Plan', rows: [['ACTION PLAN'], ['STEP 1: STOP THE BLEEDING (this week)'], ['Point every direct debit at one funded account.'], ['STEP 2: CUT'], ['Cancel the flagged subscriptions today.']] },
  ];
  const p = extractPlan(sheets);
  assert.deepEqual(p.debts.map((d) => [d.name, d.balance, d.apr, d.min, d.limit]), [['Card A', 144610, 0.4095, 6000, 145000], ['Loan B', 0, 0, 33830, null]]);
  assert.deepEqual(p.budget.map((b) => [b.category, b.suggested]), [['eating_out', 5000], [null, 45000]]);
  assert.deepEqual(p.savings.map((s) => [s.item, s.saving]), [['Gym', 5249]]);
  assert.deepEqual(p.steps.map((s) => [s.title, s.items.length]), [['STOP THE BLEEDING (this week)', 1], ['CUT', 1]]);
  assert.equal(mapCategory('Bills & phone'), 'bills');
});

test('suggested budget trims lifestyle spending first to close the gap', () => {
  const r = suggestBudget({ avgByCategory: { housing: 150000, groceries: 40000, eating_out: 40000, shopping: 30000 }, income: 240000 });
  assert.equal(r.lines.find((l) => l.category === 'housing').suggested, 150000);
  assert.ok(r.leftSuggested >= 0);
  assert.ok(r.lines.find((l) => l.category === 'eating_out').suggested < 40000);
});

test('credit report: score, accounts, late payments, over limit, hard searches', () => {
  const t = [
    "Alex Example's Credit File", '            612', '            MY SCORE', 'Produced for Alex Example on 28 August 2026',
    'Payment History - Active Accounts',
    'Card Co - Credit Card - Ending 1234',
    'BALANCE     £1,600       £1,600',
    'LIMIT       £1,500       £1,500',
    'STATUS      Normal       Normal',
    'PAYMENT HISTORY   J F M A M J J A S O N D',
    '26  OK OK 1 OK OK OK OK - - - - -',
    'Hard Searches',
    'EXPERIAN 03/07/2026  Searched by LENDER ONE',
    'EQUIFAX 01/06/2026  Searched by LENDER TWO',
    'Soft Searches',
    'EQUIFAX 02/08/2026  Searched by CLEARSCORE',
  ].join('\n');
  assert.ok(isCreditReport(t));
  const r = parseCreditReport(t);
  assert.equal(r.score, 612);
  assert.equal(r.date, '2026-08-28');
  assert.equal(r.accounts.length, 1);
  assert.deepEqual([r.accounts[0].balance, r.accounts[0].limit, r.accounts[0].late12, r.accounts[0].overLimit], [160000, 150000, 1, true]);
  assert.deepEqual(r.hardSearches.map((s) => s.by), ['LENDER ONE', 'LENDER TWO']);
  assert.equal(r.softSearches, 1);
  const titles = creditChecks(r, { today: '2026-09-01' }).map((c) => c.title);
  assert.ok(titles.some((x) => /over its limit/.test(x)));
  assert.ok(titles.some((x) => /2 credit applications in 6 months/.test(x)));
});

import { realityCheck, isTemporary, debtOrder, planStage, targetFor } from '../src/lib/plan.js';
test('better plan maths: reality check, temporary relief, over-limit first, stepped targets', () => {
  const sheets = [{ name: 'Budget', rows: [['Category', 'Now (£)', 'Month 1', 'Month 2', 'Month 3'], ['Eating out', 883, 450, 300, 200], ['Groceries', 300, 400, 400, 375]] }];
  const p = extractPlan(sheets);
  assert.deepEqual(p.budget[0].stages, [45000, 30000, 20000]);
  assert.equal(planStage({ ...p, startMonth: '2026-11' }, '2027-01'), 2);
  assert.equal(planStage({ ...p, startMonth: '2026-11' }, '2027-06'), 2);
  assert.equal(targetFor(p.budget[0], 1), 30000);
  // £50 eating out against £883 actual is flagged; £450 isn't.
  const flat = { budget: [{ label: 'Eating out', category: 'eating_out', now: 88300, suggested: 5000 }] };
  assert.equal(realityCheck(flat, { eating_out: 88300 })[0].cut, 94);
  assert.equal(realityCheck(p, { eating_out: 88300 }, 0).length, 0);
  assert.ok(isTemporary({ action: 'Request a payment holiday', note: '' }));
  assert.ok(!isTemporary({ action: 'Cancel', note: 'You have Bupa via work' }));
  const order = debtOrder([{ name: 'Aqua', balance: 144610, apr: 0.4095, limit: 145000 }, { name: 'CapOne', balance: 53323, apr: 0.2569, limit: 50000 }, { name: 'Gold', balance: 277609, apr: 0.291, limit: 530000 }]);
  assert.deepEqual(order.map((d) => d.name), ['CapOne', 'Aqua', 'Gold']);
});
