import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPath, chosenSaving } from '../src/lib/path.js';
import { helpFor } from '../src/lib/directory.js';

const budget = { lines: [{ category: 'eating_out', hist: 40000 }, { category: 'fees', hist: 3000 }, { category: 'groceries', hist: 50000 }, { category: 'housing', hist: 150000 }] };
const recurring = [
  { key: 'netflix', name: 'NETFLIX', amount: 1299, active: true, direction: 'out', category: 'subscriptions' },
  { key: 'o2', name: 'O2', amount: 4000, active: true, direction: 'out', category: 'bills' },
  { key: 'mb', name: 'MB STARLING', amount: 100000, active: true, direction: 'out', category: 'transfer' },
];

test('path lists cancellations, cuts and fees, biggest first', () => {
  const p = buildPath({ budget, recurring, settings: {}, income: 300000, avgSpend: 450000 });
  assert.equal(p.gap, -150000);
  const ids = p.actions.map((a) => a.id);
  assert.ok(ids.includes('sub:netflix') && ids.includes('phones') && ids.includes('fees') && ids.includes('trim:eating_out') && ids.includes('trim:groceries'));
  assert.ok(!ids.some((i) => i.includes('mb')), 'transfers are not savings');
  for (let i = 1; i < p.actions.length; i++) assert.ok(p.actions[i - 1].saving >= p.actions[i].saving);
  const eat = p.actions.find((a) => a.id === 'trim:eating_out');
  assert.equal(eat.target, 20000);
  assert.equal(chosenSaving(p, { 'trim:eating_out': true, 'sub:netflix': true }), 20000 + 1299);
});

test('child benefit and cheaper mortgage appear when relevant', () => {
  const p = buildPath({ budget, recurring: [], settings: { tempIncome: { a: { label: 'Maternity pay' } } }, income: 0, avgSpend: 0, mortgagePayment: 120000 });
  assert.ok(p.actions.find((a) => a.id === 'cb'));
  assert.equal(p.actions.find((a) => a.id === 'mortgage').saving, 30000);
});

test('directory finds official help pages', () => {
  assert.match(helpFor('NETFLIX.COM').url, /netflix\.com/);
  assert.equal(helpFor('TESCO STORES'), null);
});
