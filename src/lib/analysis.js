import { CAT, catKind, isSpendCategory } from './categories.js';
import { merchantKey } from './categorize.js';
import { isSummaryLine } from './parse/junk.js';
import { monthKey, addMonths, daysBetween, addDays, todayISO, nextDayOfMonth } from './dates.js';

const OWN_TRANSFER = /\b(TOP[- ]?UP|TOPUP|TOPPED UP|TRANSFER|TFR|INTERNAL|OWN ACCOUNT|TO POT|FROM POT|POT TRANSFER|ROUND[- ]?UPS?|SPARE CHANGE|SAVINGS POT|VAULT|SAVER|MOVED (TO|FROM)|SENT FROM|DEPOSIT FROM|WITHDRAWAL TO|INSTANT ACCESS|EASY ACCESS)\b/;
const BANKS = ['MONZO', 'STARLING', 'REVOLUT', 'CHASE', 'NATIONWIDE', 'HSBC', 'FIRST DIRECT', 'BARCLAYS', 'LLOYDS', 'HALIFAX', 'NATWEST', 'SANTANDER', 'TSB', 'KROO', 'CHIP', 'PLUM', 'MONEYBOX', 'MARCUS', 'ZOPA', 'WISE', 'VIRGIN MONEY', 'METRO BANK', 'CO-OPERATIVE', 'TIDE', 'AMEX', 'AMERICAN EXPRESS', 'BARCLAYCARD', 'CAPITAL ONE'];

/** Does this description look like money moving to/from one of your own accounts? */
export function looksLikeOwnTransfer(t, { ownBanks = [], ownNames = [] } = {}) {
  const d = ' ' + String(t.description || '').toUpperCase().replace(/[^A-Z0-9&' -]/g, ' ') + ' ';
  if (/\b(SALARY|WAGES|PAYROLL|HMRC|DWP|PENSION)\b/.test(d)) return false;
  if (ownNames.some((n) => n && d.includes(' ' + n + ' '))) return true;
  const mentionsOwnBank = ownBanks.some((b) => d.includes(' ' + b + ' ') || d.includes(' ' + b.replace(/ /g, '') + ' '));
  if (mentionsOwnBank && (OWN_TRANSFER.test(d) || /\b(PAYMENT|FROM|TO|FPS|FASTER|BANK|BGC|FPI|FPO|SO|STO)\b/.test(d))) return true;
  return OWN_TRANSFER.test(d) && !/\b(SALARY|WAGES|PAYROLL|HMRC|DWP|REFUND)\b/.test(d);
}

export function ownBanksOf(accounts) {
  const names = new Set();
  for (const a of Object.values(accounts)) {
    const s = `${a.bank || ''} ${a.name || ''}`.toUpperCase();
    for (const b of BANKS) if (s.includes(b)) names.add(b);
  }
  return [...names];
}

/**
 * Stop money moving between your own accounts counting as spending and income.
 *  1. Pair an exact opposite amount on another of your accounts within 7 days (closest date wins).
 *  2. Unpaired rows that clearly describe an own-account move (your name, "top up", a bank you hold)
 *     become transfers too.
 *  3. Everything on a savings account is a transfer, except interest.
 * Mutates and returns the array.
 */
export function markTransfers(txs, accountsById = {}, { ownNames = [] } = {}) {
  const byAbs = new Map();
  for (const t of txs) {
    if (t.userCategory || t.pairId) continue;
    const k = Math.abs(t.amount);
    if (!byAbs.has(k)) byAbs.set(k, []);
    byAbs.get(k).push(t);
  }
  for (const group of byAbs.values()) {
    if (group.length < 2) continue;
    const outs = group.filter((t) => t.amount < 0).sort((a, b) => a.date.localeCompare(b.date));
    const ins = group.filter((t) => t.amount > 0);
    for (const o of outs) {
      let best = null, bestGap = 8;
      for (const i of ins) {
        if (i.pairId || i.accountId === o.accountId) continue;
        const gap = Math.abs(daysBetween(o.date, i.date));
        if (gap < bestGap) { best = i; bestGap = gap; }
      }
      if (best) {
        o.pairId = best.id; best.pairId = o.id;
        // Into savings counts toward your savings rate; out of savings counts against it.
        const intoSavings = accountsById[best.accountId]?.type === 'savings';
        const outOfSavings = accountsById[o.accountId]?.type === 'savings';
        o.category = intoSavings && !outOfSavings ? 'savings' : 'transfer';
        best.category = outOfSavings && !intoSavings ? 'savings' : 'transfer';
      }
    }
  }
  const ownBanks = ownBanksOf(accountsById);
  // Card companies you have a card account with: paying them from a current account is moving
  // money to your own debt, not new spending (the purchases are already counted on the card).
  const CARD_ALIASES = { 'american express': ['AMERICAN EXPRESS', 'AMEX'], aqua: ['AQUA', 'NEWDAY'], 'capital one': ['CAPITAL ONE'], barclaycard: ['BARCLAYCARD'],
    vanquis: ['VANQUIS'], mbna: ['MBNA'], 'tesco bank': ['TESCO BANK', 'TESCO CREDIT CARD'], marbles: ['MARBLES', 'NEWDAY'], fluid: ['FLUID', 'NEWDAY'], zopa: ['ZOPA'] };
  const cardWords = Object.values(accountsById).filter((a) => a.type === 'credit')
    .flatMap((a) => CARD_ALIASES[String(a.bank || '').toLowerCase()] || (a.bank ? [String(a.bank).toUpperCase()] : []));
  const names = ownNames.map((n) => n.toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim()).filter((n) => n.length >= 3);
  for (const t of txs) {
    if (t.userCategory || t.pairId) continue;
    const acc = accountsById[t.accountId];
    // Money paid onto a credit card is a repayment, never income (refunds keep their shop category).
    if (acc?.type === 'credit' && t.amount > 0 && t.category === 'income') { t.category = 'transfer'; t.autoTransfer = true; continue; }
    if (acc?.type === 'savings') {
      if (!/\b(INTEREST|BONUS)\b/i.test(t.description)) { t.category = 'transfer'; t.autoTransfer = true; }
      continue;
    }
    if (t.amount < 0 && acc?.type !== 'credit' && cardWords.length && ['debt', 'other', 'transfer', 'shopping'].includes(t.category)) {
      const d = ` ${String(t.description || '').toUpperCase()} `;
      if (cardWords.some((w) => d.includes(` ${w} `) || d.includes(` ${w}`))) { t.category = 'transfer'; t.autoTransfer = true; continue; }
    }
    if (['income', 'other', 'transfer'].includes(t.category) && looksLikeOwnTransfer(t, { ownBanks, ownNames: names })) {
      t.category = 'transfer'; t.autoTransfer = true;
    }
  }
  return txs;
}

export function monthsPresent(txs) {
  return [...new Set(txs.map((t) => monthKey(t.date)))].sort();
}

// Month summaries are asked for many times per screen; cache them until the data changes.
let summaryCache = new WeakMap();
export function clearAnalysisCache() { summaryCache = new WeakMap(); }

/** Summary for one month. All values pence; spending values positive. */
export function summarizeMonth(txs, key) {
  let byKey = summaryCache.get(txs);
  if (!byKey) { byKey = new Map(); summaryCache.set(txs, byKey); }
  const tag = `${key}|${txs.length}`;
  if (byKey.has(tag)) return byKey.get(tag);
  const result = summarizeMonthUncached(txs, key);
  byKey.set(tag, result);
  return result;
}

function summarizeMonthUncached(txs, key) {
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
const SPLIT_CATS = new Set(['housing', 'bills', 'insurance', 'debt', 'childcare', 'education']);

export function detectRecurring(txs, { today = todayISO() } = {}) {
  const groups = new Map();
  for (const t of txs) {
    if (t.category === 'transfer' || t.category === 'excluded' || isSummaryLine(t.description)) continue;
    const dir = t.amount < 0 ? 'out' : 'in';
    // Month names in references ("RENT NOV", "OCTOBER RENT") would split one payee into many.
    const payee = String(t.merchant || merchantKey(t.description)).toUpperCase().replace(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\b/g, ' ').replace(/\b\d+\b/g, ' ').replace(/\s+/g, ' ').trim() || String(t.merchant || t.description).toUpperCase();
    const key = `${dir}|${payee}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const out = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    const months = new Set(list.map((t) => monthKey(t.date)));
    if (months.size < 2) continue;
    // Roughly one payment per month, at a fairly stable interval.
    const gaps = [];
    for (let i = 1; i < list.length; i++) gaps.push(daysBetween(list[i - 1].date, list[i].date));
    let g = median(gaps);
    const amounts = list.map((t) => Math.abs(t.amount));
    let med = median(amounts);
    const stable = amounts.filter((a) => Math.abs(a - med) <= Math.max(med * 0.2, 200)).length / amounts.length;
    let split = false;
    if (list.length > months.size * 1.5 + 1 || g < 25 || g > 36 || stable < 0.6) {
      // Rent, council tax or a loan paid in parts (e.g. each of you pays half, or two transfers):
      // treat the month's total as one regular payment if the totals and dates are steady.
      if (!SPLIT_CATS.has(list[list.length - 1].category)) continue;
      const byMonth = {};
      for (const t of list) (byMonth[monthKey(t.date)] ||= []).push(t);
      const totals = Object.values(byMonth).map((ts) => ts.reduce((a, t) => a + Math.abs(t.amount), 0));
      const mt = median(totals);
      const steady = totals.filter((x) => Math.abs(x - mt) <= Math.max(mt * 0.15, 500)).length / totals.length;
      const days = list.map((t) => +t.date.slice(8));
      const spread = Math.max(...days) - Math.min(...days);
      if (steady < 0.6 || (spread > 8 && spread < 23)) continue;
      med = mt; g = 30.4; split = true;
    }
    const last = list[list.length - 1];
    const prev = list[list.length - 2];
    const desc = list.map((t) => t.description.toUpperCase()).join(' ');
    const type = key.startsWith('in') ? 'income'
      : last.category === 'fees' || /\bINTEREST\b/.test(desc) ? 'Interest / fee'
      : /\b(DD|DIRECT DEBIT|D\/D)\b/.test(desc) ? 'Direct Debit'
      : /\b(SO|STO|STANDING ORDER|S\/O)\b/.test(desc) ? 'Standing Order'
      : 'Card / Subscription';
    const typeLabel = split ? `${type === 'Card / Subscription' ? 'Payments' : type} (in parts)` : type;
    // Monthly payments fall on the same day each month; others repeat at their own interval.
    let nextDue = addDays(last.date, Math.round(g));
    while (nextDue < today) nextDue = addDays(nextDue, Math.round(g));
    if (split || (g >= 26 && g <= 35)) nextDue = nextDayOfMonth(addDays(last.date, 1) > today ? addDays(last.date, 1) : today, +last.date.slice(8));
    let lastAmt = Math.abs(last.amount), prevAmt = Math.abs(prev.amount);
    if (split) {
      const sumIn = (mk) => list.filter((t) => monthKey(t.date) === mk).reduce((a, t) => a + Math.abs(t.amount), 0);
      const mks = [...months].sort();
      lastAmt = sumIn(mks.at(-1)); prevAmt = sumIn(mks.at(-2));
      if (lastAmt < med * 0.6) lastAmt = med; // latest month only partly imported
    }
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
      type: typeLabel,
      split,
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
