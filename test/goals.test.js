import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goalPlan, goalsMonthly } from '../src/lib/goals.js';
import { buildBudget } from '../src/lib/budget.js';

test('goal plan: monthly amount to reach the target by the date', () => {
  const p = goalPlan({ target: 150000, saved: 30000, by: '2027-06' }, '2026-11-08');
  assert.equal(p.monthsLeft, 7);
  assert.equal(p.monthly, 17200); // £1,200 left over 7 months, rounded up to the pound
  assert.equal(Math.round(p.progress * 100), 20);
  const linked = goalPlan({ target: 100000, accountId: 's', by: '2027-01' }, '2026-11-08', { s: { balance: 100000 } });
  assert.equal(linked.done, true);
  assert.equal(linked.monthly, 0);
});

test('goals raise the savings target and come out of fun money', () => {
  const goals = [{ target: 300000, saved: 0, by: '2027-05', owner: 'p1' }, { target: 60000, saved: 0, by: '2027-05', owner: 'p2' }];
  assert.equal(goalsMonthly(goals, 'p1', '2026-11-08'), 50000);
  assert.equal(goalsMonthly(goals, 'all', '2026-11-08'), 60000);
  const b = buildBudget([], { income: 200000, goalsMonthly: 60000 }, { today: '2026-11-08' });
  assert.equal(b.savingsTarget, 60000, 'goals need more than 20% of income');
  assert.equal(b.goalsMonthly, 60000);
});
