// Spending: where the money goes this month. One summary (total, compared with last month, a donut),
// then tabs for categories, day by day, merchants, what changed and the last six months.
import { state } from '../../state.js';
import { esc } from '../dom.js';
import { fmt } from '../../lib/money.js';
import { compareMonths, spendCategoriesOf, summarizeMonth } from '../../lib/analysis.js';
import { catName, catKind } from '../../lib/categories.js';
import { monthKey, addMonths, monthLabel, daysInMonth } from '../../lib/dates.js';
import { donut, trendBars, progressBar, paceChart } from '../charts.js';
import { monthSwitcher, catChip, delta, emptyState } from '../common.js';

export function render() {
  const { derived, month } = state;
  if (!state.txs.length) return emptyState({ title: 'No spending yet', body: 'Import a statement to see where your money goes.' });
  const { budget, months, today } = derived;
  const cmp = compareMonths(state.txs, month);
  const s = cmp.cur;
  const isCurrent = month === monthKey(today);
  const cats = spendCategoriesOf(s);
  const daily = (key) => {
    const arr = new Array(daysInMonth(key)).fill(0);
    for (const t of state.txs) {
      if (monthKey(t.date) !== key || ['income', 'transfer', 'savings'].includes(catKind(t.category))) continue;
      arr[+t.date.slice(8) - 1] -= t.amount;
    }
    return arr;
  };
  const cur = daily(month), prev = daily(addMonths(month, -1));
  const sofar = isCurrent ? +today.slice(8) : cur.length;
  const prevSame = prev.slice(0, sofar).reduce((a, v) => a + Math.max(0, v), 0);
  const trend = months.slice(-6).map((m) => { const x = summarizeMonth(state.txs, m); return { key: m, label: monthLabel(m, { short: true }).split(' ')[0], income: x.income, spend: x.spend, active: m === month }; });
  const movers = cmp.hasPrev ? cmp.rows.filter((r) => Math.abs(r.delta) >= 1000 && !['income', 'transfer', 'savings'].includes(r.category)).slice(0, 6) : [];
  return `
  <h1 class="page-title">Spending</h1>
  ${monthSwitcher(month, months)}
  <div class="card sp-hero keep-open">
    <div class="sp-hero-row">
      <div><span class="label">Spent in ${esc(monthLabel(month, { short: true }))}</span><div class="big">${fmt(s.spend, { whole: true })}</div>
        ${cmp.hasPrev ? `<div class="sub">${delta(isCurrent ? s.spend - prevSame : s.spend - cmp.prev.spend)} ${isCurrent ? 'vs this point last month' : `vs ${esc(monthLabel(addMonths(month, -1), { short: true }))}`}</div>` : ''}</div>
      ${cats.length ? `<div class="sp-donut">${donut(cats.map((c) => ({ key: c.category, value: c.total, color: c.color, label: c.name })), { center: '', sub: '' })}</div>` : ''}
    </div>
  </div>
  <div class="card"><h3>Categories</h3>
    ${cats.length ? cats.map((c) => {
      const line = budget.byCategory[c.category];
      const row = cmp.rows.find((r) => r.category === c.category);
      return `<button class="list-row tap" data-action="dash-cat" data-cat="${c.category}">${catChip(c.category)}
        <div class="grow"><div class="row between"><span>${esc(c.name)}</span><b>${fmt(c.total, { whole: true })}</b></div>
        ${line?.budget ? progressBar(c.total / line.budget) : ''}
        <div class="sub">${line?.budget ? `of ${fmt(line.budget, { whole: true })} budget` : 'no budget'}${row?.average ? ` · usually ${fmt(row.average, { whole: true })}` : ''}</div></div></button>`;
    }).join('') : '<p class="sub">No spending this month.</p>'}
  </div>
  ${cmp.hasPrev ? `<div class="card"><h3>Day by day</h3><div class="pace-wrap tap-chart" data-action="dash-pace" role="button" tabindex="0" aria-label="Spending day by day: tap for the numbers">${paceChart(cur, prev, sofar)}
    <div class="pace-legend"><span><i class="sw cur"></i>${esc(monthLabel(month, { short: true }))}</span><span><i class="sw prev"></i>${esc(monthLabel(addMonths(month, -1), { short: true }))}</span><span class="pace-more">Tap for the numbers ›</span></div></div></div>` : ''}
  <div class="card"><h3>Merchants</h3>
    ${s.merchants.slice(0, 10).map((m) => `<button class="list-row tap" data-action="mer-open" data-m="${esc(m.name)}">${catChip(m.category)}<div class="grow">${esc(m.name)}<div class="sub">${m.count} payment${m.count > 1 ? 's' : ''}</div></div><b>${fmt(m.total, { whole: true })}</b></button>`).join('') || '<p class="sub">Nothing yet.</p>'}
    <a class="btn ghost full" href="#/transactions">All transactions</a></div>
  ${movers.length ? `<div class="card"><h3>Changes</h3><p class="sub">Compared with ${esc(monthLabel(addMonths(month, -1)))}.</p>
    ${movers.map((r) => `<button class="list-row tap" data-action="dash-cat" data-cat="${r.category}">${catChip(r.category)}<div class="grow">${esc(catName(r.category))}<div class="sub">${fmt(r.previous, { whole: true })} → ${fmt(r.current, { whole: true })}</div></div>${delta(r.delta)}</button>`).join('')}</div>` : ''}
  ${trend.length > 1 ? `<div class="card"><h3>Trend</h3>${trendBars(trend)}<div class="legend"><span><i class="sw in"></i>Income</span><span><i class="sw out"></i>Spent</span></div>
    <a class="btn ghost full" href="#/history">Monthly record</a></div>` : ''}`;
}
