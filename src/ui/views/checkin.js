// Monthly check-in: the once-a-month routine in four steps.
import { state, saveSettings, recompute } from '../../state.js';
import { db } from '../../lib/db.js';
import { esc, toast } from '../dom.js';
import { fmt } from '../../lib/money.js';
import { CATEGORIES, catName } from '../../lib/categories.js';
import { monthKey, addMonths, monthLabel, prettyDate } from '../../lib/dates.js';
import { compareMonths } from '../../lib/analysis.js';
import { buildInsights } from '../../lib/insights.js';
import { catChip, delta, emptyState } from '../common.js';

export function targetMonth() {
  const prev = addMonths(monthKey(state.derived.today), -1);
  const months = state.derived.months;
  return months.includes(prev) || !months.length ? prev : months[months.length - 1];
}

function toSort(month) {
  return state.txs.filter((t) => monthKey(t.date) === month && t.category === 'other' && !t.userCategory && !t.reviewed);
}

export function checkinStatus(month = targetMonth()) {
  const c = state.settings.checkins?.[month] || {};
  const statementsOk = !state.derived.coverage.missing.some((m) => m.month <= month);
  const sortedOk = toSort(month).length === 0;
  const steps = [statementsOk, sortedOk, !!c.review, !!c.plan];
  return { month, steps, done: steps.filter(Boolean).length, complete: !!c.completedAt, record: c };
}

const GROUPS = [
  ['Spending', CATEGORIES.filter((c) => ['personal', 'essential'].includes(c.kind) && c.id !== 'other')],
  ['Bills', CATEGORIES.filter((c) => c.kind === 'fixed')],
  ['Not spending', CATEGORIES.filter((c) => ['income', 'savings', 'transfer'].includes(c.kind))],
];

export function render() {
  if (!state.txs.length) return emptyState({ title: 'Monthly check-in', body: 'Once a month: import statements, tidy up, review, plan. Import your first statements to start.' });
  const st = checkinStatus();
  const { month, steps } = st;
  const queue = toSort(month);
  const missing = state.derived.coverage.missing.filter((m) => m.month <= month);
  const cmp = compareMonths(state.txs, month);
  const ins = buildInsights({ txs: state.txs, key: month, budget: state.derived.budget, recurring: state.derived.recurring, accounts: state.accounts, today: state.derived.today, incomplete: state.derived.incomplete }).filter((i) => i.level !== 'good').slice(0, 3);
  const b = state.derived.budget;
  const next = addMonths(month, 1);
  const step = (n, title, done, body, open) => `<div class="card step ${done ? 'done' : ''} ${open ? 'open' : ''}">
    <div class="step-head"><span class="step-num">${done ? '✓' : n}</span><h3>${title}</h3></div>${open || !done ? body : ''}</div>`;
  const firstOpen = steps.findIndex((s) => !s);
  const tx = queue[0];

  return `
  <h1 class="page-title">${esc(monthLabel(month))} check-in <small>${st.done}/4</small></h1>
  <div class="steps-bar">${steps.map((s) => `<span class="${s ? 'on' : ''}"></span>`).join('')}</div>
  ${st.complete ? `<div class="card verdict yes"><div class="verdict-head"><span class="verdict-icon">✓</span><div><div class="verdict-word">All done</div><div>Checked in ${prettyDate(st.record.completedAt)}. See you next month.</div></div></div></div>` : ''}

  ${step(1, 'Import every statement', steps[0], missing.length
    ? `<p class="muted">Still missing:</p>${missing.map((m) => `<div class="list-row"><span class="bank-badge warn">!</span><div class="grow"><b>${esc(m.accountName)}</b> · ${esc(monthLabel(m.month))}</div></div>`).join('')}
       <div class="row gap"><button class="btn primary grow" data-action="import">Import statements</button><a class="btn ghost grow" href="#/accounts">Mark as not needed</a></div>`
    : '<p class="good-note">Every account is in ✓</p>', firstOpen === 0)}

  ${step(2, 'Sort uncategorised transactions', steps[1], tx ? `
    <p class="muted">${queue.length} left in "Other". Your choice applies to every payment from the same place.</p>
    <div class="sorter">
      <div class="sorter-amt ${tx.amount > 0 ? 'pos' : ''}">${fmt(tx.amount, { sign: true })}</div>
      <div class="sorter-desc">${esc(tx.description)}</div>
      <div class="sub">${prettyDate(tx.date)} · ${esc(state.accounts.find((a) => a.id === tx.accountId)?.name || '')}</div>
    </div>
    ${GROUPS.map(([g, cats]) => `<h4>${g}</h4><div class="chip-grid">${cats.map((c) => `<button class="chip" data-action="ci-sort" data-id="${esc(tx.id)}" data-cat="${c.id}">${c.icon} ${esc(c.name)}</button>`).join('')}</div>`).join('')}
    <div class="row gap"><button class="btn ghost grow" data-action="ci-skip" data-id="${esc(tx.id)}">Leave as Other</button></div>`
    : '<p class="good-note">Nothing uncategorised ✓</p>', firstOpen === 1)}

  ${step(3, 'Review the month', steps[2], `
    <div class="stat-grid">
      <div><span class="label">In</span><b class="pos">${fmt(cmp.cur.income, { whole: true })}</b></div>
      <div><span class="label">Spent</span><b>${fmt(cmp.cur.spend, { whole: true })}</b>${cmp.hasPrev ? delta(cmp.cur.spend - cmp.prev.spend) : ''}</div>
      <div><span class="label">Saved</span><b>${fmt(cmp.cur.saved, { whole: true })}</b></div>
      <div><span class="label">Left over</span><b class="${cmp.cur.net < 0 ? 'neg' : 'pos'}">${fmt(cmp.cur.net, { whole: true, sign: true })}</b></div>
    </div>
    ${cmp.rows.filter((r) => Math.abs(r.delta) >= 2000 && !['income', 'transfer', 'savings', 'excluded'].includes(r.category)).slice(0, 3).map((r) => `<div class="list-row">${catChip(r.category)}<div class="grow">${esc(catName(r.category))}<div class="sub">${fmt(r.previous, { whole: true })} → ${fmt(r.current, { whole: true })}</div></div>${delta(r.delta)}</div>`).join('')}
    ${ins.map((i) => `<div class="insight lvl-${i.level} mini"><b>${esc(i.title)}</b><div class="sub">${esc(i.detail)}</div></div>`).join('')}
    <div class="row gap"><a class="btn ghost grow" href="#/insights" data-action="ci-goto-insights" data-month="${month}">Full insights</a><button class="btn primary grow" data-action="ci-mark" data-step="review">Reviewed ✓</button></div>`, firstOpen === 2)}

  ${step(4, `Plan ${esc(monthLabel(next))}`, steps[3], `
    <div class="list-row"><div class="grow">Income</div><b>${fmt(b.income, { whole: true })}</b></div>
    <div class="list-row"><div class="grow">Bills &amp; essentials</div><b>${fmt(b.committed, { whole: true })}</b></div>
    <div class="list-row"><div class="grow">Savings goal</div><b class="pos">${fmt(b.savingsTarget, { whole: true })}</b></div>
    <div class="list-row total"><div class="grow">Fun money for ${esc(monthLabel(next, { short: true }))}</div><b>${fmt(b.personalAllowance, { whole: true })}</b></div>
    ${state.settings.wishlist.length ? `<p class="sub">${state.settings.wishlist.length} item${state.settings.wishlist.length > 1 ? 's' : ''} on your wishlist. Check them in Afford.</p>` : ''}
    <div class="row gap"><a class="btn ghost grow" href="#/budget">Adjust budget</a><button class="btn primary grow" data-action="ci-mark" data-step="plan">Plan set ✓</button></div>`, firstOpen === 3)}

  ${!st.complete && st.done === 4 ? '<button class="btn primary full" data-action="ci-complete">Finish check-in</button>' : ''}`;
}

async function markCheckin(patch) {
  const month = targetMonth();
  const checkins = { ...state.settings.checkins, [month]: { ...(state.settings.checkins?.[month] || {}), ...patch } };
  await saveSettings({ checkins });
}

export const actions = {
  'ci-sort': async (el, rerender) => {
    const t = state.txs.find((x) => x.id === el.dataset.id);
    const cat = el.dataset.cat;
    const targets = state.txs.filter((x) => x.merchant === t.merchant && Math.sign(x.amount) === Math.sign(t.amount));
    for (const x of targets) { x.category = cat; x.userCategory = true; }
    await db.putMany('tx', targets);
    await saveSettings({ userRules: { ...state.settings.userRules, [t.merchant]: cat } });
    recompute(); rerender();
    if (targets.length > 1) toast(`${targets.length} payments from ${t.merchant} → ${catName(cat)}`);
  },
  'ci-skip': async (el, rerender) => {
    const t = state.txs.find((x) => x.id === el.dataset.id);
    t.reviewed = true;
    await db.put('tx', t);
    rerender();
  },
  'ci-mark': async (el, rerender) => { await markCheckin({ [el.dataset.step]: true }); rerender(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
  'ci-complete': async (_, rerender) => { await markCheckin({ completedAt: state.derived.today }); rerender(); toast('Check-in complete 🎉'); },
  'ci-goto-insights': (el) => { state.month = el.dataset.month; location.hash = '#/insights'; },
};
