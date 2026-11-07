import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categorize, merchantKey } from '../src/lib/categorize.js';
import { toTransactions, dedupe } from '../src/lib/importer.js';
import { markTransfers, summarizeMonth, detectRecurring, detectPayday, compareMonths } from '../src/lib/analysis.js';
import { buildBudget } from '../src/lib/budget.js';
import { canIAfford } from '../src/lib/afford.js';
import { buildInsights } from '../src/lib/insights.js';
import { consolidationPlan } from '../src/lib/consolidate.js';
import { demoData } from '../src/lib/demo.js';

const TODAY = '2026-11-07';

function demoTxs() {
  const { accounts, rows } = demoData(TODAY);
  const byAcc = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const txs = [];
  for (const a of accounts) txs.push(...toTransactions(rows.filter((r) => r.accountId === a.id), { accountId: a.id, importId: 'demo', source: 'demo' }));
  markTransfers(txs, byAcc);
  return { txs, accounts };
}

test('categoriser handles common UK merchants', () => {
  assert.equal(categorize('CARD PAYMENT TO TESCO STORES 3297 ON 12 OCT', -2550), 'groceries');
  assert.equal(categorize('DELIVEROO LONDON', -2300), 'takeaway');
  assert.equal(categorize('UBER *TRIP', -1200), 'transport');
  assert.equal(categorize('UBER EATS', -1200), 'takeaway');
  assert.equal(categorize('ACME LTD SALARY BGC', 280000), 'income');
  assert.equal(categorize('BRITISH GAS DD', -9000), 'bills');
  assert.equal(categorize('BARCLAYCARD DD', -9000), 'debt');
  assert.equal(categorize('NETFLIX.COM', -1299), 'subscriptions');
  assert.equal(categorize('TRANSFER TO EASY SAVER', -30000), 'savings');
  assert.equal(categorize('RANDOM THING', -500, { 'RANDOM THING': 'gifts' }), 'gifts');
  assert.equal(merchantKey('CARD PAYMENT TO TESCO STORES 3297 ON 12 OCT'), 'TESCO STORES');
});

test('import ids are stable so re-importing dedupes', () => {
  const rows = [{ date: '2026-10-01', description: 'PRET', amount: -300 }, { date: '2026-10-01', description: 'PRET', amount: -300 }];
  const a = toTransactions(rows, { accountId: 'x' });
  const b = toTransactions(rows, { accountId: 'x' });
  assert.notEqual(a[0].id, a[1].id); // two identical coffees stay two
  const { fresh, dupes } = dedupe(b, new Set(a.map((t) => t.id)));
  assert.equal(fresh.length, 0);
  assert.equal(dupes.length, 2);
});

test('transfers between own accounts are not spending', () => {
  const { txs } = demoTxs();
  const amex = txs.filter((t) => /AMEX PAYMENT|PAYMENT RECEIVED/.test(t.description));
  assert.ok(amex.length > 0);
  assert.ok(amex.every((t) => t.category === 'transfer'));
  const save = txs.find((t) => t.description === 'TRANSFER TO EASY SAVER');
  assert.equal(save.category, 'savings');
});

test('monthly summary, recurring and payday', () => {
  const { txs } = demoTxs();
  const s = summarizeMonth(txs, '2026-10');
  assert.equal(s.income, 285000);
  assert.ok(s.spend > 200000 && s.spend < 320000, `spend ${s.spend}`);
  assert.equal(s.saved, 30000);
  const rec = detectRecurring(txs, { today: TODAY });
  const names = rec.map((r) => r.name);
  for (const n of ['NETFLIX', 'OCTOPUS ENERGY', 'OPENRENT LTD']) assert.ok(names.some((x) => x.startsWith(n)), `${n} in ${names}`);
  assert.ok(!names.some((x) => x.startsWith('TESCO')), 'groceries are not a subscription');
  const octo = rec.find((r) => r.name.startsWith('OCTOPUS'));
  assert.equal(octo.type, 'Direct Debit');
  assert.equal(octo.priceChange, 1400);
  assert.deepEqual(detectPayday(rec).day, 25);
  const cmp = compareMonths(txs, '2026-10');
  assert.ok(cmp.hasPrev && cmp.trailingMonths === 3);
});

test('budget hits the savings target and splits fun money', () => {
  const { txs } = demoTxs();
  const b = buildBudget(txs, {}, { today: TODAY });
  assert.deepEqual(b.months, ['2026-08', '2026-09', '2026-10']);
  assert.equal(b.income, 285000);
  assert.equal(b.savingsTarget, 57000);
  const total = b.lines.reduce((a, l) => a + l.budget, 0);
  assert.ok(total + b.savingsTarget <= b.income, 'budget fits income');
  assert.ok(b.personalAllowance > 0);
  const over = buildBudget(txs, { budgets: { shopping: 10000 } }, { today: TODAY });
  assert.equal(over.byCategory.shopping.budget, 10000);
});

test('can I afford: small yes, huge no', () => {
  const { txs, accounts } = demoTxs();
  const budget = buildBudget(txs, {}, { today: TODAY });
  const recurring = detectRecurring(txs, { today: TODAY });
  const small = canIAfford({ price: 1000, category: 'entertainment', txs, budget, recurring, balance: 150000, payday: 25, today: TODAY });
  assert.notEqual(small.verdict, 'no', JSON.stringify(small.checks));
  const big = canIAfford({ price: 250000, category: 'shopping', txs, budget, recurring, balance: 150000, payday: 25, today: TODAY });
  assert.equal(big.verdict, 'no');
  assert.ok(big.advice.length > 0);
  assert.equal(big.checks.find((c) => c.id === 'bills').pass, false);
  const noBal = canIAfford({ price: 1000, category: 'groceries', txs, budget, recurring, today: TODAY });
  assert.equal(noBal.checks.find((c) => c.id === 'bills').pass, null);
  assert.ok(!noBal.checks.find((c) => c.id === 'fun'), 'essentials skip the fun-money check');
  void accounts;
});

test('insights and consolidation plan', () => {
  const { txs, accounts } = demoTxs();
  const budget = buildBudget(txs, {}, { today: TODAY });
  const recurring = detectRecurring(txs, { today: TODAY });
  const ins = buildInsights({ txs, key: '2026-10', budget, recurring, accounts });
  const ids = ins.map((i) => i.id);
  assert.ok(ids.includes('subs'));
  assert.ok(ids.includes('streaming'));
  assert.ok(ids.some((i) => i.startsWith('rise-')));
  assert.ok(ids.includes('consolidate'));
  const plan = consolidationPlan({ accounts, recurring, mainAccountId: 'demo-main' });
  const old = plan.steps.find((s) => s.accountId === 'demo-old');
  assert.ok(old.items.length >= 4);
  assert.equal(old.switchSuggested, true);
});
