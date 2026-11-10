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
import { paydayLine } from '../overview-extras.js';
import { alertStrip } from '../alerts.js';
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

  return `
  ${monthSwitcher(month, months)}
  ${alertStrip()}
  <div class="card hero feature">
    <div class="hero-row">
      <div><button class="explain" data-action="explain" data-what="spent"><div class="label">Spent ⓘ</div><div class="big">${fmt(s.spend, { whole: true })}</div></button>
        ${cmp.hasPrev ? (isCurrent
          ? `<div class="sub">${delta(paceDelta)} vs this point in ${esc(monthLabel(addMonths(month, -1), { short: true }))}</div>`
          : `<div class="sub">${delta(s.spend - cmp.prev.spend)} vs ${esc(monthLabel(addMonths(month, -1), { short: true }))}</div>`) : ''}</div>
      <button class="icon-btn small share-btn" data-action="ov-share" aria-label="Share this month's summary"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    </div>
    ${isCurrent && paydayLine() ? `<div class="payday-line">${esc(paydayLine())}</div>` : ''}
    ${totalBudget ? `${progressBar(s.spend / totalBudget)}<div class="sub">${fmt(s.spend, { whole: true })} of ${fmt(totalBudget, { whole: true })} monthly budget</div>` : ''}
    ${cmp.hasPrev ? `<div class="pace-wrap tap-chart" data-action="dash-pace" role="button" tabindex="0" aria-label="Spending day by day: tap for the numbers">${paceChart(curDaily, prevDaily, daysSoFar)}
      <div class="pace-legend"><span><i class="sw cur"></i>${esc(monthLabel(month, { short: true }))}</span><span><i class="sw prev"></i>${esc(monthLabel(addMonths(month, -1), { short: true }))}</span>
      <span class="pace-more">Day by day ›</span></div></div>` : ''}
  </div>
  <section class="card dash">${dashboard()}</section>
  <nav class="quick-row" style="margin-top:-2px" aria-label="Shortcuts"><a class="qchip" href="#/insights">✨ AI review</a><a class="qchip" href="#/bills">📅 Calendar</a><a class="qchip" href="#/track">📈 On track</a><a class="qchip" href="#/budget">🎯 Budget</a><a class="qchip" href="#/afford">❓ Afford?</a><a class="qchip" href="#/transactions">🧾 Transactions</a></nav>
  ${(() => {
    const gs = (state.settings.goals || []).filter((g) => !g.owner || g.owner === 'all' || state.settings.scope === 'all' || g.owner === state.settings.scope);
    if (!gs.length) return '';
    const byId = Object.fromEntries((state.allAccounts || state.accounts).map((a) => [a.id, a]));
    return `<a class="card goals-mini" href="#/goals"><div class="label">🎯 Goals</div>${gs.slice(0, 3).map((g) => { const p = goalPlan(g, today, byId); return `<div class="goal-line"><span class="ellipsis">${esc(g.icon || '🎯')} ${esc(g.name)}</span><span class="sub">${Math.round(p.progress * 100)}%</span></div>${progressBar(p.progress, { warnAt: 2 })}`; }).join('')}</a>`;
  })()}
  ${isCurrent ? cashflowCard() : ''}
  ${movers.length ? `<div class="card"><h3>What changed vs last month</h3>
    ${movers.map((r) => `<div class="list-row">${catChip(r.category)}<div class="grow">${esc(catName(r.category))}<div class="sub">${fmt(r.previous, { whole: true })} → ${fmt(r.current, { whole: true })}</div></div>${delta(r.delta)}</div>`).join('')}
  </div>` : ''}
  <div class="card">
    <h3>Where it went</h3>
    <p class="sub tap-hint">Tap a slice or a category for its trend and transactions.</p>
    ${cats.length ? `<div class="donut-wrap">${donut(cats.map((c) => ({ key: c.category, value: c.total, color: c.color, label: c.name })), { center: fmt(s.spend, { whole: true }), sub: 'spent' })}</div>
    ${cats.map((c) => {
      const line = budget.byCategory[c.category];
      const row = cmp.rows.find((r) => r.category === c.category);
      return `<button class="list-row tap" data-action="dash-cat" data-cat="${c.category}">${catChip(c.category)}
        <div class="grow"><div class="row between"><span>${esc(c.name)}</span><b>${fmt(c.total)}</b></div>
        ${line?.budget ? progressBar(c.total / line.budget) : ''}
        <div class="sub row between"><span>${line?.budget ? `${fmt(line.budget, { whole: true })} budget` : 'no budget'}${row?.average ? ` · usually ${fmt(row.average, { whole: true })}` : ''}</span>${cmp.hasPrev && row ? delta(row.delta) : ''}</div></div></button>`;
    }).join('')}` : '<p class="muted">No spending this month.</p>'}
  </div>
  ${trendData.length > 1 ? `<div class="card"><h3>Last ${trendData.length} months</h3>${trendBars(trendData)}<p class="sub tap-hint">Tap a month for its breakdown and transactions.</p>
    <div class="legend"><span><i class="sw in"></i>Income</span><span><i class="sw out"></i>Spent</span></div>
    <a class="btn ghost full" href="#/history">Monthly record &amp; trends</a></div>` : ''}
  <div class="card"><h3>Top merchants</h3>
    ${s.merchants.slice(0, 8).map((m) => `<button class="list-row tap" data-action="mer-open" data-m="${esc(m.name)}">${catChip(m.category)}<div class="grow">${esc(m.name)}<div class="sub">${m.count} payment${m.count > 1 ? 's' : ''} · tap for history</div></div><b>${fmt(m.total)}</b></button>`).join('')}
    <button class="btn ghost full" data-action="go" data-to="transactions">All transactions</button>
  </div>`;
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
