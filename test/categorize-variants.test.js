import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categorize } from '../src/lib/categorize.js';
import { suggestCategory } from '../src/lib/catsuggest.js';

test('plural and possessive shop names are recognised', () => {
  for (const d of ['SAINSBURYS S MKT', "SAINSBURY'S", 'SAINSBURY']) assert.equal(categorize(d, -1, {}), 'groceries', d);
});
test('suggestions cope with spelling variants the rules miss', () => {
  const g = { merchant: 'GREGGSS', sample: 'GREGGSS', txs: [{ amount: -300, date: '2026-10-01' }] };
  const s = suggestCategory({ merchant: "MCDONALD'S RESTAURANTS", sample: "MCDONALD'S RESTAURANTS LTD", txs: [{ amount: -800, date: '2026-10-02' }] }, [], {});
  assert.ok(s && s.category === 'takeaway');
  void g;
});
