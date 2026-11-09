import { CATEGORIES, catKind } from './categories.js';
import { summarizeMonth, monthsPresent } from './analysis.js';
import { monthKey, addMonths, todayISO } from './dates.js';

const roundUp = (p, step = 500) => Math.ceil(p / step) * step; // nearest £5 up
const roundDown = (p, step = 500) => Math.floor(p / step) * step;

/** Last N complete months before the current month that have data. */
export function baselineMonths(txs, { today = todayISO(), n = 3, incomplete = null } = {}) {
  const current = monthKey(today);
  const done = monthsPresent(txs).filter((m) => m < current);
  // Skip months missing a statement (their totals are too low), unless that leaves nothing.
  const complete = incomplete?.size ? done.filter((m) => !incomplete.has(m)) : done;
  return (complete.length ? complete : done).slice(-n);
}

/**
 * Build a monthly budget from history.
 *  - Income: settings.income or average of baseline months.
 *  - Savings: settings.savingsTarget, else 20% of income (50/30/20 rule).
 *  - Fixed (bills, rent, credit): what you actually pay — can't be cut month to month.
 *  - Essentials (groceries, transport, health): your average, rounded up to £5.
 *  - Personal ("fun money"): whatever is left, split across your personal categories in
 *    proportion to how you've actually spent, but capped so the savings target holds.
 * settings.budgets[cat] overrides any category.
 */
export function buildBudget(txs, settings = {}, { today = todayISO(), incomplete = null } = {}) {
  const months = baselineMonths(txs, { today, incomplete });
  const sums = months.map((m) => summarizeMonth(txs, m));
  const n = Math.max(sums.length, 1);
  const avgIncome = Math.round(sums.reduce((a, s) => a + s.income, 0) / n);
  const income = settings.income ?? avgIncome;
  // Savings goals must be funded: the target is at least what your goals need each month.
  const goalsMonthly = settings.goalsMonthly || 0;
  const savingsTarget = Math.max(settings.savingsTarget ?? roundDown(Math.round(income * 0.2)), goalsMonthly);
  // Extra paid to credit cards each month (repayments are transfers, so they come out of what's left).
  const cardPayoff = settings.cardPayoff ?? 0;

  const hist = {};
  for (const s of sums) for (const [c, v] of Object.entries(s.byCat)) hist[c] = (hist[c] || 0) + v / n;

  const overrides = settings.budgets || {};
  const lines = [];
  let committed = 0;
  for (const c of CATEGORIES) {
    const kind = c.kind;
    if (!['fixed', 'essential'].includes(kind)) continue;
    const h = Math.max(0, Math.round(hist[c.id] || 0));
    const budget = overrides[c.id] ?? (kind === 'fixed' ? roundUp(h, 100) : roundUp(h));
    if (budget > 0 || h > 0) lines.push({ category: c.id, kind, hist: h, budget, overridden: overrides[c.id] != null });
    committed += budget;
  }

  const personalCats = CATEGORIES.filter((c) => c.kind === 'personal');
  const personalPool = income - committed - savingsTarget - cardPayoff;
  const overriddenPersonal = personalCats.filter((c) => overrides[c.id] != null);
  const fixedPersonal = overriddenPersonal.reduce((a, c) => a + overrides[c.id], 0);
  const flexible = personalCats.filter((c) => overrides[c.id] == null && (hist[c.id] || 0) > 0);
  const flexHist = flexible.reduce((a, c) => a + hist[c.id], 0);
  const flexPool = Math.max(0, personalPool - fixedPersonal);
  // Never budget more than you historically spend + 10% headroom; the rest is a bonus to savings.
  const scale = flexHist > 0 ? Math.min(1.1, flexPool / flexHist) : 0;
  for (const c of personalCats) {
    const h = Math.round(hist[c.id] || 0);
    let budget;
    if (overrides[c.id] != null) budget = overrides[c.id];
    else budget = roundDown(Math.round(h * scale));
    if (budget > 0 || h > 0) lines.push({ category: c.id, kind: 'personal', hist: h, budget, overridden: overrides[c.id] != null });
  }
  const personalAllowance = lines.filter((l) => l.kind === 'personal').reduce((a, l) => a + l.budget, 0);
  const totalBudget = lines.reduce((a, l) => a + l.budget, 0);
  const avgSpend = Math.round(sums.reduce((a, s) => a + s.spend, 0) / n);
  return {
    months,
    income,
    incomeIsEstimate: settings.income == null,
    savingsTarget,
    cardPayoff,
    goalsMonthly,
    committed,
    personalAllowance,
    unallocated: income - totalBudget - savingsTarget - cardPayoff,
    shortfall: Math.max(0, committed + savingsTarget + cardPayoff - income),
    avgSpend,
    lines,
    byCategory: Object.fromEntries(lines.map((l) => [l.category, l])),
  };
}

/** Progress against budget for a given month. */
export function budgetProgress(txs, budget, key) {
  const s = summarizeMonth(txs, key);
  const rows = budget.lines.map((l) => {
    const spent = Math.max(0, s.byCat[l.category] || 0);
    return { ...l, spent, left: l.budget - spent, pct: l.budget ? spent / l.budget : spent > 0 ? 2 : 0 };
  });
  // Categories with spend but no budget line.
  for (const [c, v] of Object.entries(s.byCat)) {
    if (!budget.byCategory[c] && v > 0 && !['income', 'transfer', 'savings'].includes(catKind(c))) {
      rows.push({ category: c, kind: catKind(c), hist: 0, budget: 0, spent: v, left: -v, pct: 2 });
    }
  }
  const personalSpent = rows.filter((r) => r.kind === 'personal').reduce((a, r) => a + r.spent, 0);
  return {
    summary: s,
    rows,
    personalSpent,
    personalLeft: budget.personalAllowance - personalSpent,
  };
}

export { addMonths };
