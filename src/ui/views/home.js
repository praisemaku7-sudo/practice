import { state, accountName } from '../../state.js';
import { esc, openSheet } from '../dom.js';
import { fmt } from '../../lib/money.js';
import { compareMonths, spendCategoriesOf, summarizeMonth } from '../../lib/analysis.js';
import { budgetProgress } from '../../lib/budget.js';
import { catName, catKind } from '../../lib/categories.js';
import { monthKey, addMonths, addDays, monthLabel, prettyDate, nextDayOfMonth, daysInMonth as daysInMonthOf } from '../../lib/dates.js';
import { donut, trendBars, progressBar, paceChart } from '../charts.js';
import { monthSwitcher, catChip, delta, emptyState } from '../common.js';
import { goalPlan } from '../../lib/goals.js';
import { dashboard } from '../dashboard.js';
import { cockpit } from '../cockpit.js';
import { buildAlerts } from '../alerts.js';
import { safeToSpend } from '../overview-extras.js';
import { balanceForecast, paidThisMonth } from '../../lib/cashflow.js';
import { monthOutlook, budgetAlerts } from '../../lib/forecast.js';

/** Balance from today to just after payday, with each bill and pay as a tappable dot. */
function cashflowCard() {
  const d = state.derived;
  const cur = state.accounts.filter((a) => a.type === 'current' && a.balance != null);
  if (!cur.length) return '';
  const flags = state.settings.billFlags || {}, hidden = state.settings.billHidden || {};
  const live = d.recurring.filter((r) => (r.category !== 'transfer' || r.cardRepay) && !hidden[r.key] && flags[r.key] !== 'cancelled');
  const start = d.balance ?? cur.reduce((a, x) => a + x.balance, 0);
  const until = d.payday ? nextDayOfMonth(addDays(d.today, 1), d.payday) : `${monthKey(d.today)}-${String(daysInMonthOf(monthKey(d.today))).padStart(2, '0')}`;
  const fc = balanceForecast({ start, today: d.today, until, recurring: live, paidKeys: paidThisMonth(live, state.txs, monthKey(d.today), state.settings.billPaid) });
  if (fc.rows.length < 2) return '';
  const W = 320, H = 80, vals = fc.rows.map((r) => r.balance), lo = Math.min(0, ...vals), hi = Math.max(0, ...vals), span = hi - lo || 1;
  const x = (i) => 6 + (i / (fc.rows.length - 1)) * (W - 12), y = (v) => H - 6 - ((v - lo) / span) * (H - 14);
  const path = fc.rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r.balance).toFixed(1)}`).join(' ');
  const events = fc.rows.filter((r) => r.inflow || r.outflow);
  return `<div class="card cf-card"><div class="row between"><h3>Balance to payday</h3><a class="chip" href="#/bills">Calendar ›</a></div>
    <div class="cf-stats"><span>Now <b>${fmt(start, { whole: true })}</b></span><span>Lowest <b class="${fc.low.balance < 0 ? 'neg' : ''}">${fmt(fc.low.balance, { whole: true })}</b> <small>${prettyDate(fc.low.date)}</small></span><span>After pay <b>${fmt(fc.end, { whole: true })}</b></span></div>
    <svg class="fc-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Balance forecast to payday"><line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" class="fc-zero"/><path d="${path}" class="fc-line"/>
      ${fc.rows.map((r, i) => (r.inflow || r.outflow ? `<circle cx="${x(i)}" cy="${y(r.balance)}" r="4.5" class="${r.balance < 0 ? 'fc-neg' : r.inflow ? 'fc-in' : 'fc-out'}" data-action="cf-day" data-date="${r.date}" role="button" aria-label="${prettyDate(r.date)}"/>` : '')).join('')}</svg>
    <div class="cf-events">${events.slice(0, 6).map((r) => `<button class="cf-ev ${r.balance < 0 ? 'neg' : ''}" data-action="cf-day" data-date="${r.date}"><b>${prettyDate(r.date)}</b><span class="ellipsis">${esc(r.items.map((i) => i.name).join(', '))}</span><span class="${r.inflow ? 'pos' : ''}">${r.inflow ? '+' + fmt(r.inflow, { whole: true }) : '−' + fmt(r.outflow, { whole: true })}</span></button>`).join('')}</div>
    <p class="sub">Bills and pay still to come${d.balance == null ? ', from your last imported balance' : ''}. Card spending isn't included.</p></div>`;
}

export function render() {
  const { derived, month } = state;
  if (!state.txs.length) {
    return emptyState({ title: 'Start with a statement', body: 'Import the PDF or CSV statements from each bank app. Everything stays on this phone.' });
  }
  const { budget, months, today } = derived;
  const cmp = compareMonths(state.txs, month);
  const s = cmp.cur;
  const isCurrent = month === monthKey(today);
  const prog = budgetProgress(state.txs, budget, month);
  const cats = spendCategoriesOf(s);
  const totalBudget = budget.lines.reduce((a, l) => a + l.budget, 0);



  // Daily spend this month vs last month, for the pace line.
  const dailySpend = (key) => {
    const arr = new Array(daysInMonthOf(key)).fill(0);
    for (const t of state.txs) {
      if (monthKey(t.date) !== key || ['income', 'transfer', 'savings'].includes(catKind(t.category))) continue;
      arr[+t.date.slice(8) - 1] -= t.amount;
    }
    return arr;
  };
  const curDaily = dailySpend(month), prevDaily = dailySpend(addMonths(month, -1));
  const daysSoFar = isCurrent ? +today.slice(8) : curDaily.length;
  const prevSameDay = prevDaily.slice(0, daysSoFar).reduce((a, v) => a + Math.max(0, v), 0);
  const paceDelta = s.spend - prevSameDay;

  const trendData = months.slice(-6).map((m) => {
    const x = summarizeMonth(state.txs, m);
    return { key: m, label: monthLabel(m, { short: true }).split(' ')[0], income: x.income, spend: x.spend, active: m === month };
  });

  const movers = cmp.hasPrev ? cmp.rows.filter((r) => Math.abs(r.delta) >= 1000 && !['income', 'transfer', 'savings'].includes(r.category)).slice(0, 4) : [];

  const urgent = buildAlerts().filter((x) => x.tone === 'bad').slice(0, 1);
  const safe = isCurrent ? safeToSpend() : null;
  const sumAcc = (f) => state.accounts.filter(f).reduce((x, a) => x + (a.balance || 0), 0);
  const net = sumAcc((a) => a.type !== 'credit' && a.type !== 'investment') + sumAcc((a) => a.type === 'credit');
  const gs = (state.settings.goals || []).filter((g) => !g.owner || g.owner === 'all' || state.settings.scope === 'all' || g.owner === state.settings.scope);
  const go = (href, ic, title, sub) => `<a class="go-row" href="${href}"><span class="go-ic" aria-hidden="true">${ic}</span><span class="go-txt"><b>${title}</b><small>${sub}</small></span><span class="go-chev" aria-hidden="true">›</span></a>`;
  return `
  ${monthSwitcher(month, months)}
  ${urgent.map((x) => `<button class="urgent" data-action="alert-open" data-id="${x.id}"><b>${esc(x.title)}</b><span>${esc(String(x.detail || '').split('. ')[0].slice(0, 90))} ›</span></button>`).join('')}
  ${cockpit()}
  <nav class="go-list" aria-label="Go to">
    ${go('#/spending', '🛍️', 'Spending', `${fmt(s.spend, { whole: true })} in ${esc(monthLabel(month, { short: true }))}${cats[0] ? ` · most on ${esc(cats[0].name.toLowerCase())}` : ''}`)}
    ${go('#/bills', '📅', 'Bills', safe ? `${fmt(safe.bills, { whole: true })} still to pay before payday` : 'Calendar, subscriptions and cancel list')}
    ${go('#/track', '🏡', 'The move', 'Can we afford the mortgage?')}
    ${go('#/accounts', '🏦', 'Accounts', `${fmt(net, { whole: true })} overall, after cards`)}
    ${gs.length ? go('#/goals', '🐷', 'Goals', `${gs.length} goal${gs.length > 1 ? 's' : ''}`) : ''}
    ${go('#/numbers', '📊', 'Your numbers', 'Every figure, month by month')}
  </nav>`;
}


// "How is this worked out?" — every main number can be traced to the transactions behind it.

function lines(rows) {
  return rows.map(([label, value, cls = '']) => `<div class="list-row"><div class="grow">${label}</div><b class="${cls}">${value}</b></div>`).join('');
}
function txList(txs, n = 12) {
  return txs.slice(0, n).map((t) => `<div class="pv-row"><span>${prettyDate(t.date)}</span><span class="ellipsis grow">${esc(t.description)} <small class="muted">${esc(accountName(t.accountId))}</small></span><b>${fmt(Math.abs(t.amount))}</b></div>`).join('');
}

export const actions = {
  'cf-day': (el) => { location.hash = `#/bills?month=${el.dataset.date.slice(0, 7)}`; },
  explain: (el) => {
    const month = state.month;
    const { budget, recurring, today } = state.derived;
    const m = state.txs.filter((t) => monthKey(t.date) === month);
    const s = summarizeMonth(state.txs, month);
    const what = el.dataset.what;
    let title = '', body = '';
    if (what === 'spent') {
      title = `Spent ${fmt(s.spend)}`;
      const spend = m.filter((t) => !['income', 'transfer', 'savings'].includes(catKind(t.category))).sort((a, b) => a.amount - b.amount);
      body = `<p class="muted">Every money-out payment in ${esc(monthLabel(month))}, minus refunds, excluding transfers between your accounts and money moved to savings.</p>
        ${lines(Object.entries(s.byCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => [esc(catName(c)), fmt(v)]))}
        <h4>Biggest payments</h4><div class="preview">${txList(spend)}</div>`;
    } else if (what === 'in') {
      title = `In ${fmt(s.income)}`;
      const inc = m.filter((t) => catKind(t.category) === 'income').sort((a, b) => b.amount - a.amount);
      body = `<p class="muted">Money in categorised as income. Transfers from your own accounts are not counted.</p><div class="preview">${txList(inc, 30)}</div>`;
    } else if (what === 'saved') {
      title = `Saved ${fmt(s.saved)}`;
      const sv = m.filter((t) => t.category === 'savings').sort((a, b) => a.amount - b.amount);
      body = `<p class="muted">Money moved into savings or investments, minus money taken back out.</p><div class="preview">${txList(sv, 30)}</div>`;
    } else if (what === 'left') {
      title = `Left over ${fmt(s.net, { sign: true })}`;
      body = lines([['In', fmt(s.income), 'pos'], ['− Spent', fmt(s.spend)], ['− Moved to savings', fmt(s.saved)], ['= Left over', fmt(s.net, { sign: true }), s.net < 0 ? 'neg' : 'pos']]);
    } else if (what === 'fun') {
      const prog = budgetProgress(state.txs, budget, monthKey(today));
      const personal = prog.rows.filter((r) => r.kind === 'personal' && r.spent > 0).sort((a, b) => b.spent - a.spent);
      const fixed = budget.lines.filter((l) => l.kind === 'fixed').reduce((a, l) => a + l.budget, 0);
      const ess = budget.lines.filter((l) => l.kind === 'essential').reduce((a, l) => a + l.budget, 0);
      title = `Fun money left ${fmt(prog.personalLeft)}`;
      body = `<h4>This month's allowance</h4>${lines([
        [`Income${budget.incomeIsEstimate ? ' (average of your statements)' : ''}`, fmt(budget.income), 'pos'],
        ['− Bills & commitments', fmt(fixed)], ['− Essentials', fmt(ess)], ['− Savings goal', fmt(budget.savingsTarget)],
        ...(budget.cardPayoff ? [['− Credit card payoff', fmt(budget.cardPayoff)]] : []),
        ['= Fun money (capped near what you usually spend)', fmt(budget.personalAllowance)],
      ])}
        <h4>Spent so far</h4>${lines(personal.map((r) => [esc(catName(r.category)), fmt(r.spent)]))}
        ${lines([['Left', fmt(prog.personalLeft), prog.personalLeft < 0 ? 'neg' : 'pos']])}
        <p class="sub">Wrong income? Set it in Budget. Wrong categories? Fix them in Transactions or Check my numbers.</p>
        <a class="btn ghost full" href="#/budget">Open Budget</a>`;
    }
    openSheet(`<h2>${title}</h2>${body}<a class="btn ghost full" href="#/audit">Check my numbers</a>`);
  },
};
