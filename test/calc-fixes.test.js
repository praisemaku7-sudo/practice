import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markTransfers, detectRecurring } from '../src/lib/analysis.js';
import { baselineMonths } from '../src/lib/budget.js';
import { history } from '../src/lib/forecast.js';

const tx = (date, amount, description, category, accountId) => ({ id: `${date}${description}${accountId}${amount}`, date, amount, description, merchant: description, category, accountId });
const accounts = { cur: { id: 'cur', type: 'current', name: 'Main Current' }, amex: { id: 'amex', type: 'credit', name: 'American Express Platinum', bank: null } };

test('"OBP AMERICAN EXP" is a card repayment when the Amex card is imported, and stays on the calendar', () => {
  const txs = ['2026-08', '2026-09', '2026-10'].map((m) => tx(`${m}-26`, -45000, 'OBP AMERICAN EXP', 'bills', 'cur'));
  txs.push(tx('2026-10-21', -1200, 'AMEX LATE FEE', 'fees', 'cur'));
  markTransfers(txs, accounts);
  assert.ok(txs.slice(0, 3).every((t) => t.category === 'transfer' && t.cardRepay));
  assert.equal(txs[3].category, 'fees', 'fees are not repayments');
  const rec = detectRecurring(txs, { today: '2026-11-09' });
  const r = rec.find((x) => x.cardRepay);
  assert.ok(r && r.type === 'Card repayment' && r.day === 26);
});

test('averages skip months missing a statement', () => {
  const txs = ['2026-07', '2026-08', '2026-09', '2026-10'].map((m) => tx(`${m}-05`, -1000, 'X', 'groceries', 'cur'));
  assert.deepEqual(baselineMonths(txs, { today: '2026-11-09', incomplete: new Set(['2026-10']) }), ['2026-07', '2026-08', '2026-09']);
  const h = history({ txs, today: '2026-11-09', incomplete: new Set(['2026-10']), skipIncomplete: true });
  assert.ok(!h.some((m) => m.month === '2026-10'));
  assert.ok(history({ txs, today: '2026-11-09', incomplete: new Set(['2026-10']) }).find((m) => m.month === '2026-10').incomplete);
});
