import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statementCoverage, overlapReport, fileHash } from '../src/lib/coverage.js';
import { monthlyRecords, categoryTrends, historySummary, recordsToCSV } from '../src/lib/history.js';
import { toTransactions } from '../src/lib/importer.js';

const accounts = [{ id: 'a', name: 'Monzo' }, { id: 'b', name: 'Barclays' }];

test('finds gaps and the missing latest statement', () => {
  const imports = [
    { accountId: 'a', periodStart: '2026-07-01', periodEnd: '2026-07-31' },
    { accountId: 'a', periodStart: '2026-09-01', periodEnd: '2026-09-30' },
    { accountId: 'b', periodStart: '2026-08-15', periodEnd: '2026-10-14' },
  ];
  const r = statementCoverage({ accounts, imports, txs: [], today: '2026-11-20' });
  const miss = r.missing.map((m) => `${m.accountId}:${m.month}:${m.reason}`);
  assert.deepEqual(miss, ['a:2026-08:gap', 'a:2026-10:latest']);
});

test('grace period: early in the month last month is not yet expected', () => {
  const imports = [{ accountId: 'a', periodStart: '2026-09-01', periodEnd: '2026-09-30' }];
  const r = statementCoverage({ accounts: [accounts[0]], imports, txs: [], today: '2026-11-03' });
  assert.deepEqual(r.missing, []);
});

test('dismissed months are not reported', () => {
  const imports = [{ accountId: 'a', periodStart: '2026-07-01', periodEnd: '2026-07-31' }, { accountId: 'a', periodStart: '2026-09-01', periodEnd: '2026-10-31' }];
  const r = statementCoverage({ accounts: [accounts[0]], imports, txs: [], today: '2026-11-20', dismissed: { 'a|2026-08': true } });
  assert.deepEqual(r.missing, []);
});

test('duplicate statement detected even under another account', () => {
  const rows = [
    { date: '2026-10-02', description: 'TESCO STORES', amount: -2550 },
    { date: '2026-10-03', description: 'SALARY', amount: 200000 },
    { date: '2026-10-04', description: 'PRET', amount: -300 },
    { date: '2026-10-04', description: 'PRET', amount: -300 },
  ];
  const stored = toTransactions(rows, { accountId: 'a' });
  const again = toTransactions(rows, { accountId: 'b' });
  const r = overlapReport(again, stored);
  assert.equal(r.matched, 4);
  assert.equal(r.likelyDuplicate, true);
  assert.equal(r.matchedAccountId, 'a');
  const partial = overlapReport(toTransactions([...rows.slice(0, 1), { date: '2026-11-01', description: 'X', amount: -100 }, { date: '2026-11-02', description: 'Y', amount: -100 }], { accountId: 'a' }), stored);
  assert.equal(partial.partialOverlap, true);
  // Only one stored PRET pair: three incoming PRETs match at most two.
  const extra = overlapReport(toTransactions([...rows, { date: '2026-10-04', description: 'PRET', amount: -300 }], { accountId: 'a' }), stored);
  assert.equal(extra.matched, 4);
});

test('file hash is stable', async () => {
  const enc = new TextEncoder().encode('statement');
  assert.equal(await fileHash(enc.buffer), await fileHash(new TextEncoder().encode('statement').buffer));
  assert.notEqual(await fileHash(enc.buffer), await fileHash(new TextEncoder().encode('statement2').buffer));
});

test('monthly record, trends and CSV', () => {
  const rows = [];
  for (const [m, food, inc] of [['2026-08', 20000, 250000], ['2026-09', 25000, 250000], ['2026-10', 30000, 250000], ['2026-11', 5000, 0]]) {
    rows.push({ date: `${m}-05`, description: 'TESCO STORES', amount: -food });
    if (inc) rows.push({ date: `${m}-25`, description: 'ACME SALARY', amount: inc });
  }
  const txs = toTransactions(rows, { accountId: 'a' });
  const recs = monthlyRecords(txs, ['2026-08', '2026-09', '2026-10', '2026-11'], { currentMonth: '2026-11', incompleteMonths: new Set(['2026-09']) });
  assert.equal(recs[0].savingsRate, 0.92);
  const t = categoryTrends(recs).find((x) => x.category === 'groceries');
  assert.equal(t.avg, 25000);
  assert.ok(t.trend > 0, 'rising');
  const s = historySummary(recs);
  assert.equal(s.months, 2, 'excludes in-progress and incomplete months');
  const csv = recordsToCSV(recs);
  assert.match(csv.split('\n')[0], /Month,Income,Spent/);
  assert.match(csv, /missing statements/);
  assert.match(csv, /in progress/);
});
