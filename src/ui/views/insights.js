import { state } from '../../state.js';
import { db } from '../../lib/db.js';
import { esc, toast } from '../dom.js';
import { fmt } from '../../lib/money.js';
import { buildInsights } from '../../lib/insights.js';
import { compareMonths } from '../../lib/analysis.js';
import { catName } from '../../lib/categories.js';
import { monthLabel } from '../../lib/dates.js';
const aiMonthlyReport = async (...a) => (await import('../../lib/ai.js')).aiMonthlyReport(...a);
import { monthSwitcher, emptyState, hideable } from '../common.js';

const reports = {}; // month -> report (cache of kv)
let loadingReport = false;

export async function preload() {
  const key = 'report:' + state.month;
  if (!(state.month in reports)) reports[state.month] = await db.kvGet(key, null);
}

export function render() {
  if (!state.txs.length) return emptyState({ title: 'Suggestions appear here', body: 'Each month I compare your spending with your usual, check your budget, and look for subscriptions, fees and price rises.' });
  const { budget, recurring, months } = state.derived;
  const list = buildInsights({ txs: state.txs, key: state.month, budget, recurring, accounts: state.accounts });
  const potential = list.reduce((a, i) => a + (i.saving > 0 && i.level !== 'good' ? i.saving : 0), 0);
  const report = reports[state.month];
  return `
  ${monthSwitcher(state.month, months)}
  <a class="card setup-cta" href="#/categories"><div><b>📊 Categories</b><div class="sub">${(() => { const n = state.txs.filter((t) => t.category === 'other').length; return n ? `${n} payment${n === 1 ? '' : 's'} in Other to sort out · breakdown, top merchants, check with Claude` : 'Breakdown by category, top merchants, check categories with Claude'; })()}</div></div><span class="banner-go">›</span></a>
  ${hideable('missing-ins:' + state.month, state.derived.coverage.missing.filter((m) => m.month === state.month).length, state.derived.coverage.missing.some((m) => m.month === state.month) ? `<div class="card banner"><b>This month is missing a statement</b><span class="sub">Suggestions may be off until it's imported. See Accounts → Statements.</span></div>` : '')}
  ${potential > 0 ? `<div class="card hero"><div class="label">You could free up roughly</div><div class="big">${fmt(potential, { whole: true })}<small>/month</small></div><div class="sub">Rough total of the suggestions below. Some overlap.</div></div>` : ''}
  <div class="card ai-card">
    <div class="row between"><h3>Monthly review by Claude</h3>${report ? `<button class="link" data-action="ai-report">Refresh</button>` : ''}</div>
    ${report ? renderReport(report) : `<p class="muted">A written review of ${esc(monthLabel(state.month))}: what changed, what to fix, and a plan for next month. Only totals are sent, never your raw transactions.</p>
      <button class="btn primary full" data-action="ai-report" ${loadingReport ? 'disabled' : ''}>${loadingReport ? 'Writing your review…' : state.settings.apiKey ? 'Write my monthly review' : 'Add API key in Settings first'}</button>`}
  </div>
  ${list.map((i) => `<div class="card insight lvl-${i.level}">
    <div class="insight-title">${esc(i.title)}</div>
    <div class="sub">${esc(i.detail)}</div>
    ${i.saving > 0 && i.level !== 'good' ? `<div class="pill save">Could save ~${fmt(i.saving, { whole: true })}/mo</div>` : ''}
  </div>`).join('') || '<p class="muted center">Nothing to flag this month. 👏</p>'}`;
}

function renderReport(r) {
  const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  const sec = (title, items) => (list(items).length ? `<h4>${title}</h4><ul>${list(items).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
  return `<p class="report-headline">${esc(r.headline)}</p>
    ${sec('What changed', r.what_changed)}${sec('Wins', r.wins)}${sec('Concerns', r.concerns)}
    ${list(r.actions).length ? `<h4>Do this next month</h4><ol class="actions">${list(r.actions).map((a) => `<li><b>${esc(a.title)}</b>${a.monthly_saving_gbp > 0 ? ` <span class="pill save">~£${Math.round(a.monthly_saving_gbp)}/mo</span>` : ''}<div class="sub">${esc(a.detail)}</div></li>`).join('')}</ol>` : ''}
    ${r.next_month_focus ? `<div class="focus">🎯 ${esc(r.next_month_focus)}</div>` : ''}`;
}

function summaryForAI(month) {
  const { budget, recurring } = state.derived;
  const cmp = compareMonths(state.txs, month);
  const p = (v) => Math.round(v) / 100;
  return {
    month: monthLabel(month),
    income: p(cmp.cur.income),
    spent: p(cmp.cur.spend),
    moved_to_savings: p(cmp.cur.saved),
    savings_goal: p(budget.savingsTarget),
    categories: cmp.rows.filter((r) => r.current || r.average).map((r) => ({
      category: catName(r.category), this_month: p(r.current), last_month: p(r.previous), three_month_avg: p(r.average),
      budget: budget.byCategory[r.category] ? p(budget.byCategory[r.category].budget) : null,
    })),
    top_merchants: cmp.cur.merchants.slice(0, 12).map((m) => ({ name: m.name, total: p(m.total), payments: m.count, category: catName(m.category) })),
    new_merchants: cmp.newMerchants.map((m) => ({ name: m.name, total: p(m.total) })),
    recurring_payments: recurring.filter((r) => r.direction === 'out' && r.active).map((r) => ({ name: r.name, monthly: p(r.amount), type: r.type, category: catName(r.category), price_change: r.priceChange ? p(r.priceChange) : 0 })),
    number_of_accounts: state.accounts.length,
  };
}

export const actions = {
  'ai-report': async (_, rerender) => {
    if (!state.settings.apiKey) { location.hash = '#/settings'; return; }
    const month = state.month;
    loadingReport = true; reports[month] = null; rerender();
    try {
      const r = await aiMonthlyReport({ apiKey: state.settings.apiKey, model: state.settings.model, summary: summaryForAI(month) });
      reports[month] = r;
      await db.kvSet('report:' + month, r);
    } catch (e) { toast(e.message, { error: true }); }
    loadingReport = false;
    rerender();
  },
};
