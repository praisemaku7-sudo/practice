import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInsights } from '../src/lib/insights.js';

const tx = (date, amount, category) => ({ id: date + amount + category, date, amount, description: category.toUpperCase(), merchant: category.toUpperCase(), category, accountId: 'a' });
const txs = [];
for (const m of ['2026-08', '2026-09', '2026-10']) txs.push(tx(`${m}-05`, -18000, 'groceries'), tx(`${m}-20`, -18000, 'groceries'));
txs.push(tx('2026-11-05', -13200, 'groceries'));

test('a few days into the month is not "down" on a whole month', () => {
  const ids = buildInsights({ txs, key: '2026-11', budget: null, recurring: [], today: '2026-11-09' }).map((i) => i.id);
  assert.ok(!ids.includes('down-groceries'));
});
test('a complete month that really was lower is "down"', () => {
  const t2 = txs.filter((t) => !t.date.startsWith('2026-11')).concat(tx('2026-11-05', -13200, 'groceries'));
  const ins = buildInsights({ txs: t2, key: '2026-11', budget: null, recurring: [], today: '2026-12-02' });
  assert.ok(ins.find((i) => i.id === 'down-groceries'));
});
test('heading up at today\'s pace is flagged mid-month', () => {
  const t3 = txs.concat(tx('2026-11-08', -30000, 'groceries'));
  const ins = buildInsights({ txs: t3, key: '2026-11', budget: null, recurring: [], today: '2026-11-12' });
  const up = ins.find((i) => i.id === 'up-groceries');
  assert.ok(up && up.live && /heading for/.test(up.detail));
});
