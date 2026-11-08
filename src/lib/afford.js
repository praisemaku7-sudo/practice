import { catKind, catName } from './categories.js';
import { budgetProgress } from './budget.js';
import { monthKey, todayISO, daysInMonth, nextDayOfMonth, prettyDate, addMonths } from './dates.js';
import { fmt } from './money.js';

/**
 * "Can I afford this?"
 * Runs four checks, each of which you asked for:
 *  1. fun     – fits in this month's remaining personal allowance (fun money)
 *  2. category – fits in what's left of its own category budget
 *  3. savings – after buying it, this month still hits the savings target
 *  4. bills   – your current-account balance still covers every bill due before payday
 * Returns { verdict: 'yes'|'tight'|'no', headline, checks[], advice[] }.
 */
export function canIAfford({ price, category = 'shopping', txs, budget, recurring = [], balance = null, payday = null, today = todayISO(), bufferPence = 5000, cardsOwed = 0, goals = [] }) {
  const key = monthKey(today);
  const prog = budgetProgress(txs, budget, key);
  const kind = catKind(category);
  const row = prog.rows.find((r) => r.category === category);
  const catBudget = row ? row.budget : 0;
  const catLeft = row ? row.left : 0;

  // Money still to go out this month: unpaid bills + essentials not yet spent.
  const paidThisMonth = new Set(txs.filter((t) => monthKey(t.date) === key && t.amount < 0).map((t) => t.merchant));
  const monthEnd = `${key}-${String(daysInMonth(key)).padStart(2, '0')}`;
  const dueThisMonth = recurring.filter((r) => r.direction === 'out' && r.active && r.nextDue <= monthEnd && r.nextDue >= today && !paidThisMonth.has(r.name));
  // Fixed bills still to come add to spend; upcoming subscriptions etc. come out of fun money instead.
  const unpaidBills = dueThisMonth.filter((r) => catKind(r.category) === 'fixed').reduce((a, r) => a + r.amount, 0);
  const upcomingPersonal = dueThisMonth.filter((r) => catKind(r.category) === 'personal').reduce((a, r) => a + r.amount, 0);
  const essentialsLeft = prog.rows.filter((r) => r.kind === 'essential').reduce((a, r) => a + Math.max(0, r.left), 0);
  const projectedSpend = prog.summary.spend + unpaidBills + essentialsLeft + Math.max(0, prog.personalLeft);
  const expectedIncome = Math.max(prog.summary.income, budget.income);
  const projectedSavings = expectedIncome - projectedSpend - prog.summary.saved;
  // Buying it uses fun money first, so it only dents savings if it exceeds what's left.
  const funLeft = prog.personalLeft - upcomingPersonal;
  const overFun = kind === 'personal' ? Math.max(0, price - Math.max(0, funLeft)) : price;
  const savingsAfter = projectedSavings + prog.summary.saved - overFun;

  const nextPay = payday ? nextDayOfMonth(today, payday) : `${addMonths(key, 1)}-01`;
  const billsBeforePay = recurring.filter((r) => r.direction === 'out' && r.active && r.nextDue >= today && r.nextDue < nextPay);
  const billsBeforePayTotal = billsBeforePay.reduce((a, r) => a + r.amount, 0);

  const checks = [];
  if (kind === 'personal') {
    checks.push({
      id: 'fun', label: 'Fun money left this month', pass: price <= funLeft,
      detail: (funLeft > 0 ? `${fmt(funLeft)} left of ${fmt(budget.personalAllowance)}` : `Already ${fmt(-funLeft)} over your ${fmt(budget.personalAllowance)} allowance`)
        + (upcomingPersonal ? ` (after ${fmt(upcomingPersonal)} of subscriptions still due)` : ''),
    });
  }
  checks.push({
    id: 'category', label: `${catName(category)} budget`, pass: catBudget > 0 && price <= catLeft,
    detail: catBudget > 0 ? `${fmt(Math.max(0, catLeft))} left of ${fmt(catBudget)}` : 'No budget set for this category',
  });
  const goal = budget.savingsTarget + (budget.cardPayoff || 0);
  checks.push({
    id: 'savings', label: budget.goalsMonthly ? `Savings & goals protected${budget.cardPayoff ? ' (and card payoff)' : ''}` : budget.cardPayoff ? 'Savings & card payoff protected' : 'Savings goal protected', pass: savingsAfter >= goal,
    detail: `You'd have about ${fmt(Math.max(0, savingsAfter), { whole: true })} left for it this month (goal ${fmt(budget.savingsTarget, { whole: true })} savings${budget.cardPayoff ? ` + ${fmt(budget.cardPayoff, { whole: true })} to cards` : ''})`,
  });
  if (balance != null) {
    const after = balance - billsBeforePayTotal - price;
    checks.push({
      id: 'bills', label: `Bills before payday (${prettyDate(nextPay)})`, pass: after >= bufferPence,
      detail: `${fmt(billsBeforePayTotal)} due across ${billsBeforePay.length} payment${billsBeforePay.length === 1 ? '' : 's'}; you'd have ${fmt(after)} left`,
    });
  } else {
    checks.push({ id: 'bills', label: 'Bills before payday', pass: null, detail: 'No current balance known — import a statement with a balance column' });
  }

  const get = (id) => checks.find((c) => c.id === id);
  const hardFail = get('savings').pass === false || get('bills').pass === false;
  const funOk = kind !== 'personal' || get('fun').pass;
  let verdict, headline;
  if (!hardFail && funOk && get('category').pass) {
    verdict = 'yes'; headline = 'Yes, you can afford this.';
  } else if (!hardFail && funOk) {
    verdict = 'tight'; headline = `Yes, but take it from another category. It's over your ${catName(category)} budget.`;
  } else {
    verdict = 'no'; headline = get('bills').pass === false ? "No. You'd be short for bills before payday." : get('savings').pass === false ? 'No. It would break your savings goal this month.' : "No. You've used this month's fun money.";
  }

  const advice = [];
  if (verdict !== 'yes') {
    const weekly = Math.max(500, Math.round(budget.personalAllowance / 4.345 / 4)); // a quarter of weekly fun money
    const weeks = Math.ceil(price / weekly);
    if (budget.personalAllowance > 0) {
      if (price <= budget.personalAllowance * 0.5) advice.push(`Wait until next month: it fits in a fresh ${fmt(budget.personalAllowance, { whole: true })} allowance.`);
      advice.push(`Or put aside ${fmt(weekly, { whole: true })}/week for ${weeks} week${weeks === 1 ? '' : 's'}.`);
    }
    if (verdict === 'tight') {
      const donor = prog.rows.filter((r) => r.kind === 'personal' && r.category !== category && r.left >= price - Math.max(0, catLeft)).sort((a, b) => b.left - a.left)[0];
      if (donor) advice.push(`${catName(donor.category)} has ${fmt(donor.left)} spare this month. Move it there.`);
    }
  }
  if (cardsOwed > 0) {
    advice.unshift('Pay with your debit card, not a credit card.');
    if (budget.cardPayoff > 0) {
      const days = Math.round((price / budget.cardPayoff) * 30);
      if (days >= 3) advice.push(`You still owe ${fmt(cardsOwed, { whole: true })} on cards. Putting this money toward them instead would make you debt-free about ${days} days sooner.`);
    }
  }
  // How much later would your goals be reached if this money went to them instead?
  const nextGoal = goals.filter((g) => g.monthly > 0).sort((a, b) => (a.by || '9999').localeCompare(b.by || '9999'))[0];
  if (nextGoal && price >= 2000) {
    const weeks = Math.round((price / nextGoal.monthly) * 4.345);
    if (weeks >= 1) advice.push(`Putting this towards "${nextGoal.name}" instead would get you there about ${weeks} week${weeks === 1 ? '' : 's'} sooner.`);
  }
  if (price >= 10000 && verdict === 'yes') advice.push('Big purchase: check it’s still wanted after a 48-hour wait.');
  return { verdict, headline, checks, advice, funLeft, projectedSavings: savingsAfter };
}
