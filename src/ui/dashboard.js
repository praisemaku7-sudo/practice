// Overview dashboard: metric tiles you can tap into, make bigger, hide or reorder, and charts you
// can tap for the raw numbers and transactions behind them (with CSV export and links onward).
import { state, accountName } from '../state.js';
import { esc, openSheet, closeSheet, shareFile, toast } from './dom.js';
import { fmt } from '../lib/money.js';
import { summarizeMonth } from '../lib/analysis.js';
import { budgetProgress } from '../lib/budget.js';
import { catName, catKind, CAT } from '../lib/categories.js';
import { monthKey, addMonths, monthLabel, prettyDate, daysBetween, daysInMonth, nextDayOfMonth } from '../lib/dates.js';
import { monthOutlook } from '../lib/forecast.js';
import { catChip } from './common.js';
import { incomeSources, spendByPerson, safeToSpend, largestPayments, incomeSheetExtra, weekdayHtml } from './overview-extras.js';

const NOT_SPEND = ['income', 'transfer', 'savings'];
const isSpend = (t) => !NOT_SPEND.includes(catKind(t.category));
const inMonth = (m) => state.txs.filter((t) => monthKey(t.date) === m);
const summaries = new Map();
const sum = (m) => { if (!summaries.has(m)) summaries.set(m, summarizeMonth(state.txs, m)); return summaries.get(m); };
export function resetDashboardCache() { summaries.clear(); }

/** The 6 months ending at the month on screen (only months with data). */
function window6() {
  const have = new Set(state.derived.months);
  return Array.from({ length: 6 }, (_, i) => addMonths(state.month, i - 5)).filter((m) => have.has(m));
}

/** Line through the months, scaled between the lowest and highest value (works with negatives). */
function spark(values, h) {
  const W = 300, lo = Math.min(...values), hi = Math.max(...values), pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.1 || 1, min = lo - pad, max = hi + pad, span = max - min;
  const pts = values.map((v, i) => [4 + (i / Math.max(1, values.length - 1)) * (W - 8), h - 4 - ((v - min) / span) * (h - 8)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const zero = min < 0 && max > 0 ? h - 4 - ((0 - min) / span) * (h - 8) : null;
  const [lx, ly] = pts.at(-1);
  return `<svg class="spark" viewBox="0 0 ${W} ${h}" preserveAspectRatio="none" aria-hidden="true">${zero != null ? `<line x1="0" x2="${W}" y1="${zero}" y2="${zero}" class="spark-zero"/>` : ''}<path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2.2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/><circle cx="${lx}" cy="${ly}" r="3.2" fill="var(--accent)"/></svg>`;
}

const subsCats = new Set(['subscriptions', 'entertainment', 'fitness', 'personal_care']);

// ---------- Metric definitions ----------
// value(m) → pence for a month (drives the tile, sparkline and chart); rows(m) → transactions behind it.
const METRICS = {
  spent: { label: 'Spent', icon: '💸', good: 'low', value: (m) => sum(m).spend, rows: (m) => inMonth(m).filter(isSpend), explain: 'Money out minus refunds, not counting transfers between your accounts or savings.', links: [['#/transactions', 'Transactions'], ['#/categories', 'Categories'], ['#/audit', "What's counted"]] },
  income: { label: 'Income', icon: '💷', good: 'high', value: (m) => sum(m).income, rows: (m) => inMonth(m).filter((t) => catKind(t.category) === 'income'), sub: (m) => { const src = incomeSources(m); if (!src.length) return state.derived.budget.income ? `expected ${fmt(state.derived.budget.income, { whole: true })}` : ''; const exp = src.reduce((a, x) => a + x.r.amount, 0); const got = src.reduce((a, x) => a + x.received, 0); const next = src.find((x) => x.status === 'due' || x.status === 'late'); return `${fmt(got, { whole: true })} of ${fmt(exp, { whole: true })} expected${next ? ` · next ${prettyDate(next.due)}` : ''}`; }, inProgress: true, explain: 'Money in categorised as income (pay, benefits). Transfers from your own accounts are not counted. "Expected" is what your Income page says (payslips, maternity pay, benefits): if the two are far apart, something is miscounted.', links: [['#/income', 'Income'], ['#/transactions?cat=income', 'Income transactions']] },
  net: { label: 'Left over', icon: '⚖️', good: 'high', signed: true, inProgress: true, sub: (m) => { const due = incomeSources(m).filter((x) => x.status === 'due' || x.status === 'late'); return due.length ? `before ${fmt(due.reduce((a, x) => a + x.r.amount, 0), { whole: true })} pay still to come` : ''; }, value: (m) => sum(m).net, rows: (m) => inMonth(m).filter((t) => catKind(t.category) !== 'transfer'), explain: 'Income − spending − money moved to savings.', links: [['#/track', 'On track'], ['#/history', 'Monthly record']] },
  rate: { label: 'Savings rate', icon: '🐷', good: 'high', pct: true, inProgress: true, value: (m) => { const s = sum(m); return s.income > 0 ? Math.round(((s.income - s.spend) / s.income) * 1000) / 10 : 0; }, rows: (m) => inMonth(m).filter((t) => t.category === 'savings'), sub: (m) => (sum(m).income ? '' : 'no income yet this month'), explain: 'Share of income not spent. 10–20% is a healthy target; below 0 means spending more than you earn.', links: [['#/goals', 'Savings goals'], ['#/track', 'On track']] },
  daily: { label: 'Per day', icon: '📆', good: 'low', value: (m) => { const days = m === monthKey(state.derived.today) ? +state.derived.today.slice(8) : daysInMonth(m); return Math.round(sum(m).spend / Math.max(1, days)); }, rows: (m) => inMonth(m).filter(isSpend), explain: 'Average spending per day so far this month (whole month for past months).', links: [['#/budget', 'Budget'], ['#/afford', 'Can I afford it?']] },
  fun: { label: 'Fun money left', icon: '🎈', good: 'high', current: true, value: (m) => budgetProgress(state.txs, state.derived.budget, m).personalLeft, rows: (m) => inMonth(m).filter((t) => catKind(t.category) === 'personal' && t.amount < 0), explain: 'Your allowance for non-essentials after bills, essentials and savings, minus what you have spent on them.', links: [['#/afford', 'Can I afford it?'], ['#/budget', 'Budget']], sub: () => { const { today } = state.derived; const left = budgetProgress(state.txs, state.derived.budget, monthKey(today)).personalLeft; const d = daysBetween(today, `${addMonths(monthKey(today), 1)}-01`); return left > 0 ? `${fmt(Math.floor(left / Math.max(d, 1)), { whole: true })}/day for ${d} days` : 'over for this month'; } },
  forecast: { label: 'Month end', icon: '🔮', good: 'high', signed: true, current: true, sub: () => { const mo = monthOutlook({ txs: state.txs, today: state.derived.today, budget: state.derived.budget, recurring: state.derived.recurring }); return `heading for ${fmt(mo.spendEnd, { whole: true })} spent · ${fmt(mo.billsToCome, { whole: true })} bills still to come`; }, value: (m) => (m === monthKey(state.derived.today) ? monthOutlook({ txs: state.txs, today: state.derived.today, budget: state.derived.budget, recurring: state.derived.recurring }).left : sum(m).net), rows: (m) => inMonth(m).filter(isSpend), explain: 'What you will have left at the end of this month at today\'s pace, after the bills still to come.', links: [['#/track', 'On track'], ['#/due', 'Due soon']] },
  bills: { label: 'Due before payday', icon: '📅', good: 'low', current: true, value: () => upcoming().reduce((a, r) => a + r.amount, 0), rows: () => [], list: () => upcoming(), sub: () => `${upcoming().length} payments`, explain: 'Regular payments still to come before your next payday.', links: [['#/bills', 'Bills calendar'], ['#/due', 'Due soon'], ['#/movebills', 'Move bills']] },
  subs: { label: 'Subscriptions', icon: '🔁', good: 'low', value: (m) => inMonth(m).filter((t) => subsCats.has(t.category) && t.amount < 0).reduce((a, t) => a - t.amount, 0), rows: (m) => inMonth(m).filter((t) => subsCats.has(t.category) && t.amount < 0), explain: 'Subscriptions, entertainment, gym and personal care this month.', links: [['#/bills', 'Bills & subscriptions'], ['#/insights', 'Ways to cut']] },
  cards: { label: 'Card balances', icon: '💳', good: 'low', current: true, value: () => state.derived.cards.totalOwed, rows: (m) => inMonth(m).filter((t) => state.accounts.find((a) => a.id === t.accountId)?.type === 'credit' && t.amount < 0), sub: () => `${fmt(state.derived.cards.monthSpend, { whole: true })} new this month`, explain: 'Total owed across your credit cards. The goal is £0 new card spending.', links: [['#/cards', 'Payoff plan']] },
  top: { label: 'Biggest category', icon: '🏷️', good: 'low', value: (m) => topCat(m)?.[1] || 0, rows: (m) => { const c = topCat(m)?.[0]; return inMonth(m).filter((t) => t.category === c); }, sub: (m) => (topCat(m) ? catName(topCat(m)[0]) : ''), explain: 'The category you spent most on this month.', links: [['#/categories', 'Categories']] },
  safe: { label: 'Safe to spend', icon: '🛟', good: 'high', current: true, value: () => safeToSpend()?.perDay ?? 0, rows: () => [], sub: () => { const x = safeToSpend(); return x ? `a day for ${x.days} days, after bills` : 'needs a current-account balance'; }, list: () => { const x = safeToSpend(); return x ? [{ name: 'Current-account balance', amount: x.start, sub: x.stale ? 'from your last statements' : 'latest statements' }, { name: 'Bills before payday', amount: -x.bills, sub: `until ${prettyDate(x.nextPay)}` }, { name: 'Buffer kept back', amount: -5000, sub: 'for anything unexpected' }, { name: 'Left to spend', amount: x.left, sub: `about ${fmt(x.perDay, { whole: true })} a day` }] : []; }, explain: 'Your current-account balance, minus the regular bills still to come before payday and a £50 buffer, spread over the days until you\'re paid. Card spending isn\'t included.', links: [['#/bills', 'Bills calendar'], ['#/afford', 'Can I afford it?']] },
  people: { label: 'Who spent', icon: '👥', good: 'low', noDiff: true, value: (m) => sum(m).spend, rows: (m) => inMonth(m).filter(isSpend), sub: (m) => spendByPerson(m).map((p) => `${p.name} ${fmt(p.amount, { whole: true })}`).join(' · '), list: () => spendByPerson(state.month).map((p) => ({ name: p.name, amount: p.amount, sub: 'spent this month' })), explain: 'Spending this month by whose account it came from (or the cardholder named on the statement). Joint is the joint account.', links: [['#/transactions', 'Transactions'], ['#/settings', 'People']] },
  large: { label: 'Largest payments', icon: '🔎', good: 'low', value: (m) => largestPayments(m, 1)[0] ? -largestPayments(m, 1)[0].amount : 0, rows: (m) => largestPayments(m, 15), sub: (m) => { const l = largestPayments(m, 1)[0]; return l ? (l.merchant || l.description).slice(0, 22) : ''; }, explain: 'The biggest single payments this month (not transfers or savings). Worth a glance for anything unexpected.', links: [['#/transactions', 'Transactions']] },
  balance: { label: 'In current accounts', icon: '🏦', good: 'high', current: true, value: () => state.accounts.filter((a) => a.type === 'current' && a.balance != null).reduce((x, a) => x + a.balance, 0), rows: () => [], sub: () => (state.derived.staleBalance ? 'from older statements' : 'latest statements'), list: () => state.accounts.filter((a) => a.type === 'current' && a.balance != null).map((a) => ({ name: a.name, amount: a.balance, sub: a.balanceDate ? `as of ${prettyDate(a.balanceDate)}` : '' })), explain: 'Latest balances from your imported current-account statements.', links: [['#/accounts', 'Accounts'], ['#/audit', 'Check my numbers']] },
};
const DEFAULT_TILES = ['forecast', 'safe', 'income', 'net', 'people', 'fun', 'bills', 'cards', 'rate', 'large', 'subs', 'top', 'daily', 'balance', 'spent'];
// Line icons (24×24, stroke) so tiles match the rest of the app.
const TILE_ICONS = {
  safe: '<path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/>',
  people: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.6"/><path d="M15.5 14.2A5 5 0 0 1 21 19"/>',
  large: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2M11 8v6M8 11h6"/>',
  spent: '<path d="M4 7h16v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M8 7V5a4 4 0 0 1 8 0v2"/>',
  income: '<path d="M12 3v14M6 11l6 6 6-6"/><path d="M4 21h16"/>',
  net: '<path d="M12 4v16M5 8h14M7 8l-3 6a3 3 0 0 0 6 0zM17 8l-3 6a3 3 0 0 0 6 0z"/>',
  rate: '<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
  daily: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  fun: '<path d="M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10z"/>',
  forecast: '<path d="M3 17l5-5 4 3 6-7"/><path d="M14 8h4v4"/><path d="M3 21h18" stroke-dasharray="2 3"/>',
  bills: '<path d="M7 3h10v18l-2.5-1.5L12 21l-2.5-1.5L7 21z"/><path d="M10 8h4M10 12h4"/>',
  subs: '<path d="M4 12a8 8 0 0 1 13.7-5.7L20 8"/><path d="M20 4v4h-4"/><path d="M20 12a8 8 0 0 1-13.7 5.7L4 16"/><path d="M4 20v-4h4"/>',
  cards: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h3"/>',
  top: '<path d="M4 4h8l8 8-8 8-8-8z"/><circle cx="8.5" cy="8.5" r="1.3"/>',
  balance: '<path d="M3 10 12 4l9 6M5 10v8M10 10v8M14 10v8M19 10v8M3 20h18"/>',
};
const tIcon = (id) => `<svg viewBox="0 0 24 24" aria-hidden="true">${TILE_ICONS[id] || ''}</svg>`;

function topCat(m) { return Object.entries(sum(m).byCat || {}).sort((a, b) => b[1] - a[1])[0]; }
function upcoming() {
  const { recurring, payday, today } = state.derived;
  const next = payday ? nextDayOfMonth(today, payday) : null;
  return recurring.filter((r) => r.direction === 'out' && r.active && r.category !== 'transfer' && (!next || r.nextDue < next)).sort((a, b) => a.nextDue.localeCompare(b.nextDue));
}

// ---------- Preferences (per phone) ----------
const PREF = 'pl-dash';
function prefs() {
  try { const p = JSON.parse(localStorage.getItem(PREF) || '{}'); return { tiles: p.tiles || DEFAULT_TILES, big: p.big || ['forecast'] }; } catch { return { tiles: DEFAULT_TILES, big: ['forecast'] }; }
}
function savePrefs(p) { try { localStorage.setItem(PREF, JSON.stringify(p)); } catch { /* not remembered */ } }

const show = (def, v) => (def.pct ? `${v}%` : fmt(v, { whole: true, sign: !!def.signed }));
function tone(def, v, prev) {
  if (def.signed || def.pct || def.id === 'fun') return v < 0 ? 'neg' : 'pos';
  if (prev == null) return '';
  return '';
}

// ---------- Tiles ----------
export function dashboard() {
  resetDashboardCache();
  const p = prefs();
  const isCurrent = state.month === monthKey(state.derived.today);
  const ms = window6();
  const tiles = p.tiles.map((id) => ({ id, ...METRICS[id] })).filter((d) => d.label && (!d.current || isCurrent));
  return `<div class="dash-head"><h3>Dashboard</h3><button class="chip" data-action="dash-edit">✎ Customise</button></div>
  <div class="dash-grid">${tiles.map((d) => {
    const v = d.value(state.month);
    const prevM = addMonths(state.month, -1);
    const inc = state.derived.incomplete || new Set();
    // Mid-month, income-based figures are compared with what's expected, not last month's total.
    const midMonth = d.inProgress && state.month === monthKey(state.derived.today);
    const pv = !d.current && !d.noDiff && !midMonth && state.derived.months.includes(prevM) && !inc.has(prevM) && !inc.has(state.month) ? d.value(prevM) : null;
    const diff = pv != null ? v - pv : null;
    const better = diff == null || diff === 0 ? null : (d.good === 'high') === diff > 0;
    const big = p.big.includes(d.id);
    const series = d.current ? [] : ms.map((m) => d.value(m));
    return `<div class="dash-tile ${big ? 'big' : ''}" data-action="dash-open" data-id="${d.id}" role="button" tabindex="0" aria-label="${esc(d.label)}: ${esc(show(d, v))}. Tap for details">
      <div class="dt-top"><span class="dt-ic" aria-hidden="true">${tIcon(d.id)}</span><span class="dt-label">${esc(d.label)}</span>
        <button class="dt-size" data-action="dash-size" data-id="${d.id}" aria-label="${big ? 'Make smaller' : 'Make bigger'}">${big ? '⤡' : '⤢'}</button></div>
      <div class="dt-val ${tone(d, v)}">${esc(show(d, v))}</div>
      <div class="dt-sub">${diff != null && diff !== 0 ? `<span class="${better ? 'pos' : 'neg'}">${diff > 0 ? '▲' : '▼'} ${d.pct ? `${Math.abs(Math.round(diff * 10) / 10)} pts` : fmt(Math.abs(diff), { whole: true })}</span> vs ${esc(monthLabel(prevM, { short: true }).split(' ')[0])}` : inc.has(state.month) && !d.current ? `<span class="warn-text">⚠ ${(() => { const pm = (state.derived.payMissing || []).filter((x) => x.month === state.month); return pm.length && ['income', 'net', 'rate'].includes(d.id) ? `${esc(pm[0].name)} not in statements` : 'statements missing this month'; })()}</span>` : esc(d.sub ? d.sub(state.month) : '')}</div>
      ${series.length > 1 ? `<div class="dt-spark">${spark(series, big ? 56 : 28)}</div>` : ''}
      ${big && series.length > 1 ? `<div class="dt-months" style="grid-template-columns:repeat(${ms.length},minmax(0,1fr))">${ms.map((m, i) => `<span>${esc(monthLabel(m, { short: true }).split(' ')[0].slice(0, 3))}<b>${esc(show(d, series[i]))}</b></span>`).join('')}</div>` : ''}
    </div>`;
  }).join('')}</div>`;
}

// ---------- Interactive bar chart (used in sheets) ----------
function barChart(points, { onTap = 'dash-bar', id = '', signed = false, pct = false, sel = null } = {}) {
  const W = 320, H = 150, pad = 8, base = signed ? H / 2 : H - 22;
  const max = Math.max(1, ...points.map((p) => Math.abs(p.value)));
  const step = (W - pad * 2) / points.length, bw = Math.min(34, step * 0.62);
  return `<svg class="ichart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Chart: tap a bar">
    <line x1="0" x2="${W}" y1="${base}" y2="${base}" class="axis"/>
    ${points.map((p, i) => {
      const h = Math.max(2, (Math.abs(p.value) / max) * (signed ? base - 14 : base - 14));
      const x = pad + i * step + (step - bw) / 2, y = p.value >= 0 ? base - h : base;
      return `<g class="ibar ${p.key === sel ? 'sel' : ''} ${p.value < 0 ? 'neg' : ''} ${p.inc ? 'inc' : ''}" data-action="${onTap}" data-id="${esc(id)}" data-key="${esc(p.key)}" role="button" tabindex="0" aria-label="${esc(p.label)}: ${esc(pct ? p.value + '%' : fmt(p.value, { whole: true }))}">
        <rect x="${x - (step - bw) / 2}" y="0" width="${step}" height="${H}" class="ihit"/>
        <rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="5"/>
        <text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle" class="bar-label">${esc(p.label)}</text></g>`;
    }).join('')}</svg>`;
}

function txTable(rows, n = 40) {
  if (!rows.length) return '<p class="sub">No transactions.</p>';
  const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date));
  return `<div class="raw-table"><div class="raw-row head"><span>Date</span><span>Description</span><span>Amount</span></div>
    ${sorted.slice(0, n).map((t) => `<div class="raw-row"><span>${prettyDate(t.date)}</span><span class="ellipsis">${esc(t.merchant || t.description)}<small>${esc(catName(t.category))} · ${esc(accountName(t.accountId))}</small></span><b class="${t.amount > 0 ? 'pos' : ''}">${fmt(t.amount, { sign: t.amount > 0 })}</b></div>`).join('')}
    ${sorted.length > n ? `<div class="sub">+ ${sorted.length - n} more in the CSV</div>` : ''}</div>`;
}

let csvRows = [], csvName = 'data.csv';
function csvButton(rows, name) {
  csvRows = rows; csvName = name;
  return rows.length ? `<button class="btn ghost full" data-action="dash-csv">⬇︎ Download ${rows.length} row${rows.length === 1 ? '' : 's'} (CSV)</button>` : '';
}
const linksHtml = (links) => `<div class="act-links">${links.map(([h, l]) => `<a class="act-link" href="${esc(h)}">${esc(l)} ›</a>`).join('')}</div>`;

// ---------- Breakdown of a month's rows: by category and by account ----------
function splitHtml(rows, m) {
  const by = (key) => { const o = {}; for (const t of rows) { const v = -t.amount; if (!v) continue; o[key(t)] = (o[key(t)] || 0) + v; } return Object.entries(o).filter(([, v]) => Math.abs(v) > 0).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])); };
  const sign = rows.length && rows.every((t) => t.amount > 0) ? -1 : 1; // income rows are positive
  const cats = by((t) => t.category).map(([k, v]) => [k, v * sign]).slice(0, 8);
  const accs = by((t) => t.accountId).map(([k, v]) => [k, v * sign]);
  const bar = (list, label, color, href) => { const tot = list.reduce((a, [, x]) => a + Math.max(0, x), 0) || 1; return list.map(([k, x]) => `<a class="mini-bar" href="${href(k)}"><span class="ellipsis">${esc(label(k))}</span><span class="mb-track"><i style="width:${((Math.max(0, x) / tot) * 100).toFixed(1)}%;background:${color(k)}"></i></span><b>${fmt(x, { whole: true })}</b></a>`).join(''); };
  const mm = monthLabel(m, { short: true });
  return `${cats.length > 1 ? `<h3>By category · ${esc(mm)}</h3>${bar(cats, catName, (c) => (CAT[c] || CAT.other).color, (c) => `#/transactions?cat=${esc(c)}`)}` : ''}
    ${accs.length > 1 ? `<h3>By account · ${esc(mm)}</h3>${bar(accs, accountName, () => 'var(--accent)', () => '#/accounts')}<p class="sub">If two accounts show the same amounts, one may be imported twice; if money goes from one of your accounts to another, it shouldn't count here.</p>` : ''}`;
}

// ---------- Metric sheet ----------
function metricSheet(id, sel = state.month) {
  const d = { id, ...METRICS[id] };
  const ms = window6();
  const inc = state.derived.incomplete || new Set();
  const pts = d.current ? [] : ms.map((m) => ({ key: m, label: monthLabel(m, { short: true }).split(' ')[0].slice(0, 3) + (inc.has(m) ? '*' : ''), value: d.value(m), inc: inc.has(m) }));
  const full = pts.filter((p) => !p.inc && p.key !== monthKey(state.derived.today));
  const v = d.value(sel);
  const list = d.list ? d.list() : null;
  const rows = d.rows(sel);
  const base = full.length ? full : pts;
  const avg = base.length ? Math.round(base.reduce((a, p) => a + p.value, 0) / base.length * 10) / 10 : null;
  const best = base.length ? base.reduce((a, p) => ((d.good === 'high' ? p.value > a.value : p.value < a.value) ? p : a), base[0]) : null;
  // Category split of the rows (where there's spending behind the number).
  openSheet(`<h2><span class="dt-ic big">${tIcon(id)}</span> ${esc(d.label)}</h2>
    <div class="sheet-big ${tone(d, v)}">${esc(show(d, v))}<small> ${esc(d.current ? 'now' : monthLabel(sel))}</small></div>
    <p class="muted">${esc(d.explain)}</p>
    ${pts.length > 1 ? `<div id="dash-chart">${barChart(pts, { id, signed: pts.some((p) => p.value < 0), pct: d.pct, sel })}</div><p class="sub">Tap a month to see its transactions.</p>
      ${pts.some((p) => p.inc) ? '<p class="sub warn-text">* Missing statements that month, so its total is too low. Left out of the average.</p>' : ''}<div class="stat-grid"><div><span class="label">${base.length < pts.length ? `Average of ${base.length} complete months` : '6-month average'}</span><b>${esc(show(d, d.pct ? avg : Math.round(avg)))}</b></div><div><span class="label">${d.good === 'high' ? 'Best' : 'Lowest'} month</span><b>${esc(monthLabel(best.key, { short: true }))} · ${esc(show(d, best.value))}</b></div></div>` : ''}
    ${list ? `<h3>Details</h3>${list.map((r) => `<div class="list-row">${r.category ? catChip(r.category) : ''}<div class="grow">${esc(r.name)}<div class="sub">${esc(r.sub || [r.type, r.nextDue && prettyDate(r.nextDue)].filter(Boolean).join(' · '))}</div></div><b>${fmt(r.amount)}</b></div>`).join('') || '<p class="sub">Nothing to show.</p>'}` : ''}
    ${id === 'income' ? incomeSheetExtra(sel) : ''}
    <div id="dash-split">${splitHtml(rows, sel)}</div>
    ${id === 'spent' || id === 'daily' ? weekdayHtml(sel) : ''}
    ${list && !rows.length ? '' : `<h3 id="dash-raw-h">Transactions · ${esc(monthLabel(sel, { short: true }))}</h3><div id="dash-raw">${txTable(rows)}</div>`}
    <div id="dash-csv-wrap">${csvButton(rows.length ? rows : (list || []).map((r) => ({ date: r.nextDue || '', description: r.name, amount: -r.amount, category: r.category || '', accountId: r.accountId || '' })), `${id}-${sel}.csv`)}</div>
    <h3>Go to</h3>${linksHtml(d.links)}
    <button class="btn ghost full" data-action="close-sheet">Done</button>`, { wide: true });
}

// ---------- Chart sheets (Overview charts) ----------
function categorySheet(cat, sel = state.month) {
  const ms = window6();
  const val = (m) => inMonth(m).filter((t) => t.category === cat).reduce((a, t) => a - t.amount, 0);
  const pts = ms.map((m) => ({ key: m, label: monthLabel(m, { short: true }).split(' ')[0].slice(0, 3), value: val(m) }));
  const rows = inMonth(sel).filter((t) => t.category === cat);
  const by = {};
  for (const t of rows) by[t.merchant || t.description] = (by[t.merchant || t.description] || 0) - t.amount;
  const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const line = state.derived.budget.byCategory[cat];
  openSheet(`<h2>${catChip(cat)} ${esc(catName(cat))}</h2>
    <div class="sheet-big">${fmt(val(sel), { whole: true })}<small> ${esc(monthLabel(sel))}${line?.budget ? ` · budget ${fmt(line.budget, { whole: true })}` : ''}</small></div>
    <div id="dash-chart">${barChart(pts, { onTap: 'dash-catbar', id: cat, sel })}</div><p class="sub">Tap a month to see its payments.</p>
    ${top.length ? `<h3>Where</h3>${top.map(([n, x]) => `<div class="list-row"><span class="grow ellipsis">${esc(n)}</span><b>${fmt(x)}</b></div>`).join('')}` : ''}
    <h3 id="dash-raw-h">Transactions · ${esc(monthLabel(sel, { short: true }))}</h3><div id="dash-raw">${txTable(rows)}</div>
    <div id="dash-csv-wrap">${csvButton(rows, `${cat}-${sel}.csv`)}</div>
    <h3>Go to</h3>${linksHtml([[`#/transactions?cat=${cat}`, 'All in Transactions'], ['#/budget', 'Set a budget'], ['#/categories', 'Categories'], ['#/insights', 'Ways to cut']])}
    <button class="btn ghost full" data-action="close-sheet">Done</button>`, { wide: true });
}

function monthSheet(m) {
  const s = sum(m);
  const rows = inMonth(m).filter((t) => catKind(t.category) !== 'transfer');
  const cats = Object.entries(s.byCat || {}).sort((a, b) => b[1] - a[1]);
  const total = cats.reduce((a, [, x]) => a + x, 0) || 1;
  openSheet(`<h2>${esc(monthLabel(m))}</h2>
    <div class="stat-grid"><div><span class="label">In</span><b class="pos">${fmt(s.income, { whole: true })}</b></div><div><span class="label">Spent</span><b>${fmt(s.spend, { whole: true })}</b></div>
      <div><span class="label">Saved</span><b>${fmt(s.saved, { whole: true })}</b></div><div><span class="label">Left over</span><b class="${s.net < 0 ? 'neg' : 'pos'}">${fmt(s.net, { whole: true, sign: true })}</b></div></div>
    <h3>By category</h3>${cats.map(([c, x]) => `<button class="mini-bar" data-action="dash-cat" data-cat="${esc(c)}" data-month="${esc(m)}"><span class="ellipsis">${esc(catName(c))}</span><span class="mb-track"><i style="width:${((x / total) * 100).toFixed(1)}%;background:${(CAT[c] || CAT.other).color}"></i></span><b>${fmt(x, { whole: true })}</b></button>`).join('')}
    <h3>Transactions</h3>${txTable(rows, 30)}
    ${csvButton(rows, `transactions-${m}.csv`)}
    <h3>Go to</h3><div class="act-links"><button class="act-link" data-action="dash-viewmonth" data-month="${esc(m)}">Show ${esc(monthLabel(m, { short: true }))} on Overview ›</button><a class="act-link" href="#/history">Monthly record ›</a><a class="act-link" href="#/transactions">Transactions ›</a></div>
    <button class="btn ghost full" data-action="close-sheet">Done</button>`, { wide: true });
}

function paceSheet() {
  const m = state.month, prev = addMonths(m, -1);
  const daily = (key) => { const a = new Array(daysInMonth(key)).fill(0); for (const t of inMonth(key)) if (isSpend(t)) a[+t.date.slice(8) - 1] -= t.amount; return a; };
  const cur = daily(m), pr = daily(prev);
  const upto = m === monthKey(state.derived.today) ? +state.derived.today.slice(8) : cur.length;
  let cc = 0, pc = 0;
  const rows = [];
  for (let d = 0; d < Math.max(upto, 0); d++) { cc += Math.max(0, cur[d]); pc += Math.max(0, pr[d] || 0); rows.push([d + 1, cur[d], cc, pc]); }
  const spend = inMonth(m).filter(isSpend);
  openSheet(`<h2>Day by day · ${esc(monthLabel(m, { short: true }))}</h2>
    <p class="muted">Running total this month against the same day last month. Tap a day to see what you bought.</p>
    <div class="raw-table"><div class="raw-row head four"><span>Day</span><span>Spent</span><span>Running</span><span>Last month</span></div>
    ${rows.reverse().map(([d, x, c, p]) => { const tx = spend.filter((t) => +t.date.slice(8) === d); return `<details class="day-row"><summary class="raw-row four"><span>${d}</span><span>${x > 0 ? fmt(x, { whole: true }) : '–'}</span><b class="${c > p ? 'neg' : 'pos'}">${fmt(c, { whole: true })}</b><span class="muted">${fmt(p, { whole: true })}</span></summary>${tx.map((t) => `<div class="raw-row sub3"><span class="ellipsis">${esc(t.merchant || t.description)}</span><span class="muted">${esc(catName(t.category))}</span><b>${fmt(-t.amount)}</b></div>`).join('') || '<div class="sub">No spending.</div>'}</details>`; }).join('')}</div>
    ${csvButton(spend, `daily-${m}.csv`)}
    <h3>Go to</h3>${linksHtml([['#/budget', 'Budget'], ['#/track', 'On track'], ['#/transactions', 'Transactions']])}
    <button class="btn ghost full" data-action="close-sheet">Done</button>`, { wide: true });
}

// ---------- Customise ----------
function editSheet() {
  const p = prefs();
  const order = [...p.tiles, ...Object.keys(METRICS).filter((k) => !p.tiles.includes(k))];
  openSheet(`<h2>Customise dashboard</h2><p class="muted">Tick what to show; use the arrows to reorder. ⤢ on a tile makes it bigger.</p>
    <div id="dash-edit">${order.map((id, i) => `<div class="dash-edit-row"><label class="check-row grow"><input type="checkbox" data-id="${id}" ${p.tiles.includes(id) ? 'checked' : ''}><span><span class="dt-ic">${tIcon(id)}</span> ${esc(METRICS[id].label)}${METRICS[id].current ? ' <small class="muted">this month only</small>' : ''}</span></label>
      <button class="icon-btn small" data-action="dash-move" data-id="${id}" data-dir="-1" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>↑</button><button class="icon-btn small" data-action="dash-move" data-id="${id}" data-dir="1" aria-label="Move down" ${i === order.length - 1 ? 'disabled' : ''}>↓</button></div>`).join('')}</div>
    <button class="btn primary full" data-action="dash-save">Save</button>
    <button class="btn ghost full" data-action="dash-reset">Reset to default</button>`, { wide: true });
}

function swapRaw(rows, sel, name) {
  const raw = document.getElementById('dash-raw');
  if (raw) raw.innerHTML = txTable(rows);
  const h = document.getElementById('dash-raw-h');
  if (h) h.textContent = `Transactions · ${monthLabel(sel, { short: true })}`;
  const c = document.getElementById('dash-csv-wrap');
  if (c) c.innerHTML = csvButton(rows, name);
  document.querySelectorAll('#dash-chart .ibar').forEach((g) => g.classList.toggle('sel', g.dataset.key === sel));
  raw?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

export const dashActions = {
  'dash-open': (el) => metricSheet(el.dataset.id),
  'dash-size': (el, rerender) => {
    const p = prefs();
    p.big = p.big.includes(el.dataset.id) ? p.big.filter((x) => x !== el.dataset.id) : [...p.big, el.dataset.id];
    savePrefs(p); rerender();
  },
  'dash-bar': (el) => {
    const d = METRICS[el.dataset.id];
    const m = el.dataset.key;
    const split = document.getElementById('dash-split');
    if (split) split.innerHTML = splitHtml(d.rows(m), m);
    swapRaw(d.rows(m), m, `${el.dataset.id}-${m}.csv`);
    const big = document.querySelector('.sheet-big');
    if (big) big.innerHTML = `${esc(show(d, d.value(m)))}<small> ${esc(monthLabel(m))}</small>`;
  },
  'dash-catbar': (el) => {
    const m = el.dataset.key, cat = el.dataset.id;
    const rows = inMonth(m).filter((t) => t.category === cat);
    swapRaw(rows, m, `${cat}-${m}.csv`);
    const big = document.querySelector('.sheet-big');
    if (big) big.innerHTML = `${fmt(rows.reduce((a, t) => a - t.amount, 0), { whole: true })}<small> ${esc(monthLabel(m))}</small>`;
  },
  'dash-cat': (el) => categorySheet(el.dataset.cat, el.dataset.month || state.month),
  'dash-month': (el) => monthSheet(el.dataset.month),
  'dash-pace': () => paceSheet(),
  'dash-viewmonth': (el, rerender) => { state.month = el.dataset.month; closeSheet(); rerender(); },
  'dash-csv': async () => {
    const q = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
    const lines = [['Date', 'Description', 'Amount', 'Category', 'Account'].join(','), ...csvRows.map((t) => [t.date, q(t.description || t.merchant), (t.amount / 100).toFixed(2), q(catName(t.category)), q(t.accountId ? accountName(t.accountId) : '')].join(','))];
    await shareFile(csvName, lines.join('\n'), 'text/csv');
  },
  'dash-edit': () => editSheet(),
  'dash-move': (el) => {
    const row = el.closest('.dash-edit-row');
    const dir = +el.dataset.dir;
    const sib = dir < 0 ? row.previousElementSibling : row.nextElementSibling;
    if (!sib) return;
    if (dir < 0) row.parentNode.insertBefore(row, sib); else row.parentNode.insertBefore(sib, row);
    const rows = [...document.querySelectorAll('.dash-edit-row')];
    rows.forEach((r, i) => r.querySelectorAll('[data-action=dash-move]').forEach((b) => { b.disabled = (b.dataset.dir === '-1' && i === 0) || (b.dataset.dir === '1' && i === rows.length - 1); }));
  },
  'dash-save': (el, rerender) => {
    const p = prefs();
    p.tiles = [...document.querySelectorAll('#dash-edit input[type=checkbox]')].filter((c) => c.checked).map((c) => c.dataset.id);
    savePrefs(p); closeSheet(); rerender(); toast('Dashboard saved');
  },
  'dash-reset': (el, rerender) => { savePrefs({}); closeSheet(); rerender(); toast('Dashboard reset'); },
};

// Make chart parts tappable by keyboard too.
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.dash-tile, .ibar, .donut-seg, .tbar')) { e.preventDefault(); e.target.click(); }
});
