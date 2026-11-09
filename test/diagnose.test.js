import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseSpending } from '../src/lib/diagnose.js';

const tx = (date, amount, description, category, accountId) => ({ id: `${date}${description}${amount}${accountId}`, date, amount, description, merchant: description, category, accountId });
const months = ['2026-08', '2026-09', '2026-10'];
const accounts = [{ id: 'cur', name: 'Main Current', type: 'current' }, { id: 'aqua', name: 'Aqua', type: 'credit' }, { id: 'p2', name: 'Joint', type: 'current' }];
const txs = [];
for (const m of months) {
  txs.push(tx(`${m}-25`, 330000, 'SALARY', 'income', 'cur'));
  txs.push(tx(`${m}-10`, -60000, 'AQUA CARD PAYMENT', 'debt', 'cur'));          // paying the imported card
  txs.push(tx(`${m}-03`, -60000, 'ZARA', 'shopping', 'aqua'));                 // the purchases on it
  txs.push(tx(`${m}-12`, -100000, 'SAMPLE PARTNER', 'other', 'cur'));          // to the other person
  txs.push(tx(`${m}-14`, -50000, 'FASTER PAYMENT 123', 'entertainment', 'cur'));
  txs.push(tx(`${m}-15`, 50000, 'FASTER PAYMENT 123', 'other', 'p2'));        // same money arriving elsewhere
}

test('finds card repayments counted twice, payments between you, moves and huge categories', () => {
  const r = diagnoseSpending({ txs, accounts, months, people: [{ name: 'Sample Person' }, { name: 'Partner Name' }].map((p, i) => (i === 1 ? { name: 'Partner' } : p)), income: 330000 });
  const ids = r.map((x) => x.id);
  assert.ok(ids.includes('card-double'), 'card double count');
  assert.equal(r.find((x) => x.id === 'card-double').monthly, 60000);
  assert.ok(ids.includes('between'), 'between partners');
  assert.ok(ids.includes('pairs'), 'same amount moved');
  assert.ok(ids.some((i) => i.startsWith('big-')), 'huge category');
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].monthly >= r[i].monthly);
});
