import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectRecurring } from '../src/lib/analysis.js';

const tx = (date, amount, description, category = 'housing', accountId = 'a1') => ({ id: date + description + accountId, date, amount, description, merchant: null, category, accountId });

test('rent paid in two halves from two accounts is one monthly bill', () => {
  const txs = [];
  for (const m of ['2026-08', '2026-09', '2026-10']) {
    txs.push(tx(`${m}-15`, -75000, 'SALTSPIN RENT', 'housing', 'p1'), tx(`${m}-15`, -75000, 'SALTSPIN RENT', 'housing', 'p2'));
  }
  const r = detectRecurring(txs, { today: '2026-11-08' });
  const rent = r.find((x) => x.category === 'housing');
  assert.ok(rent, 'rent detected');
  assert.equal(rent.amount, 150000);
  assert.equal(rent.day, 15);
  assert.equal(rent.nextDue, '2026-11-15');
  assert.equal(rent.active, true);
});

test('month names in the reference do not split a payee', () => {
  const txs = ['AUG', 'SEP', 'OCT'].map((mo, i) => tx(`2026-${String(8 + i).padStart(2, '0')}-15`, -120000, `SALTSPIN ${mo} RENT`));
  const r = detectRecurring(txs, { today: '2026-11-08' });
  assert.equal(r.filter((x) => x.category === 'housing').length, 1);
});

test('groceries several times a month are still not a bill', () => {
  const txs = [];
  for (const m of ['2026-08', '2026-09', '2026-10']) for (const d of ['03', '10', '17', '24']) txs.push(tx(`${m}-${d}`, -4000, 'TESCO STORES', 'groceries'));
  assert.equal(detectRecurring(txs, { today: '2026-11-08' }).length, 0);
});

test('the same payment saved twice is counted once and listed as a duplicate', () => {
  const txs = [];
  for (const m of ['2026-08', '2026-09', '2026-10']) {
    txs.push({ ...tx(`${m}-05`, -3400, 'SAMPLE CHARITY', 'gifts', 'a1'), importId: 'i1' });
    txs.push({ ...tx(`${m}-05`, -3400, 'SAMPLE CHARITY', 'gifts', 'a2'), importId: 'i2' });
  }
  const r = detectRecurring(txs, { today: '2026-11-08' });
  const c = r.find((x) => x.category === 'gifts');
  assert.ok(c, 'detected');
  assert.equal(c.amount, 3400);
  assert.equal(c.dupIds.length, 3);
  const keep = detectRecurring(txs, { today: '2026-11-08', notDup: { [c.key]: true } }).find((x) => x.category === 'gifts');
  assert.ok(!keep || keep.dupIds.length === 0, 'kept as separate payments when you say so');
});
