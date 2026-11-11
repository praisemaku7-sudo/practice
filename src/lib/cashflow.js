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
/**
 * When a regular payment falls in a month, at the amount of each payment. Monthly ones once on their
 * day; weekly and fortnightly every 7 or 14 days from the last one; quarterly and yearly only in
 * their months. Each returned r is the payment with that occurrence's amount.
 */
export function occurrences(r, month) {
  const f = r.freq || 'monthly';
  if (f === 'monthly' || !r.lastDate) return [{ date: dayIn(month, r.day), r }];
  const each = { ...r, amount: r.perPayment ?? r.amount };
  if (f === 'quarterly' || f === 'yearly') {
    const step = f === 'quarterly' ? 3 : 12;
    const diff = (+month.slice(0, 4) - +r.lastDate.slice(0, 4)) * 12 + (+month.slice(5) - +r.lastDate.slice(5, 7));
    return ((diff % step) + step) % step === 0 ? [{ date: dayIn(month, r.day), r: each }] : [];
  }
  const step = f === 'weekly' ? 7 : 14;
  const first = `${month}-01`, last = `${month}-${String(new Date(Date.UTC(+month.slice(0, 4), +month.slice(5), 0)).getUTCDate()).padStart(2, '0')}`;
  const out = [];
  let k = Math.ceil((new Date(first) - new Date(r.lastDate)) / (step * 864e5));
  for (;; k++) {
    const dt = new Date(new Date(`${r.lastDate}T12:00:00Z`).getTime() + k * step * 864e5).toISOString().slice(0, 10);
    if (dt > last) break;
    if (dt >= first) out.push({ date: dt, r: each });
  }
  return out;
}

export function monthItems({ month, recurring, today, paidKeys = new Set() }) {
  const byDay = new Map();
  const thisMonth = monthKey(today);
  for (const r0 of recurring) {
    if (!r0.active && month >= thisMonth) continue;
    for (const { date, r } of occurrences(r0, month)) {
    let status;
    if (month < thisMonth) status = paidKeys.has(r.key) ? 'paid' : 'missed';
    else if (month > thisMonth) status = 'upcoming';
    else status = paidKeys.has(r.key) ? 'paid' : date < today ? 'late' : 'due';
    if (month < thisMonth && status === 'missed' && r.direction === 'in') continue;
    const d = +date.slice(8);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push({ r, date, status, dir: r.direction });
    }
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
    const items = recurring.filter((r) => r.active && !(m === monthKey(today) && paidKeys.has(r.key))).flatMap((r) => occurrences(r, m).filter((o) => o.date === date).map((o) => o.r));
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
