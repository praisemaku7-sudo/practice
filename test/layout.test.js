import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linesToPageTexts, chunkPages, detectAccountRef, reconcile } from '../src/lib/parse/layout.js';

const line = (page, y, cells) => ({ page, y, items: cells.map(([x, str]) => ({ x, w: str.length * 5, str })) });

test('page text keeps columns and splits pages', () => {
  const pages = linesToPageTexts([
    line(1, 700, [[40, 'Date'], [100, 'Description'], [400, 'Balance']]),
    line(1, 680, [[40, '02 Oct'], [100, 'TESCO'], [400, '974.50']]),
    line(2, 700, [[40, '03 Oct'], [100, 'PRET'], [400, '970.00']]),
  ]);
  assert.equal(pages.length, 2);
  const [h, r] = pages[0].split('\n');
  assert.equal(h.indexOf('Balance'), r.indexOf('974.50'), 'balance column lines up');
  assert.ok(h.startsWith('Date'), 'left margin stripped');
});

test('chunking groups pages and caps chunk count', () => {
  const pages = Array.from({ length: 12 }, (_, i) => 'x'.repeat(3000) + i);
  const chunks = chunkPages(pages, { maxChars: 7000, maxChunks: 4 });
  assert.ok(chunks.length <= 5 && chunks.length >= 3, `got ${chunks.length}`);
  assert.equal(chunks[0].from, 1);
  assert.equal(chunks[chunks.length - 1].to, 12);
  assert.deepEqual(chunkPages(['short']).map((c) => [c.from, c.to]), [[1, 1]]);
});

test('account reference detection', () => {
  assert.equal(detectAccountRef('Sort code 20-00-00 Account number 12345678'), '5678');
  assert.equal(detectAccountRef('20-45-77 43219876 Mr J Smith'), '9876');
  assert.equal(detectAccountRef('Card number ending in 4021'), '4021');
  assert.equal(detectAccountRef('nothing here'), null);
});

test('reconcile trusts statements whose balances add up', () => {
  const good = reconcile({ openingBalance: 10000, closingBalance: 7000, transactions: [
    { amount: -1000, balance: 9000 }, { amount: -500, balance: 8500 }, { amount: -500, balance: null }, { amount: -1000, balance: 7000 },
  ] });
  assert.equal(good.confident, true);
  assert.equal(good.totalsMatch, true);
  const bad = reconcile({ openingBalance: 10000, closingBalance: 7000, transactions: [{ amount: -1000, balance: 9000 }, { amount: -900, balance: 8500 }] });
  assert.equal(bad.confident, false);
  assert.equal(reconcile({ transactions: [{ amount: -100, balance: null }] }).confident, false, 'no balances = not verified');
});
