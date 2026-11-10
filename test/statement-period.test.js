import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statedPeriod } from '../src/lib/parse/statementText.js';

test('a labelled statement period wins over due dates and fee dates', () => {
  const t = 'Payment Due Date 5 October 2026\nStatement Period From 11 August to 10 September 2026\nNext fee date 13 December 2026';
  assert.deepEqual([statedPeriod(t).start, statedPeriod(t).end], ['2026-08-11', '2026-09-10']);
});

test('a statement in monthly sections spans all of them', () => {
  const t = 'Account transactions from 1 June 2026 to 30 June 2026\nAccount transactions from 30 June 2026 to 9 November 2026';
  const p = statedPeriod(t);
  assert.deepEqual([p.start, p.end], ['2026-06-01', '2026-11-09']);
});

test('a period across the new year', () => {
  const p = statedPeriod('9 December to 8 January 2027');
  assert.deepEqual([p.start, p.end], ['2026-12-09', '2027-01-08']);
});
