// Bills calendar maths: when each regular payment and pay lands, and what your current-account
// balance does day by day (so you can see a bounce coming before it happens).
import { monthKey, addMonths, daysInMonth, daysBetween } from './dates.js';

const pad = (n) => String(n).padStart(2, '0');

/** Every date a monthly item falls on in `month` (YYYY-MM): its day, clamped to the month's length. */
export const dayIn = (month, day) => `${month}-${pad(Math.min(day, daysInMonth(month)))}`;

/**
 * Items on a month's calendar.
 * paidKeys: Set of recurring keys already paid this month (from statements).
 * @returns {Map<number, Array<{r, date, status: 'paid'|'due'|'upcoming'|'late', dir}>>}
 */
export function monthItems({ month, recurring, today, paidKeys = new Set() }) {
  const byDay = new Map();
  const thisMonth = monthKey(today);
  for (const r of recurring) {
    if (!r.active && month >= thisMonth) continue;
    const date = dayIn(month, r.day);
    let status;
    if (month < thisMonth) status = paidKeys.has(r.key) ? 'paid' : 'missed';
    else if (month > thisMonth) status = 'upcoming';
    else status = paidKeys.has(r.key) ? 'paid' : date < today ? 'late' : 'due';
    if (month < thisMonth && status === 'missed' && r.direction === 'in') continue;
    const d = +date.slice(8);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push({ r, date, status, dir: r.direction });
  }
  return byDay;
}

/**
 * Day-by-day balance from today to `until` (inclusive): starting balance, minus bills, plus pay.
 * Only items still to come are applied. Returns the rows and the lowest point.
 */
export function balanceForecast({ start, today, until, recurring, paidKeys = new Set() }) {
  const rows = [];
  let bal = start;
  let low = { date: today, balance: start };
  const n = Math.max(0, daysBetween(today, until));
  for (let i = 0; i <= n; i++) {
    const dt = new Date(`${today}T12:00:00Z`); dt.setUTCDate(dt.getUTCDate() + i);
    const date = dt.toISOString().slice(0, 10);
    const m = date.slice(0, 7);
    const items = recurring.filter((r) => r.active && dayIn(m, r.day) === date && !(m === monthKey(today) && paidKeys.has(r.key)));
    const inflow = items.filter((r) => r.direction === 'in').reduce((a, r) => a + r.amount, 0);
    const outflow = items.filter((r) => r.direction === 'out').reduce((a, r) => a + r.amount, 0);
    bal += inflow - outflow;
    rows.push({ date, items, inflow, outflow, balance: bal });
    if (bal < low.balance) low = { date, balance: bal };
  }
  return { rows, low, end: bal };
}

/** Which recurring payments have already gone out (or come in) this month, from statements. */
export function paidThisMonth(recurring, txs, month, marked = {}) {
  const seen = new Set(Object.keys(marked[month] || {}));
  const mtx = txs.filter((t) => t.date.startsWith(month));
  for (const r of recurring) {
    const name = r.name.toUpperCase();
    const hit = mtx.some((t) => (r.direction === 'out' ? t.amount < 0 : t.amount > 0)
      && (String(t.merchant || '').toUpperCase() === name || String(t.description).toUpperCase().includes(name)));
    if (hit) seen.add(r.key);
  }
  return seen;
}

/** Weekly totals for a month (Mon–Sun weeks), biggest first is easy to find. */
export function weekTotals(byDay, month) {
  const [y, m] = month.split('-').map(Number);
  const weeks = [];
  for (let d = 1; d <= daysInMonth(month); d++) {
    const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
    if (d === 1 || dow === 0) weeks.push({ from: d, to: d, out: 0, count: 0 });
    const w = weeks.at(-1); w.to = d;
    for (const it of byDay.get(d) || []) if (it.dir === 'out') { w.out += it.r.amount; w.count++; }
  }
  return weeks;
}

export { addMonths };
