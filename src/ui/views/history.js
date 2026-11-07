import { state } from '../../state.js';
import { esc, toast } from '../dom.js';
import { fmt } from '../../lib/money.js';
import { monthlyRecords, categoryTrends, historySummary, recordsToCSV } from '../../lib/history.js';
import { CAT, catName } from '../../lib/categories.js';
import { monthKey, monthLabel } from '../../lib/dates.js';
import { trendBars, sparkline } from '../charts.js';
import { catChip, delta, emptyState } from '../common.js';

function records() {
  const { months, coverage, today } = state.derived;
  const incomplete = new Set(coverage.missing.map((m) => m.month));
  return monthlyRecords(state.txs, months, { incompleteMonths: incomplete, currentMonth: monthKey(today) });
}

export function render() {
  if (!state.txs.length) return emptyState({ title: 'Your monthly record', body: 'Import a few months of statements and every month gets its own record here, with trends across them.' });
  const recs = records();
  const sum = historySummary(recs);
  const trends = categoryTrends(recs);
  const pct = (r) => (r == null ? '–' : `${Math.round(r * 100)}%`);
  return `
  <h1 class="page-title">Monthly record <small>${recs.length} month${recs.length === 1 ? '' : 's'}</small></h1>
  ${sum ? `<div class="card">
    <div class="stat-grid">
      <div><span class="label">Avg income</span><b class="pos">${fmt(sum.avgIncome, { whole: true })}</b></div>
      <div><span class="label">Avg spent</span><b>${fmt(sum.avgSpend, { whole: true })}</b></div>
      <div><span class="label">Avg savings rate</span><b>${pct(sum.avgRate)}</b></div>
      <div><span class="label">Moved to savings</span><b>${fmt(sum.totalSaved, { whole: true })}</b></div>
    </div>
    <p class="sub">Averages use ${sum.months} complete month${sum.months === 1 ? '' : 's'}. Best month: <b>${esc(monthLabel(sum.best.month))}</b> (${fmt(sum.best.income - sum.best.spend, { whole: true, sign: true })}). Highest spend: <b>${esc(monthLabel(sum.worst.month))}</b> (${fmt(sum.worst.spend, { whole: true })}).</p>
  </div>` : ''}
  <div class="card"><h3>Income vs spending</h3>
    <div class="scroll-x">${trendBars(recs.map((r) => ({ label: monthLabel(r.month, { short: true }).replace(' ', "'"), income: r.income, spend: r.spend, active: r.inProgress })), { height: 150 })}</div>
    <div class="legend"><span><i class="sw in"></i>Income</span><span><i class="sw out"></i>Spent</span></div>
  </div>
  <div class="card"><h3>Month by month</h3>
    <div class="month-table">
      <div class="mt-row mt-head"><span>Month</span><span>In</span><span>Spent</span><span>Rate</span></div>
      ${[...recs].reverse().map((r, i, arr) => {
        const prev = arr[i + 1];
        return `<button class="mt-row tap" data-action="history-open" data-month="${r.month}">
          <span><b>${esc(monthLabel(r.month, { short: true }))}</b>${r.inProgress ? '<small class="pill">so far</small>' : r.incomplete ? '<small class="pill warn">missing stmt</small>' : ''}</span>
          <span class="pos">${fmt(r.income, { whole: true })}</span>
          <span>${fmt(r.spend, { whole: true })}${prev && !r.inProgress ? `<br>${delta(r.spend - prev.spend)}` : ''}</span>
          <span class="${r.savingsRate != null && r.savingsRate < 0 ? 'neg' : ''}">${pct(r.savingsRate)}</span></button>`;
      }).join('')}
    </div>
    <p class="sub">Tap a month to open its full breakdown. Rate = share of income not spent.</p>
  </div>
  <div class="card"><h3>Category trends</h3>
    ${trends.map((t) => `<div class="list-row">${catChip(t.category)}
      <div class="grow"><div>${esc(catName(t.category))}</div><div class="sub">avg ${fmt(t.avg, { whole: true })}/mo · last ${fmt(t.last, { whole: true })}</div></div>
      ${sparkline(t.series, { color: CAT[t.category]?.color })}
      <span class="trend-tag ${t.trend > 1000 ? 'bad' : t.trend < -1000 ? 'good' : ''}">${t.trend > 1000 ? '↗ rising' : t.trend < -1000 ? '↘ falling' : '→ steady'}</span></div>`).join('') || '<p class="muted">Needs at least one complete month.</p>'}
  </div>
  <button class="btn ghost full" data-action="history-export">Export monthly record (CSV)</button>`;
}

export const actions = {
  'history-open': (el) => { state.month = el.dataset.month; location.hash = '#/home'; },
  'history-export': async () => {
    const csv = recordsToCSV(records());
    const name = `monthly-record-${state.derived.today}.csv`;
    const file = new File([csv], name, { type: 'text/csv' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Monthly record' }); return; } catch { /* fall back */ }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('Exported');
  },
};
