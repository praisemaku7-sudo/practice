import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state, recompute } from '../src/state.js';

const tx = (date, amount, description, category, accountId) => ({ id: `${date}${description}`, date, amount, description, merchant: description, category, accountId });

test('regular pay missing from a finished month marks it incomplete', () => {
  state.settings = { ...state.settings, people: [{ id: 'p1', name: 'A' }], scope: 'all', goals: [] };
  state.accounts = [{ id: 'cur', type: 'current', name: 'Main' }, { id: 'v', type: 'current', name: 'Other' }];
  state.allAccounts = state.accounts; state.imports = [];
  state.txs = [];
  for (const m of ['2026-07', '2026-08', '2026-09']) state.txs.push(tx(`${m}-25`, 336400, 'PAYMENT FROM FF', 'income', 'cur'));
  for (const m of ['2026-07', '2026-08', '2026-09', '2026-10']) state.txs.push(tx(`${m}-01`, 77700, 'DWP MA', 'income', 'v'), tx(`${m}-12`, -3000, 'TESCO', 'groceries', 'v'));
  state.allTxs = state.txs;
  const d = recompute();
  if (d.today >= '2026-11-08') {
    assert.ok(d.incomplete.has('2026-10'), 'October incomplete');
    assert.ok(d.payMissing.some((p) => p.name === 'PAYMENT FROM FF' && p.month === '2026-10'));
  }
});
