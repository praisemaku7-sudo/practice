import { test } from 'node:test';
import assert from 'node:assert/strict';
import { similarity, matchIncoming, findStoredDuplicates } from '../src/lib/duplicates.js';
import { overlapReport } from '../src/lib/coverage.js';
import { cardSummary, payoffPlan, suspectedCreditCards, looksLikeCreditText, owedNow } from '../src/lib/credit.js';
import { toTransactions } from '../src/lib/importer.js';
import { buildBudget } from '../src/lib/budget.js';

test('same payment worded differently is recognised', () => {
  assert.ok(similarity('CARD PAYMENT TO TESCO STORES 3297 ON 02 OCT', 'Tesco Stores') >= 0.5);
  assert.ok(similarity("SAINSBURY'S S/MKT", 'SAINSBURYS SUPERMARKET') >= 0.5);
  assert.ok(similarity('NETFLIX.COM', 'SPOTIFY UK') < 0.5);
});

test('PDF vs CSV of the same month: dates 1-2 days apart, different wording', () => {
  const pdf = toTransactions([
    { date: '2026-10-02', description: 'CARD PAYMENT TO TESCO STORES 3297 ON 01 OCT', amount: -2550 },
    { date: '2026-10-04', description: 'DIRECT DEBIT BRITISH GAS', amount: -8400 },
    { date: '2026-10-06', description: 'CARD PAYMENT TO PRET A MANGER', amount: -495 },
  ], { accountId: 'a', importId: 'i1' });
  const csv = toTransactions([
    { date: '2026-10-01', description: 'Tesco Stores', amount: -2550 },
    { date: '2026-10-04', description: 'British Gas', amount: -8400 },
    { date: '2026-10-05', description: 'Pret A Manger', amount: -495 },
    { date: '2026-10-07', description: 'Greggs', amount: -310 },
  ], { accountId: 'a', importId: 'i2' });
  const r = overlapReport(csv, pdf);
  assert.equal(r.matched, 3);
  assert.equal(r.partialOverlap, true);
  const { matches } = matchIncoming(csv, pdf, { sameAccountId: 'a' });
  assert.deepEqual([...matches.keys()], [0, 1, 2]);
  // Already saved both? The cleanup tool finds the 3 pairs and keeps Greggs.
  const pairs = findStoredDuplicates([...pdf, ...csv]);
  assert.equal(pairs.length, 3);
  assert.ok(pairs.every((p) => p.keep.importId === 'i1'));
});

test('two identical coffees on one statement are not duplicates', () => {
  const t = toTransactions([{ date: '2026-10-02', description: 'PRET', amount: -300 }, { date: '2026-10-02', description: 'PRET', amount: -300 }], { accountId: 'a', importId: 'i1' });
  assert.equal(findStoredDuplicates(t).length, 0);
});

test('card payment out of current and into card is not a duplicate', () => {
  const a = toTransactions([{ date: '2026-10-20', description: 'AMEX PAYMENT', amount: -42000 }], { accountId: 'cur', importId: 'i1' });
  const b = toTransactions([{ date: '2026-10-20', description: 'PAYMENT RECEIVED AMEX', amount: 42000 }], { accountId: 'card', importId: 'i2' });
  assert.equal(findStoredDuplicates([...a, ...b]).length, 0);
});

test('credit card detection and summary', () => {
  assert.equal(looksLikeCreditText('Credit limit £3,000 Minimum payment £25 Payment due date 14 Nov'), true);
  assert.equal(looksLikeCreditText('Paid in Paid out Balance'), false);
  const accounts = [{ id: 'cur', name: 'Main', bank: 'Monzo', type: 'current' }, { id: 'bc', name: 'Barclaycard', bank: 'Barclaycard', type: 'current' }];
  assert.deepEqual(suspectedCreditCards(accounts, []).map((a) => a.id), ['bc']);

  const card = { id: 'card', name: 'Amex', type: 'credit', balance: -50000, balanceDate: '2026-10-31' };
  const txs = toTransactions([
    { date: '2026-10-05', description: 'ASOS', amount: -10000 },
    { date: '2026-10-20', description: 'PAYMENT RECEIVED', amount: 20000 },
    { date: '2026-11-03', description: 'DELIVEROO', amount: -2500 },
  ], { accountId: 'card' });
  txs[1].category = 'transfer';
  assert.equal(owedNow(card, txs), 52500, 'adds purchases after the statement');
  const s = cardSummary({ accounts: [card], txs, today: '2026-11-07', trackFrom: '2026-10-01' });
  assert.equal(s.totalOwed, 52500);
  assert.equal(s.monthSpend, 2500);
  assert.equal(s.totalAtStart, 52500 + -10000 + 20000 - 2500 > 0 ? 52500 - 10000 + 20000 - 2500 : 0);
  assert.equal(s.cards[0].daysSinceSpend, 4);
});

test('payoff plan: avalanche clears high APR first, rejects too-small payments', () => {
  const cards = [
    { account: { id: 'a', name: 'High' }, owed: 100000, apr: 0.3 },
    { account: { id: 'b', name: 'Zero' }, owed: 50000, apr: 0 },
  ];
  const p = payoffPlan(cards, 30000, { startMonth: '2026-11' });
  assert.equal(p.feasible, true);
  assert.equal(p.payoff[0].name, 'High');
  assert.ok(p.months >= 5 && p.months <= 7, `months ${p.months}`);
  const snow = payoffPlan(cards, 30000, { method: 'snowball' });
  assert.equal(snow.payoff[0].name, 'Zero');
  assert.equal(payoffPlan([{ account: { id: 'x', name: 'X' }, owed: 1000000, apr: 0.3 }], 10000).feasible, false);
});

test('card payoff comes out of fun money, not savings', () => {
  const txs = toTransactions([
    { date: '2026-09-25', description: 'ACME SALARY', amount: 300000 },
    { date: '2026-09-05', description: 'DISHOOM', amount: -40000 },
    { date: '2026-10-25', description: 'ACME SALARY', amount: 300000 },
    { date: '2026-10-05', description: 'DISHOOM', amount: -40000 },
  ], { accountId: 'a' });
  const without = buildBudget(txs, {}, { today: '2026-11-07' });
  const withPay = buildBudget(txs, { cardPayoff: 230000 }, { today: '2026-11-07' });
  assert.equal(withPay.savingsTarget, without.savingsTarget);
  assert.ok(withPay.personalAllowance < without.personalAllowance);
  assert.equal(withPay.cardPayoff, 230000);
});

test('merging the same account imported twice keeps each payment once', async () => {
  const { mergePlan } = await import('../src/lib/duplicates.js');
  const a = toTransactions([{ date: '2026-10-02', description: 'TESCO', amount: -2550 }, { date: '2026-10-03', description: 'PRET', amount: -300 }], { accountId: 'rev-card', importId: 'i1' });
  const b = toTransactions([{ date: '2026-10-02', description: 'Tesco Stores', amount: -2550 }, { date: '2026-10-09', description: 'Salary', amount: 200000 }], { accountId: 'rev-current', importId: 'i2' });
  const p = mergePlan(a, b);
  assert.equal(p.drop.length, 1);
  assert.equal(p.move.length, 1);
  assert.equal(p.move[0].description, 'PRET');
});
