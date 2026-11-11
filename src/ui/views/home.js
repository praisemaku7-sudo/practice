import { state, accountName } from '../../state.js';
import { esc, openSheet } from '../dom.js';
import { fmt } from '../../lib/money.js';
import { compareMonths, spendCategoriesOf, summarizeMonth } from '../../lib/analysis.js';
import { budgetProgress } from '../../lib/budget.js';
import { catName, catKind } from '../../lib/categories.js';
import { monthKey, monthLabel, prettyDate } from '../../lib/dates.js';
import { monthSwitcher, emptyState } from '../common.js';
import { cockpit } from '../cockpit.js';
import { buildAlerts } from '../alerts.js';
import { safeToSpend } from '../overview-extras.js';


export function render() {
  const { derived, month } = state;
  if (!state.txs.length) {
    return emptyState({ title: 'Start with a statement', body: 'Import the PDF or CSV statements from each bank app. Everything stays on this phone.' });
  }
  const { months, today } = derived;
  const cmp = compareMonths(state.txs, month);
  const s = cmp.cur;
  const isCurrent = month === monthKey(today);
  const cats = spendCategoriesOf(s);
  const urgent = buildAlerts().filter((x) => x.tone === 'bad').slice(0, 1);
  const safe = isCurrent ? safeToSpend() : null;
  const sumAcc = (f) => state.accounts.filter(f).reduce((x, a) => x + (a.balance || 0), 0);
  const net = sumAcc((a) => a.type !== 'credit' && a.type !== 'investment') + sumAcc((a) => a.type === 'credit');
  const gs = (state.settings.goals || []).filter((g) => !g.owner || g.owner === 'all' || state.settings.scope === 'all' || g.owner === state.settings.scope);
  const go = (href, ic, title, sub) => `<a class="go-row" href="${href}"><span class="go-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ic}</svg></span><span class="go-txt"><b>${title}</b><small>${sub}</small></span><span class="go-chev" aria-hidden="true">›</span></a>`;
  return `
  ${monthSwitcher(month, months)}
  ${urgent.map((x) => `<button class="urgent" data-action="alert-open" data-id="${x.id}"><b>${esc(x.title)}</b><span>${esc(String(x.detail || '').split('. ')[0].slice(0, 90))} ›</span></button>`).join('')}
  ${cockpit()}
  <nav class="go-list" aria-label="Go to">
    ${go('#/spending', '<path d="M6 7h12l-1 13H7L6 7z"/><path d="M9 7a3 3 0 0 1 6 0"/>', 'Spending', `${fmt(s.spend, { whole: true })} in ${esc(monthLabel(month, { short: true }))}${cats[0] ? ` · most on ${esc(cats[0].name.toLowerCase())}` : ''}`)}
    ${go('#/bills', '<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>', 'Bills', safe ? `${fmt(safe.bills, { whole: true })} still to pay before payday` : 'Calendar, subscriptions and cancel list')}
    ${go('#/track', '<path d="M3 11 12 4l9 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/>', 'The move', 'Can we afford the mortgage?')}
    ${go('#/accounts', '<path d="M3 10 12 4l9 6"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>', 'Accounts', `${fmt(net, { whole: true })} overall, after cards`)}
    ${gs.length ? go('#/goals', '<path d="M5 12a7 6 0 0 1 13-3l2-1v4l-1 .5A7 6 0 0 1 12 18H9l-1 2H6l.5-2.6A6 6 0 0 1 5 12z"/><circle cx="15" cy="11" r=".6"/>', 'Goals', `${gs.length} goal${gs.length > 1 ? 's' : ''}`) : ''}
    ${go('#/numbers', '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', 'Your numbers', 'Every figure, month by month')}
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
