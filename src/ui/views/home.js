import { state } from '../../state.js';
import { esc } from '../dom.js';
import { fmt } from '../../lib/money.js';
import { compareMonths, spendCategoriesOf, summarizeMonth } from '../../lib/analysis.js';
import { budgetProgress } from '../../lib/budget.js';
import { catName } from '../../lib/categories.js';
import { monthKey, addMonths, monthLabel, prettyDate, nextDayOfMonth, daysBetween } from '../../lib/dates.js';
import { donut, trendBars, progressBar } from '../charts.js';
import { monthSwitcher, catChip, delta, emptyState } from '../common.js';
import { checkinStatus } from './checkin.js';

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
      <div class="label">Fun money left this month</div>
      <div class="big">${fmt(left)}</div>
      ${progressBar(budget.personalAllowance ? prog.personalSpent / budget.personalAllowance : 1)}
      <div class="sub">${fmt(prog.personalSpent, { whole: true })} of ${fmt(budget.personalAllowance, { whole: true })} used · ${left > 0 ? `about ${fmt(perDay, { whole: true })}/day for ${daysLeft} days` : 'over for this month'}</div>
      <button class="btn primary small" data-action="go" data-to="afford">Can I afford…?</button>
    </div>`;
  })() : '';

  const nextPay = payday ? nextDayOfMonth(today, payday) : null;
  const upcoming = recurring.filter((r) => r.direction === 'out' && r.active && (!nextPay || r.nextDue < nextPay)).sort((a, b) => a.nextDue.localeCompare(b.nextDue));
  const upcomingTotal = upcoming.reduce((a, r) => a + r.amount, 0);

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
  ${ciCard}
  ${offBanner}
  ${dupBanner}
  ${banner}
  <div class="card hero">
    <div class="hero-row">
      <div><div class="label">Spent</div><div class="big">${fmt(s.spend, { whole: true })}</div>
        ${cmp.hasPrev ? `<div class="sub">${delta(s.spend - cmp.prev.spend)} vs ${esc(monthLabel(addMonths(month, -1), { short: true }))}</div>` : ''}</div>
      <div class="hero-side">
        <div><span class="label">In</span> <b class="pos">${fmt(s.income, { whole: true })}</b></div>
        <div><span class="label">Saved</span> <b>${fmt(s.saved, { whole: true })}</b></div>
        <div><span class="label">Left over</span> <b class="${s.net < 0 ? 'neg' : 'pos'}">${fmt(s.net, { whole: true, sign: true })}</b></div>
      </div>
    </div>
    ${totalBudget ? `${progressBar(s.spend / totalBudget)}<div class="sub">${fmt(s.spend, { whole: true })} of ${fmt(totalBudget, { whole: true })} monthly budget</div>` : ''}
    <a class="link small-link" href="#/audit">What's counted here? ›</a>
  </div>
  ${funCard}
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

