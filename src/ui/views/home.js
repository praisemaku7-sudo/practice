import { state, accountName } from '../../state.js';
import { esc, openSheet } from '../dom.js';
import { fmt } from '../../lib/money.js';
import { compareMonths, spendCategoriesOf, summarizeMonth } from '../../lib/analysis.js';
import { budgetProgress } from '../../lib/budget.js';
import { catName, catKind } from '../../lib/categories.js';
import { monthKey, addMonths, monthLabel, prettyDate, nextDayOfMonth, daysBetween, daysInMonth as daysInMonthOf } from '../../lib/dates.js';
import { donut, trendBars, progressBar, paceChart } from '../charts.js';
import { monthSwitcher, catChip, delta, emptyState, hideable } from '../common.js';
import { checkinStatus } from './checkin.js';
import { goalPlan } from '../../lib/goals.js';

export function render() {
  const { derived, month } = state;
  if (!state.txs.length) {
    return emptyState({ title: 'Start with a statement', body: 'Import the PDF or CSV statements from each bank app. Everything stays on this phone.' });
  }
  const { budget, recurring, payday, balance, months, today } = derived;
  const cmp = compareMonths(state.txs, month);
  const s = cmp.cur;
  const isCurrent = month === monthKey(today);
  const prog = budgetProgress(state.txs, budget, month);
  const cats = spendCategoriesOf(s);
  const totalBudget = budget.lines.reduce((a, l) => a + l.budget, 0);

  const funCard = isCurrent ? (() => {
    const left = prog.personalLeft;
    const daysLeft = daysBetween(today, `${addMonths(month, 1)}-01`);
    const perDay = left > 0 ? Math.floor(left / Math.max(daysLeft, 1)) : 0;
    return `<div class="card fun ${left < 0 ? 'neg' : ''}">
      <button class="explain" data-action="explain" data-what="fun"><div class="label">Fun money left this month ⓘ</div>
      <div class="big">${fmt(left)}</div></button>
      ${progressBar(budget.personalAllowance ? prog.personalSpent / budget.personalAllowance : 1)}
      <div class="sub">${fmt(prog.personalSpent, { whole: true })} of ${fmt(budget.personalAllowance, { whole: true })} used · ${left > 0 ? `about ${fmt(perDay, { whole: true })}/day for ${daysLeft} days` : 'over for this month'}</div>
      <button class="btn primary small" data-action="go" data-to="afford">Can I afford…?</button>
    </div>`;
  })() : '';

  const nextPay = payday ? nextDayOfMonth(today, payday) : null;
  const upcoming = recurring.filter((r) => r.direction === 'out' && r.active && (!nextPay || r.nextDue < nextPay)).sort((a, b) => a.nextDue.localeCompare(b.nextDue));
  const upcomingTotal = upcoming.reduce((a, r) => a + r.amount, 0);

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
    return { label: monthLabel(m, { short: true }).split(' ')[0], income: x.income, spend: x.spend, active: m === month };
  });

  const movers = cmp.hasPrev ? cmp.rows.filter((r) => Math.abs(r.delta) >= 1000 && !['income', 'transfer', 'savings'].includes(r.category)).slice(0, 4) : [];

  const missing = derived.coverage.missing;
  const looksOff = (budget.income > 0 && s.income > budget.income * 1.8) || (budget.avgSpend > 0 && s.spend > budget.avgSpend * 1.8) || (s.spend > 0 && s.income > 0 && s.spend > s.income * 1.5);
  const offBanner = looksOff ? `<a class="card banner bad" href="#/audit"><b>These totals look too high</b><span class="sub">Usually money moving between your own accounts counted as spending and income, or one account imported twice. Tap to see what's counted and fix it.</span><span class="banner-go">Check ›</span></a>` : '';
  const dupBanner = derived.duplicates.length ? `<a class="card banner" href="#/accounts"><b>${derived.duplicates.length} duplicate transaction${derived.duplicates.length > 1 ? 's' : ''}</b><span class="sub">Imported twice. Totals are inflated until removed.</span><span class="banner-go">Fix ›</span></a>` : '';
  const monthMissing = missing.filter((m) => m.month === month);
  const banner = missing.length ? `<a class="card banner" href="#/accounts">
      <b>${missing.length} statement${missing.length > 1 ? 's' : ''} missing</b>
      <span class="sub">${monthMissing.length ? `${esc(monthLabel(month))} is incomplete: no statement from ${monthMissing.map((m) => esc(m.accountName)).join(', ')}. Totals will be too low.` : missing.slice(0, 3).map((m) => `${esc(m.accountName)} ${esc(monthLabel(m.month, { short: true }))}`).join(' · ')}</span>
      <span class="banner-go">Review ›</span></a>` : '';

  const ci = checkinStatus();
  const ciCard = !ci.complete && months.includes(ci.month) ? `<a class="card checkin-card" href="#/checkin">
      <div><b>${esc(monthLabel(ci.month))} check-in</b><div class="sub">${ci.done}/4 done · import, tidy up, review, plan</div></div>
      <div class="steps-bar mini">${ci.steps.map((x) => `<span class="${x ? 'on' : ''}"></span>`).join('')}</div><span class="banner-go">›</span></a>` : '';

  return `
  ${monthSwitcher(month, months)}
  ${hideable('checkin:' + ci.month, ci.done, ciCard)}
  ${hideable('off:' + month, Math.round(s.spend / 10000) + '|' + Math.round(s.income / 10000), offBanner)}
  ${hideable('dups', derived.duplicates.length, dupBanner)}
  ${hideable('missing', missing.map((m) => m.accountId + m.month).join(','), banner)}
  <div class="card hero feature">
    <div class="hero-row">
      <div><button class="explain" data-action="explain" data-what="spent"><div class="label">Spent ⓘ</div><div class="big">${fmt(s.spend, { whole: true })}</div></button>
        ${cmp.hasPrev ? (isCurrent
          ? `<div class="sub">${delta(paceDelta)} vs this point in ${esc(monthLabel(addMonths(month, -1), { short: true }))}</div>`
          : `<div class="sub">${delta(s.spend - cmp.prev.spend)} vs ${esc(monthLabel(addMonths(month, -1), { short: true }))}</div>`) : ''}</div>
      <div class="hero-side">
        <button class="explain" data-action="explain" data-what="in"><span class="label">In ⓘ</span> <b class="pos">${fmt(s.income, { whole: true })}</b></button>
        <button class="explain" data-action="explain" data-what="saved"><span class="label">Saved ⓘ</span> <b>${fmt(s.saved, { whole: true })}</b></button>
        <button class="explain" data-action="explain" data-what="left"><span class="label">Left over ⓘ</span> <b class="${s.net < 0 ? 'neg' : 'pos'}">${fmt(s.net, { whole: true, sign: true })}</b></button>
      </div>
    </div>
    ${totalBudget ? `${progressBar(s.spend / totalBudget)}<div class="sub">${fmt(s.spend, { whole: true })} of ${fmt(totalBudget, { whole: true })} monthly budget</div>` : ''}
    ${cmp.hasPrev ? `<div class="pace-wrap">${paceChart(curDaily, prevDaily, daysSoFar)}
      <div class="pace-legend"><span><i class="sw cur"></i>${esc(monthLabel(month, { short: true }))}</span><span><i class="sw prev"></i>${esc(monthLabel(addMonths(month, -1), { short: true }))}</span>
      <b class="${paceDelta > 0 ? 'neg' : 'pos'}">${paceDelta > 0 ? '▲' : '▼'} ${fmt(Math.abs(paceDelta), { whole: true })} vs same point last month</b></div></div>` : ''}
    <a class="link small-link" href="#/audit">What's counted here? ›</a>
  </div>
  ${funCard}
  ${(() => {
    const gs = (state.settings.goals || []).filter((g) => !g.owner || g.owner === 'all' || state.settings.scope === 'all' || g.owner === state.settings.scope);
    if (!gs.length) return '';
    const byId = Object.fromEntries((state.allAccounts || state.accounts).map((a) => [a.id, a]));
    return `<a class="card goals-mini" href="#/goals"><div class="label">🎯 Goals</div>${gs.slice(0, 3).map((g) => { const p = goalPlan(g, today, byId); return `<div class="goal-line"><span class="ellipsis">${esc(g.icon || '🎯')} ${esc(g.name)}</span><span class="sub">${Math.round(p.progress * 100)}%</span></div>${progressBar(p.progress, { warnAt: 2 })}`; }).join('')}</a>`;
  })()}
  ${derived.cards.cards.length || derived.suspects.length ? (() => {
    const c = derived.cards;
    return `<a class="card cards-card ${c.monthSpend > 0 ? 'bad' : ''}" href="#/cards">
      <div class="grow"><div class="label">💳 Credit cards · goal £0</div>
      <div><b class="${c.totalOwed > 0 ? 'neg' : 'pos'}">${fmt(c.totalOwed, { whole: true })} owed</b> · <span class="${c.monthSpend > 0 ? 'neg' : 'pos'}">${fmt(c.monthSpend, { whole: true })} new spending this month</span></div>
      ${derived.suspects.length ? `<div class="sub warn-text">${derived.suspects.length} account${derived.suspects.length > 1 ? 's' : ''} may be a credit card. Tap to confirm.</div>` : ''}</div><span class="banner-go">›</span></a>`;
  })() : ''}
  ${movers.length ? `<div class="card"><h3>What changed vs last month</h3>
    ${movers.map((r) => `<div class="list-row">${catChip(r.category)}<div class="grow">${esc(catName(r.category))}<div class="sub">${fmt(r.previous, { whole: true })} → ${fmt(r.current, { whole: true })}</div></div>${delta(r.delta)}</div>`).join('')}
  </div>` : ''}
  <div class="card">
    <h3>Where it went</h3>
    ${cats.length ? `<div class="donut-wrap">${donut(cats.map((c) => ({ value: c.total, color: c.color, label: c.name })), { center: fmt(s.spend, { whole: true }), sub: 'spent' })}</div>
    ${cats.map((c) => {
      const line = budget.byCategory[c.category];
      const row = cmp.rows.find((r) => r.category === c.category);
      return `<button class="list-row tap" data-action="go" data-to="transactions" data-cat="${c.category}">${catChip(c.category)}
        <div class="grow"><div class="row between"><span>${esc(c.name)}</span><b>${fmt(c.total)}</b></div>
        ${line?.budget ? progressBar(c.total / line.budget) : ''}
        <div class="sub row between"><span>${line?.budget ? `${fmt(line.budget, { whole: true })} budget` : 'no budget'}</span>${cmp.hasPrev && row ? delta(row.delta) : ''}</div></div></button>`;
    }).join('')}` : '<p class="muted">No spending this month.</p>'}
  </div>
  ${isCurrent && upcoming.length ? `<div class="card"><h3>Due before ${nextPay ? 'payday · ' + prettyDate(nextPay) : 'month end'}</h3>
    ${upcoming.slice(0, 8).map((r) => `<div class="list-row">${catChip(r.category)}<div class="grow">${esc(r.name)}<div class="sub">${esc(r.type)} · ${prettyDate(r.nextDue)}</div></div><b>${fmt(r.amount)}</b></div>`).join('')}
    <div class="list-row total"><span class="grow">Total</span><b>${fmt(upcomingTotal)}</b></div>
    ${balance != null ? `<p class="sub">Current-account balance ${fmt(balance)} → ${fmt(balance - upcomingTotal)} after these.</p>` : ''}
    <a class="btn ghost full" href="#/bills">Bills calendar &amp; subscriptions</a>
  </div>` : ''}
  ${trendData.length > 1 ? `<div class="card"><h3>Last ${trendData.length} months</h3>${trendBars(trendData)}
    <div class="legend"><span><i class="sw in"></i>Income</span><span><i class="sw out"></i>Spent</span></div>
    <a class="btn ghost full" href="#/history">Monthly record &amp; trends</a></div>` : ''}
  <div class="card"><h3>Top merchants</h3>
    ${s.merchants.slice(0, 6).map((m) => `<div class="list-row">${catChip(m.category)}<div class="grow">${esc(m.name)}<div class="sub">${m.count} payment${m.count > 1 ? 's' : ''}</div></div><b>${fmt(m.total)}</b></div>`).join('')}
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
