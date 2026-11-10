// Overview extras: income sources (expected vs received), spending by person, safe to spend until
// payday, largest payments, merchant drill-down, "when you spend", and a shareable month summary.
import { state, accountName, txOwner, personName } from '../state.js';
import { esc, openSheet, shareFile, toast } from './dom.js';
import { fmt } from '../lib/money.js';
import { summarizeMonth } from '../lib/analysis.js';
import { catName, catKind } from '../lib/categories.js';
import { monthKey, monthLabel, prettyDate, daysBetween, nextDayOfMonth, addDays } from '../lib/dates.js';
import { catChip } from './common.js';
import { helpFor } from '../lib/directory.js';
import { merchantKey } from '../lib/categorize.js';
import { balanceForecast, paidThisMonth } from '../lib/cashflow.js';

const NOT_SPEND = ['income', 'transfer', 'savings'];
const isSpend = (t) => !NOT_SPEND.includes(catKind(t.category));
const inMonth = (m) => state.txs.filter((t) => t.date.startsWith(m));
const ord = (d) => `${d}${d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th'}`;

/** Each regular income for a month: expected amount, whether it has arrived, and when. */
export function incomeSources(m = state.month) {
  const { recurring, today } = state.derived;
  const thisMonth = monthKey(today);
  const rows = inMonth(m).filter((t) => t.amount > 0 && catKind(t.category) === 'income');
  return recurring.filter((r) => r.direction === 'in' && r.months >= 2 && r.amount >= 5000 && (r.active || m < thisMonth)).map((r) => {
    const got = rows.filter((t) => (t.merchant || '').toUpperCase() === r.name.toUpperCase() || String(t.description).toUpperCase().includes(r.name.toUpperCase()));
    const received = got.reduce((a, t) => a + t.amount, 0);
    const due = `${m}-${String(Math.min(r.day, 28)).padStart(2, '0')}`;
    const status = received ? 'in' : m < thisMonth ? 'missing' : due < today ? 'late' : 'due';
    return { r, received, status, due, date: got[0]?.date || null, owner: txOwner({ accountId: r.accountId }, Object.fromEntries((state.allAccounts || state.accounts).map((a) => [a.id, a]))) };
  }).sort((a, b) => b.r.amount - a.r.amount);
}

/** Spending this month by whose account (or named cardholder) it was. */
export function spendByPerson(m = state.month) {
  const byId = Object.fromEntries((state.allAccounts || state.accounts).map((a) => [a.id, a]));
  const out = {};
  for (const t of inMonth(m)) if (isSpend(t)) { const o = txOwner(t, byId) || 'joint'; out[o] = (out[o] || 0) - t.amount; }
  return Object.entries(out).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([id, v]) => ({ id, name: id === 'joint' ? 'Joint' : personName(id).split(' ')[0], amount: v }));
}

/** What can be spent each day until payday after the bills still to come. */
export function safeToSpend() {
  const d = state.derived;
  const cur = state.accounts.filter((a) => a.type === 'current' && a.balance != null);
  if (!cur.length || !d.payday) return null;
  const nextPay = nextDayOfMonth(addDays(d.today, 1), d.payday);
  const live = d.recurring.filter((r) => (r.category !== 'transfer' || r.cardRepay) && r.direction === 'out');
  const start = d.balance ?? cur.reduce((a, x) => a + x.balance, 0);
  const fc = balanceForecast({ start, today: d.today, until: addDays(nextPay, -1), recurring: live, paidKeys: paidThisMonth(live, state.txs, monthKey(d.today), state.settings.billPaid) });
  const days = Math.max(1, daysBetween(d.today, nextPay));
  const buffer = 5000;
  const left = fc.end - buffer;
  return { nextPay, days, start, bills: start - fc.end, left, perDay: Math.max(0, Math.floor(left / days)), stale: d.balance == null };
}

export function largestPayments(m = state.month, n = 8) {
  return inMonth(m).filter((t) => isSpend(t) && t.amount < 0).sort((a, b) => a.amount - b.amount).slice(0, n);
}

/** Payday countdown text for the hero. */
export function paydayLine() {
  const { payday, today } = state.derived;
  if (!payday) return '';
  const next = nextDayOfMonth(today, payday);
  const n = daysBetween(today, next);
  const src = incomeSources(monthKey(today));
  const exp = src.filter((x) => x.status !== 'in').reduce((a, x) => a + x.r.amount, 0);
  return n === 0 ? '💷 Payday today' : `💷 Payday in ${n} day${n === 1 ? '' : 's'} (${ord(+next.slice(8))})${exp ? ` · ${fmt(exp, { whole: true })} still to come in` : ''}`;
}

// ---------- Sheets ----------
export function incomeSheetExtra(m) {
  const src = incomeSources(m);
  if (!src.length) return '';
  const label = { in: '✓ Received', due: 'Expected', late: 'Not in yet', missing: '⚠ Not in your statements' };
  return `<h3>Regular income · ${esc(monthLabel(m, { short: true }))}</h3>
    ${src.map((x) => `<div class="list-row"><div class="grow"><b>${esc(x.r.name)}</b><div class="sub">${esc(x.owner === 'joint' ? 'Joint' : personName(x.owner).split(' ')[0])} · ${esc(accountName(x.r.accountId))} · usually ${fmt(x.r.amount, { whole: true })} around the ${ord(x.r.day)}</div>
      <div class="sub ${x.status === 'in' ? 'pos' : x.status === 'missing' ? 'neg' : x.status === 'late' ? 'warn-text' : ''}">${label[x.status]}${x.received ? ` · ${fmt(x.received, { whole: true })}${x.date ? ` on ${prettyDate(x.date)}` : ''}` : ''}</div></div></div>`).join('')}
    ${src.some((x) => x.status === 'missing') ? `<p class="sub neg">Missing income almost always means a statement isn't imported yet for that account. <a href="#/import">Import ›</a></p>` : ''}`;
}

export function merchantSheet(name) {
  const all = state.txs.filter((t) => (t.merchant || merchantKey(t.description)) === name);
  if (!all.length) return;
  const byM = {};
  for (const t of all) byM[t.date.slice(0, 7)] = (byM[t.date.slice(0, 7)] || 0) - t.amount;
  const months = Object.keys(byM).sort().slice(-6);
  const max = Math.max(1, ...months.map((m) => Math.abs(byM[m])));
  const total = all.reduce((a, t) => a - t.amount, 0);
  const cat = all[all.length - 1].category;
  const h = helpFor(name);
  const rec = state.derived.recurring.find((r) => r.name === name && r.direction === 'out');
  openSheet(`<h2>${catChip(cat)} ${esc(name)}</h2>
    <div class="sheet-big">${fmt(total, { whole: true })}<small> across ${all.length} payment${all.length === 1 ? '' : 's'}</small></div>
    <p class="muted">${esc(catName(cat))} · average ${fmt(Math.round(total / Math.max(1, months.length)), { whole: true })} a month${rec ? ` · regular ${esc(rec.type)} on the ${ord(rec.day)}` : ''}</p>
    ${months.map((m) => `<div class="mini-bar static"><span>${esc(monthLabel(m, { short: true }))}</span><span class="mb-track"><i style="width:${((Math.abs(byM[m]) / max) * 100).toFixed(1)}%;background:var(--accent)"></i></span><b>${fmt(byM[m], { whole: true })}</b></div>`).join('')}
    <h3>Payments</h3>${[...all].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20).map((t) => `<div class="pv-row"><span>${prettyDate(t.date)}</span><span class="ellipsis grow">${esc(accountName(t.accountId))}</span><b class="${t.amount > 0 ? 'pos' : ''}">${fmt(t.amount, { sign: t.amount > 0 })}</b></div>`).join('')}
    <div class="row gap wrap">${rec ? `<button class="chip" data-action="act-flag" data-key="${esc(rec.key)}">＋ Cancel list</button>` : ''}<a class="chip" href="#/transactions?q=${encodeURIComponent(name)}">In Transactions ›</a><a class="chip" href="#/categories">Change category ›</a>${h ? `<a class="chip" href="${esc(h.url)}" target="_blank" rel="noopener">${esc(h.label)} ↗</a>` : ''}</div>
    <button class="btn ghost full" data-action="close-sheet">Done</button>`, { wide: true });
}

/** Spending by day of the week for a month: when the money goes. */
export function weekdayHtml(m) {
  const days = [0, 0, 0, 0, 0, 0, 0];
  for (const t of inMonth(m)) if (isSpend(t) && t.amount < 0 && catKind(t.category) !== 'fixed') days[(new Date(`${t.date}T12:00:00Z`).getUTCDay() + 6) % 7] -= t.amount;
  const max = Math.max(1, ...days);
  if (!days.some(Boolean)) return '';
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const top = days.indexOf(Math.max(...days));
  return `<h3>When you spend (not bills)</h3><div class="wk-bars">${days.map((v, i) => `<div class="${i === top ? 'top' : ''}"><i style="height:${Math.max(3, (v / max) * 60).toFixed(0)}px"></i><span>${names[i].slice(0, 2)}</span></div>`).join('')}</div>
    <p class="sub">${names[top]}s are your biggest spending day (${fmt(days[top], { whole: true })} this month).</p>`;
}

export function summaryText(m = state.month) {
  const s = summarizeMonth(state.txs, m);
  const cats = Object.entries(s.byCat || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return [`${monthLabel(m)} money summary`, `In: ${fmt(s.income, { whole: true })}`, `Spent: ${fmt(s.spend, { whole: true })}`, `Saved: ${fmt(s.saved, { whole: true })}`, `Left over: ${fmt(s.net, { whole: true, sign: true })}`, '', 'Biggest categories:', ...cats.map(([c, v]) => `• ${catName(c)}: ${fmt(v, { whole: true })}`), '', 'From Pocket Ledger'].join('\n');
}

export const extrasActions = {
  'mer-open': (el) => merchantSheet(el.dataset.m),
  'ov-share': async () => {
    const txt = summaryText();
    if (navigator.share) { try { await navigator.share({ title: 'Money summary', text: txt }); return; } catch (e) { if (e?.name === 'AbortError') return; } }
    await shareFile(`summary-${state.month}.txt`, txt, 'text/plain'); toast('Summary ready');
  },
};
