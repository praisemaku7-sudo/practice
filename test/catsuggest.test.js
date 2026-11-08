import { test } from 'node:test';
import assert from 'node:assert/strict';
import { otherMerchants, suggestCategory } from '../src/lib/catsuggest.js';

const tx = (id, merchant, description, date, amount, category = 'other') => ({ id, merchant, description, date, amount, category });

test('card-reader prefix: SUMUP *ANYTOWN BUTCHER is groceries', () => {
  const g = otherMerchants([tx('1', 'SUMUP ANYTOWN BUTCHER', 'SUMUP *ANYTOWN BUTCHER', '2026-10-02', -2400)])[0];
  assert.equal(suggestCategory(g, []).category, 'groceries');
});
test('learned from your own choices for the same merchant name', () => {
  const g = otherMerchants([tx('1', 'HIGHLAND PARK DISTILLERY', 'HIGHLAND PARK DISTILLERY', '2026-10-02', -3000)])[0];
  const s = suggestCategory(g, [], { userRules: { 'HIGHLAND PARK SHOP': 'gifts' } });
  assert.equal(s.category, 'gifts');
});
test('same large amount every month suggests rent', () => {
  const txs = [tx('1', 'ACME HOMES', 'ACME HOMES', '2026-08-01', -115000), tx('2', 'ACME HOMES', 'ACME HOMES', '2026-09-01', -115000), tx('3', 'ACME HOMES', 'ACME HOMES', '2026-10-01', -115000)];
  assert.equal(suggestCategory(otherMerchants(txs)[0], txs).category, 'housing');
});
test('Claude\'s online lookup wins when saved', () => {
  const g = otherMerchants([tx('1', 'KGV LTD', 'KGV LTD', '2026-10-02', -900)])[0];
  assert.equal(suggestCategory(g, [], { saved: { 'KGV LTD': { category: 'eating_out', business: 'Café in Anytown', confidence: 'high' } } }).category, 'eating_out');
});
test('rent from "ACME HOMES" is not suggested as income because "ACME SALARY" comes in', () => {
  const txs = [tx('s1', 'ACME SALARY', 'ACME SALARY', '2026-09-25', 260000, 'income'),
    tx('1', 'ACME HOMES', 'ACME HOMES', '2026-08-01', -115000), tx('2', 'ACME HOMES', 'ACME HOMES', '2026-09-01', -115000), tx('3', 'ACME HOMES', 'ACME HOMES', '2026-10-01', -115000)];
  assert.equal(suggestCategory(otherMerchants(txs)[0], txs).category, 'housing');
});
