import { CAT, catKind, isSpendCategory } from './categories.js';
import { merchantKey } from './categorize.js';
import { monthKey, addMonths, daysBetween, addDays, todayISO } from './dates.js';

/**
 * Mark pairs of opposite transactions between two of your own accounts (within 4 days)
 * as transfers so moving money around never counts as spending or income.
 * Mutates and returns the array.
 */
export function markTransfers(txs, accountsById = {}) {
  const byAbs = new Map();
  for (const t of txs) {
    if (t.userCategory) continue;
    const k = Math.abs(t.amount);
    if (!byAbs.has(k)) byAbs.set(k, []);
    byAbs.get(k).push(t);
  }
  for (const group of byAbs.values()) {
    if (group.length < 2) continue;
    const outs = group.filter((t) => t.amount < 0 && !t.pairId);
    const ins = group.filter((t) => t.amount > 0 && !t.pairId);
    for (const o of outs) {
      const match = ins.find((i) => !i.pairId && i.accountId !== o.accountId && Math.abs(daysBetween(o.date, i.date)) <= 4);
      if (match) {
        o.pairId = match.id; match.pairId = o.id;
        // Paying off a credit card from a current account: the card purchases are the real spending.
        // Money moved into a savings account counts toward your savings rate.
        o.category = accountsById[match.accountId]?.type === 'savings' ? 'savings' : 'transfer';
        match.category = 'transfer';
      }
    }
  }
  return txs;
}

export function monthsPresent(txs) {
  return [...new Set(txs.map((t) => monthKey(t.date)))].sort();
}

/** Summary for one month. All values pence; spending values positive. */
export function summarizeMonth(txs, key) {
  const m = txs.filter((t) => monthKey(t.date) === key);
  const byCat = {};
  const byMerchant = {};
  let income = 0, spend = 0, saved = 0;
  for (const t of m) {
    const kind = catKind(t.category);
    if (kind === 'transfer') continue;
    if (kind === 'income') { income += t.amount; continue; }
    if (kind === 'savings') { saved += -t.amount; continue; }
    const v = -t.amount; // refunds reduce spend
    spend += v;
    byCat[t.category] = (byCat[t.category] || 0) + v;
    const mk = t.merchant || merchantKey(t.description);
    if (!byMerchant[mk]) byMerchant[mk] = { name: mk, total: 0, count: 0, category: t.category };
    byMerchant[mk].total += v;
    byMerchant[mk].count += 1;
  }
  const kinds = { fixed: 0, essential: 0, personal: 0 };
  for (const [c, v] of Object.entries(byCat)) kinds[catKind(c)] = (kinds[catKind(c)] || 0) + v;
  return {
    key, income, spend, saved, net: income - spend - saved, byCat, kinds,
    merchants: Object.values(byMerchant).sort((a, b) => b.total - a.total),
    count: m.length,
  };
}

/** Whether a month looks fully covered by imported data (so it's fair to compare). */
export function monthCoverage(txs, key) {
  const days = new Set(txs.filter((t) => monthKey(t.date) === key).map((t) => t.date.slice(8)));
  return days.size;
}

/** Changes vs previous month and vs trailing 3-month average, per category. */
export function compareMonths(txs, key) {
  const cur = summarizeMonth(txs, key);
  const prev = summarizeMonth(txs, addMonths(key, -1));
  const trailing = [1, 2, 3].map((i) => summarizeMonth(txs, addMonths(key, -i))).filter((s) => s.count > 0);
  const avg = {};
  for (const s of trailing) for (const [c, v] of Object.entries(s.byCat)) avg[c] = (avg[c] || 0) + v / trailing.length;
  const cats = new Set([...Object.keys(cur.byCat), ...Object.keys(prev.byCat), ...Object.keys(avg)]);
  const rows = [...cats].map((c) => ({
    category: c,
    current: cur.byCat[c] || 0,
    previous: prev.byCat[c] || 0,
    average: Math.round(avg[c] || 0),
    delta: (cur.byCat[c] || 0) - (prev.byCat[c] || 0),
    deltaAvg: (cur.byCat[c] || 0) - Math.round(avg[c] || 0),
  })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const prevMerchants = new Set(trailing.flatMap((s) => s.merchants.map((m) => m.name)));
  const newMerchants = cur.merchants.filter((m) => !prevMerchants.has(m.name) && m.total > 1500 && trailing.length > 0);
  return { cur, prev, hasPrev: prev.count > 0, trailingMonths: trailing.length, rows, newMerchants };
}

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/**
 * Detect recurring payments (direct debits, standing orders, subscriptions) and recurring income.
 * Returns [{ key, name, category, amount (pence, positive), direction, accountId, day, lastDate,
 *            nextDue, months, type, priceChange }]
 */
export function detectRecurring(txs, { today = todayISO() } = {}) {
  const groups = new Map();
  for (const t of txs) {
    if (t.category === 'transfer') continue;
    const dir = t.amount < 0 ? 'out' : 'in';
    const key = `${dir}|${t.merchant || merchantKey(t.description)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const out = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    const months = new Set(list.map((t) => monthKey(t.date)));
    if (months.size < 2) continue;
    // Roughly one payment per month, at a fairly stable interval.
    if (list.length > months.size * 1.5 + 1) continue;
    const gaps = [];
    for (let i = 1; i < list.length; i++) gaps.push(daysBetween(list[i - 1].date, list[i].date));
    const g = median(gaps);
    if (g < 25 || g > 36) continue;
    const amounts = list.map((t) => Math.abs(t.amount));
    const med = median(amounts);
    const stable = amounts.filter((a) => Math.abs(a - med) <= Math.max(med * 0.2, 200)).length / amounts.length;
    if (stable < 0.6) continue;
    const last = list[list.length - 1];
    const prev = list[list.length - 2];
    const desc = list.map((t) => t.description.toUpperCase()).join(' ');
    const type = key.startsWith('in') ? 'income'
      : /\b(DD|DIRECT DEBIT|D\/D)\b/.test(desc) ? 'Direct Debit'
      : /\b(SO|STO|STANDING ORDER|S\/O)\b/.test(desc) ? 'Standing Order'
      : 'Card / Subscription';
    let nextDue = addDays(last.date, Math.round(g));
    while (nextDue < today) nextDue = addDays(nextDue, Math.round(g));
    const lastAmt = Math.abs(last.amount), prevAmt = Math.abs(prev.amount);
    out.push({
      key,
      name: last.merchant || merchantKey(last.description),
      description: last.description,
      category: last.category,
      amount: lastAmt,
      direction: key.startsWith('in') ? 'in' : 'out',
      accountId: last.accountId,
      day: +last.date.slice(8),
      lastDate: last.date,
      nextDue,
      months: months.size,
      type,
      priceChange: prevAmt && Math.abs(lastAmt - prevAmt) > Math.max(prevAmt * 0.04, 50) ? lastAmt - prevAmt : 0,
      // Considered lapsed if it hasn't appeared for ~2 intervals.
      active: daysBetween(last.date, today) <= g * 2 + 5,
    });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

/** Estimate payday from recurring income (largest regular credit). */
export function detectPayday(recurring) {
  const inc = recurring.filter((r) => r.direction === 'in' && r.active).sort((a, b) => b.amount - a.amount)[0];
  return inc ? { day: inc.day, amount: inc.amount, name: inc.name } : null;
}

export function spendCategoriesOf(summary) {
  return Object.entries(summary.byCat)
    .filter(([c, v]) => isSpendCategory(c) && v > 0)
    .map(([c, v]) => ({ category: c, total: v, ...CAT[c] }))
    .sort((a, b) => b.total - a.total);
}
