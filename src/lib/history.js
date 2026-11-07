// Month-by-month record built from all imported transactions.
import { summarizeMonth } from './analysis.js';
import { isSpendCategory, catName } from './categories.js';
import { monthLabel } from './dates.js';

export function monthlyRecords(txs, months, { incompleteMonths = new Set(), currentMonth = null } = {}) {
  return months.map((m) => {
    const s = summarizeMonth(txs, m);
    const kept = s.income - s.spend;
    return {
      month: m,
      income: s.income,
      spend: s.spend,
      saved: s.saved,
      net: s.net,
      savingsRate: s.income > 0 ? kept / s.income : null,
      byCat: s.byCat,
      kinds: s.kinds,
      incomplete: incompleteMonths.has(m),
      inProgress: m === currentMonth,
    };
  });
}

/** Per-category series across months, sorted by total spend. */
export function categoryTrends(records) {
  const usable = records.filter((r) => !r.inProgress);
  const cats = new Set(usable.flatMap((r) => Object.keys(r.byCat)).filter(isSpendCategory));
  return [...cats].map((c) => {
    const series = records.map((r) => Math.max(0, r.byCat[c] || 0));
    const done = usable.map((r) => Math.max(0, r.byCat[c] || 0));
    const avg = done.length ? Math.round(done.reduce((a, b) => a + b, 0) / done.length) : 0;
    const last = done[done.length - 1] ?? 0;
    // Simple trend: second half average vs first half average.
    const half = Math.floor(done.length / 2);
    const firstHalf = half ? done.slice(0, half).reduce((a, b) => a + b, 0) / half : 0;
    const secondHalf = half ? done.slice(-half).reduce((a, b) => a + b, 0) / half : 0;
    return { category: c, series, avg, last, total: done.reduce((a, b) => a + b, 0), trend: half ? Math.round(secondHalf - firstHalf) : 0 };
  }).filter((x) => x.total > 0).sort((a, b) => b.total - a.total);
}

export function historySummary(records) {
  const done = records.filter((r) => !r.inProgress && !r.incomplete && r.income + r.spend > 0);
  if (!done.length) return null;
  const avg = (f) => Math.round(done.reduce((a, r) => a + f(r), 0) / done.length);
  const rated = done.filter((r) => r.savingsRate != null);
  const best = [...done].sort((a, b) => (b.income - b.spend) - (a.income - a.spend))[0];
  const worst = [...done].sort((a, b) => b.spend - a.spend)[0];
  return {
    months: done.length,
    avgIncome: avg((r) => r.income),
    avgSpend: avg((r) => r.spend),
    avgSaved: avg((r) => r.saved),
    avgRate: rated.length ? rated.reduce((a, r) => a + r.savingsRate, 0) / rated.length : null,
    totalSaved: done.reduce((a, r) => a + r.saved, 0),
    best, worst,
  };
}

/** CSV of the monthly record for spreadsheets. */
export function recordsToCSV(records) {
  const cats = [...new Set(records.flatMap((r) => Object.keys(r.byCat)).filter(isSpendCategory))].sort();
  const p = (v) => (v / 100).toFixed(2);
  const head = ['Month', 'Income', 'Spent', 'Moved to savings', 'Left over', 'Savings rate %', 'Complete', ...cats.map(catName)];
  const rows = records.map((r) => [monthLabel(r.month), p(r.income), p(r.spend), p(r.saved), p(r.net),
    r.savingsRate == null ? '' : Math.round(r.savingsRate * 100), r.inProgress ? 'in progress' : r.incomplete ? 'missing statements' : 'yes',
    ...cats.map((c) => p(Math.max(0, r.byCat[c] || 0)))]);
  return [head, ...rows].map((row) => row.map((v) => (/[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',')).join('\n');
}
