// Home: the household at a glance. Headline figures with six-month trends, money in vs out, where it
// goes, fixed vs flexible, the next two weeks, budgets, accounts, subscriptions and merchants.
// Every figure comes from the same sources as the detail pages (derived.income, derived.billsOut…).
import { state } from '../../state.js';
import { esc } from '../dom.js';
import { fmt } from '../../lib/money.js';
import { summarizeMonth, spendCategoriesOf } from '../../lib/analysis.js';
import { budgetProgress } from '../../lib/budget.js';
import { catName, catKind, CAT } from '../../lib/categories.js';
import { monthKey, monthLabel, addMonths, prettyDate, addDays, daysBetween } from '../../lib/dates.js';
import { monthOutlook } from '../../lib/forecast.js';
import { trendBars, donut, sparkline } from '../charts.js';
import { catChip, emptyState } from '../common.js';

const SUBS = new Set(['subscriptions', 'entertainment', 'fitness', 'personal_care']);
const pct = (v) => `${Math.round(v * 100)}%`;
const card = (href, cls, inner) => `<a class="card mi ${cls}" href="${href}">${inner}</a>`;

export function render() {
  const d = state.derived;
  if (!state.txs.length) return emptyState({ title: 'Your money, at a glance', body: 'Import a statement from each bank app and this page fills with your figures.' });
  const today = d.today, cur = monthKey(today), prev = addMonths(cur, -1);
  const months = d.months.filter((m) => m <= cur).slice(-6);
  const sums = Object.fromEntries(months.map((m) => [m, summarizeMonth(state.txs, m)]));
  const s = sums[cur] || summarizeMonth(state.txs, cur);
  const done = months.filter((m) => m < cur && !d.incomplete?.has(m));
  const mo = monthOutlook({ txs: state.txs, today, budget: d.budget, recurring: d.recurring });
  const series = (f) => months.map((m) => f(sums[m]));
  // Spent by this day last month, for a fair comparison mid-month.
  const day = +today.slice(8);
  const prevSoFar = state.txs.filter((t) => t.date.startsWith(prev) && +t.date.slice(8) <= day && t.amount < 0 && !['income', 'transfer', 'savings'].includes(catKind(t.category))).reduce((a, t) => a - t.amount, 0)
    - state.txs.filter((t) => t.date.startsWith(prev) && +t.date.slice(8) <= day && t.amount > 0 && !['income', 'transfer', 'savings'].includes(catKind(t.category))).reduce((a, t) => a + t.amount, 0);
  const spendDelta = sums[prev] ? s.spend - prevSoFar : null;
  const rates = done.map((m) => (sums[m].income ? (sums[m].income - sums[m].spend - sums[m].saved) / sums[m].income : 0));
  const rate = rates.length ? rates.reduce((a, v) => a + v, 0) / rates.length : null;
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  // Where it goes (this month), and fixed vs flexible.
  const cats = spendCategoriesOf(s);
  const k = s.kinds, kTotal = (k.fixed || 0) + (k.essential || 0) + (k.personal || 0) || 1;
  // Next 14 days of payments.
  const soon = d.billsOut.filter((r) => r.nextDue >= today && r.nextDue <= addDays(today, 14)).sort((a, b) => a.nextDue.localeCompare(b.nextDue));
  // Budgets most used.
  const prog = budgetProgress(state.txs, d.budget, cur).rows.filter((r) => r.budget > 0 && catKind(r.category) !== 'fixed').sort((a, b) => b.pct - a.pct).slice(0, 4);
  // Accounts.
  const bal = (f) => state.accounts.filter(f).reduce((x, a) => x + (a.balance || 0), 0);
  const cash = bal((a) => !['savings', 'credit', 'investment'].includes(a.type)), saved = bal((a) => a.type === 'savings'), owed = Math.max(0, -bal((a) => a.type === 'credit'));
  // Subscriptions.
  const subs = d.billsOut.filter((r) => SUBS.has(r.category)).sort((a, b) => b.amount - a.amount);
  const subsMo = subs.reduce((a, r) => a + r.amount, 0);

  const kpi = (href, label, value, sub, vals, tone = '') => card(href, 'kpi', `<span class="mi-l">${label}</span><b class="mi-v ${tone}">${value}</b><span class="mi-s">${sub}</span>${vals.length > 1 ? `<span class="mi-spark">${sparkline(vals, { w: 120, h: 30 })}</span>` : ''}`);
  return `
  <header class="mi-head"><div><span class="mi-hello">${hello}</span><h1 class="page-title">Home</h1></div><span class="mi-date">${esc(monthLabel(cur))} · day ${day}</span></header>
  <div class="mi-grid">
    ${kpi('#/income', 'Income', fmt(s.income, { whole: true }), `of ${fmt(d.income.total, { whole: true })} expected`, series((x) => x.income))}
    ${kpi('#/spending', 'Spent', fmt(s.spend, { whole: true }), spendDelta == null ? 'this month' : `${spendDelta > 0 ? '▲' : '▼'} ${fmt(Math.abs(spendDelta), { whole: true })} vs ${esc(monthLabel(prev, { short: true }).split(' ')[0])} so far`, series((x) => x.spend), spendDelta > 0 ? 'neg-soft' : '')}
    ${kpi('#/home', 'Month end', fmt(mo.left, { whole: true, sign: true }), 'at this pace', series((x) => x.income - x.spend - x.saved), mo.left < 0 ? 'neg' : 'pos')}
    ${kpi('#/history', 'Saving rate', rate == null ? '–' : pct(rate), done.length ? `average of ${done.length} full month${done.length > 1 ? 's' : ''}` : 'needs a full month', series((x) => (x.income ? Math.round(((x.income - x.spend - x.saved) / x.income) * 100) : 0)), rate != null && rate < 0 ? 'neg' : '')}
  </div>

  ${months.length > 1 ? card('#/history', 'chart', `<div class="mi-h"><b>Money in vs out</b><span>${months.length} months</span></div>${trendBars(months.map((m) => ({ key: m, label: monthLabel(m, { short: true }).split(' ')[0], income: sums[m].income, spend: sums[m].spend, active: m === cur })), { height: 120 })}<div class="legend"><span><i class="sw in"></i>In</span><span><i class="sw out"></i>Out</span></div>`) : ''}

  <div class="mi-two">
    ${cats.length ? card('#/spending', 'where', `<div class="mi-h"><b>Where it goes</b><span>${esc(monthLabel(cur, { short: true }))}</span></div>
      <div class="mi-donut">${donut(cats.slice(0, 6).map((c) => ({ key: c.category, value: c.total, color: c.color, label: c.name })), { size: 120, thickness: 16, center: fmt(s.spend, { whole: true }), sub: 'spent' })}</div>
      <div class="mi-legend">${cats.slice(0, 4).map((c) => `<span><i style="background:${c.color}"></i>${esc(c.name)}<b>${pct(c.total / (s.spend || 1))}</b></span>`).join('')}</div>`) : ''}
    ${card('#/budget', 'mix', `<div class="mi-h"><b>Fixed or flexible</b><span>${esc(monthLabel(cur, { short: true }))}</span></div>
      ${[['fixed', 'Bills & fixed', 'var(--ck-paid)'], ['essential', 'Essentials', 'var(--ck-due)'], ['personal', 'Lifestyle', 'var(--ck-spent)']].map(([key, l, c]) => `<div class="mix-row"><span>${l}</span><b>${fmt(k[key] || 0, { whole: true })}</b><span class="mix-bar"><i style="width:${(((k[key] || 0) / kTotal) * 100).toFixed(0)}%;background:${c}"></i></span><small>${pct((k[key] || 0) / kTotal)}</small></div>`).join('')}`)}
  </div>

  ${card('#/bills', 'soon', `<div class="mi-h"><b>Next 14 days</b><span>${fmt(soon.reduce((a, r) => a + r.amount, 0), { whole: true })} · ${soon.length} payment${soon.length === 1 ? '' : 's'}</span></div>
    ${soon.length ? `<div class="soon-list">${soon.slice(0, 6).map((r) => `<div class="soon-row"><span class="soon-date"><b>${+r.nextDue.slice(8)}</b><small>${esc(prettyDate(r.nextDue).split(' ')[1] || '')}</small></span><span class="grow ellipsis">${esc(r.name)}<small>${daysBetween(today, r.nextDue) === 0 ? 'today' : `in ${daysBetween(today, r.nextDue)} day${daysBetween(today, r.nextDue) === 1 ? '' : 's'}`}</small></span><b>${fmt(r.amount, { whole: true })}</b></div>`).join('')}</div>` : '<p class="sub">Nothing due in the next two weeks.</p>'}`)}

  ${prog.length ? card('#/budget', 'budgets', `<div class="mi-h"><b>Budgets</b><span>most used</span></div><div class="ring-row">${prog.map((r) => { const p = Math.min(1, r.pct); return `<span class="b-ring"><span class="ring" style="--p:${(p * 100).toFixed(0)};--c:${r.pct > 1 ? 'var(--bad)' : r.pct > 0.85 ? 'var(--warn)' : 'var(--accent)'}"><b>${pct(r.pct)}</b></span><small>${esc(catName(r.category))}</small></span>`; }).join('')}</div>`) : ''}

  <div class="mi-two">
    ${card('#/accounts', 'acc', `<div class="mi-h"><b>Accounts</b></div><b class="mi-v ${cash + saved - owed < 0 ? 'neg' : ''}">${fmt(cash + saved - owed, { whole: true })}</b><span class="mi-s">overall, after cards</span>
      <div class="acc-mini"><span><i class="c"></i>Current ${fmt(cash, { whole: true })}</span><span><i class="s"></i>Savings ${fmt(saved, { whole: true })}</span><span><i class="o"></i>Cards ${fmt(owed, { whole: true })}</span></div>`)}
    ${card('#/bills', 'subs', `<div class="mi-h"><b>Subscriptions</b></div><b class="mi-v">${fmt(subsMo, { whole: true })}<small>/mo</small></b><span class="mi-s">${subs.length} · ${fmt(subsMo * 12, { whole: true })} a year</span>
      <div class="sub-mini">${subs.slice(0, 3).map((r) => `<span>${esc(r.name)}<b>${fmt(r.amount, { whole: true })}</b></span>`).join('')}</div>`)}
  </div>

  ${s.merchants.length ? card('#/spending', 'merch', `<div class="mi-h"><b>Top merchants</b><span>${esc(monthLabel(cur, { short: true }))}</span></div>${s.merchants.slice(0, 5).map((m, i) => `<div class="m-row"><span class="m-n">${i + 1}</span>${catChip(m.category)}<span class="grow ellipsis">${esc(m.name)}</span><b>${fmt(m.total, { whole: true })}</b></div>`).join('')}`) : ''}

  <a class="btn ghost full" href="#/numbers">Every figure, month by month</a>`;
}
