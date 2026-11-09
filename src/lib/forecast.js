// "Will we have enough?": this month at the current pace, and the months ahead at your average.
import { summarizeMonth, monthsPresent } from './analysis.js';
import { budgetProgress } from './budget.js';
import { catKind } from './categories.js';
import { monthKey, addMonths, daysInMonth } from './dates.js';
import { schedule } from './mortgage.js';

/**
 * This month: spent so far, where spending will land at today's pace (variable spending runs at
 * its daily rate; fixed bills still to come are added from your regular payments), and what's left.
 */
export function monthOutlook({ txs, today, budget, recurring = [] }) {
  const key = monthKey(today);
  const s = summarizeMonth(txs, key);
  const day = +today.slice(8, 10), days = daysInMonth(key);
  const fixedSoFar = Object.entries(s.byCat).filter(([c]) => catKind(c) === 'fixed').reduce((a, [, v]) => a + v, 0);
  const variableSoFar = s.spend - fixedSoFar;
  // Early in the month the daily rate is noisy: lean on the budget until a week has passed.
  const budgetVariable = budget.lines.filter((l) => catKind(l.category) !== 'fixed').reduce((a, l) => a + l.budget, 0);
  const rate = day >= 7 ? variableSoFar / day : Math.max(variableSoFar / Math.max(day, 1), budgetVariable / days);
  const variableEnd = Math.round(Math.max(variableSoFar, rate * days));
  const billsToCome = recurring.filter((r) => r.direction === 'out' && r.active && r.nextDue > today && monthKey(r.nextDue) === key && catKind(r.category) === 'fixed').reduce((a, r) => a + r.amount, 0);
  const spendEnd = Math.round(fixedSoFar + billsToCome + variableEnd);
  const income = Math.max(s.income, budget.income || 0);
  const left = income - spendEnd - (budget.goalsMonthly || 0);
  return { key, day, days, spent: s.spend, income, incomeSoFar: s.income, variableSoFar, variableEnd, billsToCome, fixedSoFar, spendEnd, left, status: left < 0 ? 'short' : left < income * 0.05 ? 'tight' : 'ok' };
}

/** Each budget line: spent so far, where it lands at this pace, and whether it's over or heading over. */
export function budgetAlerts({ txs, today, budget }) {
  const key = monthKey(today);
  const day = +today.slice(8, 10), days = daysInMonth(key);
  const prog = budgetProgress(txs, budget, key);
  return prog.rows.filter((r) => r.budget > 0 || r.spent > 0).map((r) => {
    const fixed = catKind(r.category) === 'fixed';
    const projected = fixed ? r.spent : Math.round(day >= 5 ? (r.spent / day) * days : Math.max(r.spent, r.budget));
    const status = r.spent > r.budget ? 'over' : !fixed && projected > r.budget * 1.05 && r.spent > 0 ? 'heading' : 'ok';
    return { ...r, projected, status, perDayLeft: r.budget > r.spent ? Math.floor((r.budget - r.spent) / Math.max(1, days - day + 1)) : 0 };
  }).sort((a, b) => ({ over: 0, heading: 1, ok: 2 }[a.status] - { over: 0, heading: 1, ok: 2 }[b.status]) || b.spent / Math.max(b.budget, 1) - a.spent / Math.max(a.budget, 1));
}

/** Last N complete months of income and spending (for the trend). */
export function history({ txs, today, n = 6, incomplete = null, skipIncomplete = false }) {
  const cur = monthKey(today);
  let ms = monthsPresent(txs).filter((m) => m < cur);
  if (skipIncomplete && incomplete?.size && ms.some((m) => !incomplete.has(m))) ms = ms.filter((m) => !incomplete.has(m));
  return ms.slice(-n).map((m) => { const s = summarizeMonth(txs, m); return { month: m, income: s.income, spend: s.spend, left: s.income - s.spend, incomplete: !!incomplete?.has(m) }; });
}

/**
 * The next months at your recent average: income − spending, with rent swapped for the mortgage
 * from its start month if you've entered one in Future planning.
 */
export function outlook({ txs, today, budget, months = 6, mortgage = null, housingNow = 0, incomeFor = null, cut = 0, recurring = [], incomplete = null }) {
  // A typical month: the median of up to 6 complete months, so one big month (a holiday, a deposit
  // paid out) doesn't drag every future month with it. Fewer than 3 months: plain average.
  const past = history({ txs, today, n: 6, incomplete, skipIncomplete: true });
  const spends = past.map((m) => m.spend).sort((a, b) => a - b);
  const mid = spends.length ? (spends.length % 2 ? spends[(spends.length - 1) / 2] : Math.round((spends[spends.length / 2 - 1] + spends[spends.length / 2]) / 2)) : 0;
  const mean = spends.length ? Math.round(spends.reduce((a, v) => a + v, 0) / spends.length) : 0;
  const avgSpend = spends.length >= 3 ? mid : spends.length ? mean : budget.avgSpend || 0;
  const bills = recurring.filter((r) => r.active && r.direction === 'out' && r.category !== 'transfer').reduce((a, r) => a + r.amount, 0);
  const income = budget.income || 0;
  const sched = mortgage?.principal ? schedule({ ...mortgage }) : null;
  const pay = new Map((sched?.rows || []).map((r) => [r.month, r.payment]));
  const out = [];
  let running = 0;
  for (let k = 1; k <= months; k++) {
    const m = addMonths(monthKey(today), k);
    const started = mortgage?.startMonth && m >= mortgage.startMonth;
    const spend = avgSpend - cut + (started ? (pay.get(m) || 0) + (mortgage.extraCosts || 0) - housingNow : 0);
    // Income month by month when known (maternity pay ending, Child Benefit starting…).
    const inc = incomeFor ? incomeFor(m) : income;
    const left = inc - spend - (budget.goalsMonthly || 0);
    running += left;
    out.push({ month: m, income: inc, spend, bills: Math.min(bills, spend), left, running, mortgage: !!started });
  }
  return { avgSpend, meanSpend: mean, basis: spends.length >= 3 ? 'median' : 'mean', monthsUsed: past.length, income, months: out, shortMonths: out.filter((m) => m.left < 0).length };
}
