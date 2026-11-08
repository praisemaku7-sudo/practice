import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markTransfers, summarizeMonth } from '../src/lib/analysis.js';
import { toTransactions } from '../src/lib/importer.js';

const accounts = {
  nw: { id: 'nw', name: 'Nationwide Current', bank: 'Nationwide', type: 'current' },
  rev: { id: 'rev', name: 'Revolut Current', bank: 'Revolut', type: 'current' },
  sav: { id: 'sav', name: 'Chase Saver', bank: 'Chase', type: 'savings' },
};
const tx = (accountId, rows) => toTransactions(rows, { accountId, importId: accountId });

test('transfers between own accounts are not spending or income', () => {
  const txs = [
    ...tx('nw', [
      { date: '2026-09-25', description: 'ACME LTD SALARY', amount: 250000 },
      { date: '2026-09-01', description: 'TO REVOLUT 1234', amount: -50000 }, // arrives 6 days later
      { date: '2026-09-10', description: 'FASTER PAYMENT P MAKU', amount: -30000 }, // to an account not imported
      { date: '2026-09-12', description: 'PAYMENT FROM CHASE', amount: 20000 }, // from own Chase, other side not imported
      { date: '2026-09-15', description: 'TESCO STORES', amount: -4000 },
    ]),
    ...tx('rev', [
      { date: '2026-09-07', description: 'Top-Up by *5678', amount: 50000 },
      { date: '2026-09-08', description: 'Deliveroo', amount: -2500 },
    ]),
    ...tx('sav', [
      { date: '2026-09-03', description: 'Round up', amount: 120 },
      { date: '2026-09-30', description: 'Interest paid', amount: 310 },
      { date: '2026-09-20', description: 'Withdrawal', amount: -10000 },
    ]),
  ];
  const before = summarizeMonth(JSON.parse(JSON.stringify(txs)), '2026-09');
  markTransfers(txs, accounts, { ownNames: ['P Maku'] });
  const s = summarizeMonth(txs, '2026-09');
  assert.ok(before.spend > s.spend, 'spend reduced');
  assert.equal(s.spend, 4000 + 2500, 'only Tesco and Deliveroo are spending');
  assert.equal(s.income, 250000 + 310, 'salary + savings interest only');
});

test('things you categorised yourself are never overridden', () => {
  const txs = tx('nw', [{ date: '2026-09-01', description: 'TRANSFER TO JOHN', amount: -5000 }]);
  txs[0].category = 'gifts'; txs[0].userCategory = true;
  markTransfers(txs, accounts);
  assert.equal(txs[0].category, 'gifts');
});

test('a repayment onto a credit card is not income', () => {
  const txs = toTransactions([{ date: '2026-10-20', description: 'PAYMENT RECEIVED - THANK YOU', amount: 10000 }, { date: '2026-10-03', description: 'ASOS', amount: -6000 }], { accountId: 'card', importId: 'c' });
  markTransfers(txs, { card: { id: 'card', type: 'credit', bank: 'Barclaycard' } });
  const s = summarizeMonth(txs, '2026-10');
  assert.equal(s.income, 0);
  assert.equal(s.spend, 6000);
});

test('paying a tracked credit card from a current account is not spending', () => {
  const accs = { cur: { id: 'cur', type: 'current', bank: 'Nationwide' }, aqua: { id: 'aqua', type: 'credit', bank: 'Aqua' } };
  const txs = toTransactions([{ date: '2026-10-28', description: 'AQUA CARD PAYMENT', amount: -10000 }, { date: '2026-10-02', description: 'TESCO STORES', amount: -4500 }], { accountId: 'cur', importId: 'c' });
  markTransfers(txs, accs);
  assert.equal(summarizeMonth(txs, '2026-10').spend, 4500);
  // Without a tracked Aqua card, the payment stays a bill (the card's purchases aren't counted anywhere).
  const solo = toTransactions([{ date: '2026-10-28', description: 'AQUA CARD PAYMENT', amount: -10000 }], { accountId: 'cur', importId: 'c' });
  markTransfers(solo, { cur: accs.cur });
  assert.equal(summarizeMonth(solo, '2026-10').spend, 10000);
});
