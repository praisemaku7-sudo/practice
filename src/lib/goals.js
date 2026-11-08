// Savings goals ("Holiday £1,500 by June"): how much to put aside each month to get there.
import { monthKey } from './dates.js';

const monthsBetween = (fromKey, toKey) => {
  const [a, b] = [fromKey, toKey].map((k) => { const [y, m] = k.split('-').map(Number); return y * 12 + m; });
  return b - a;
};

/** Saved so far: a linked savings account's balance, or the amount you've entered. */
export function goalSaved(goal, accountsById = {}) {
  const acc = goal.accountId && accountsById[goal.accountId];
  if (acc && acc.balance != null) return Math.max(0, acc.balance);
  return goal.saved || 0;
}

/**
 * @returns {{ saved, remaining, monthsLeft, monthly, progress, done, overdue }}
 */
export function goalPlan(goal, today, accountsById = {}) {
  const saved = goalSaved(goal, accountsById);
  const remaining = Math.max(0, goal.target - saved);
  const monthsLeft = goal.by ? Math.max(0, monthsBetween(monthKey(today), goal.by)) : null;
  const monthly = remaining === 0 ? 0 : monthsLeft ? Math.ceil(remaining / monthsLeft / 100) * 100 : monthsLeft === 0 ? remaining : 0;
  return {
    saved, remaining, monthsLeft, monthly,
    progress: goal.target ? Math.min(1, saved / goal.target) : 0,
    done: remaining === 0,
    overdue: monthsLeft === 0 && remaining > 0,
  };
}

export const goalInScope = (goal, scope) => scope === 'all' || !goal.owner || goal.owner === 'all' || goal.owner === scope;

/** Total to set aside each month for every goal in view. */
export function goalsMonthly(goals, scope, today, accountsById) {
  return goals.filter((g) => goalInScope(g, scope)).reduce((a, g) => a + goalPlan(g, today, accountsById).monthly, 0);
}
