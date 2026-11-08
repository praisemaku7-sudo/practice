import { state, saveSettings } from '../../state.js';
import { esc, openSheet, closeSheet, toast } from '../dom.js';
import { fmt, parsePrice } from '../../lib/money.js';
import { budgetProgress } from '../../lib/budget.js';
import { catName, CAT } from '../../lib/categories.js';
import { monthKey, monthLabel } from '../../lib/dates.js';
import { progressBar } from '../charts.js';
import { catChip, emptyState } from '../common.js';

function incomeSource() {
  const s = state.settings;
  const slips = s.payslips || {};
  if (s.scope !== 'all') return slips[s.scope] ? `<small class="pill ok">from payslip</small>` : '';
  return s.people.some((p) => slips[p.id]) ? `<small class="pill ok">from payslips</small>` : '';
}

const KIND_LABEL = { fixed: 'Bills & commitments', essential: 'Essentials', personal: 'Fun money (you choose)' };

export function render() {
  if (!state.txs.length) return emptyState({ title: 'No budget yet', body: 'Your budget is built from your last 3 months of statements.' });
  const { budget, payday, detectedPayday, today } = state.derived;
  const key = monthKey(today);
  const prog = budgetProgress(state.txs, budget, key);
  const seg = (v, cls) => (budget.income > 0 ? `<span class="${cls}" style="width:${Math.max(0, (v / budget.income) * 100).toFixed(1)}%"></span>` : '');
  const fixed = prog.rows.filter((r) => r.kind === 'fixed').reduce((a, r) => a + r.budget, 0);
  const ess = prog.rows.filter((r) => r.kind === 'essential').reduce((a, r) => a + r.budget, 0);
  const groups = ['fixed', 'essential', 'personal'].map((kind) => {
    const rows = prog.rows.filter((r) => r.kind === kind).sort((a, b) => b.budget - a.budget);
    if (!rows.length) return '';
    return `<div class="card"><h3>${KIND_LABEL[kind]}</h3>
      ${rows.map((r) => `<button class="list-row tap" data-action="edit-budget" data-cat="${r.category}">${catChip(r.category)}
        <div class="grow"><div class="row between"><span>${esc(catName(r.category))}${r.overridden ? ' <small class="pill">custom</small>' : ''}</span>
        <span><b>${fmt(r.spent, { whole: true })}</b> <span class="muted">/ ${fmt(r.budget, { whole: true })}</span></span></div>
        ${progressBar(r.pct)}
        <div class="sub row between"><span>usually ${fmt(r.hist, { whole: true })}</span><span class="${r.left < 0 ? 'neg' : ''}">${r.left < 0 ? fmt(-r.left, { whole: true }) + ' over' : fmt(r.left, { whole: true }) + ' left'}</span></div></div></button>`).join('')}
    </div>`;
  }).join('');

  return `
  <h1 class="page-title">Budget <small>${esc(monthLabel(key))}</small></h1>
  <div class="card">
    <div class="row between"><span class="label">Monthly income</span>
      <button class="link" data-action="edit-income">${fmt(budget.income, { whole: true })} ${budget.incomeIsEstimate ? '<small class="pill">estimated</small>' : incomeSource()} ✎</button></div>
    <div class="row between"><span class="label">Savings goal</span>
      <button class="link" data-action="edit-savings">${fmt(budget.savingsTarget, { whole: true })} <small class="muted">(${budget.income ? Math.round((budget.savingsTarget / budget.income) * 100) : 0}%)</small> ✎</button></div>
    <div class="row between"><span class="label">Savings goals</span>
      <a class="link" href="#/goals">${budget.goalsMonthly ? fmt(budget.goalsMonthly, { whole: true }) + '/mo' : 'Add a goal'} ›</a></div>
    <div class="row between"><span class="label">Credit card payoff</span>
      <a class="link" href="#/cards">${budget.cardPayoff ? fmt(budget.cardPayoff, { whole: true }) + '/mo' : 'Set up'} ›</a></div>
    <div class="row between"><span class="label">Payday</span>
      <button class="link" data-action="edit-payday">${payday ? `${payday}${['th', 'st', 'nd', 'rd'][payday % 10 > 3 || [11, 12, 13].includes(payday) ? 0 : payday % 10]} of the month` : 'Not set'} ${state.eff.payday == null && detectedPayday ? '<small class="pill">detected</small>' : ''} ✎</button></div>
    <div class="stack-bar">${seg(fixed, 'fixed')}${seg(ess, 'essential')}${seg(budget.personalAllowance, 'personal')}${seg(budget.savingsTarget, 'savings')}${seg(budget.cardPayoff || 0, 'payoff')}</div>
    <div class="legend wrap">
      <span><i class="sw fixed"></i>Bills ${fmt(fixed, { whole: true })}</span>
      <span><i class="sw essential"></i>Essentials ${fmt(ess, { whole: true })}</span>
      <span><i class="sw personal"></i>Fun ${fmt(budget.personalAllowance, { whole: true })}</span>
      <span><i class="sw savings"></i>Savings ${fmt(budget.savingsTarget, { whole: true })}</span>
      ${budget.cardPayoff ? `<span><i class="sw payoff"></i>Card payoff ${fmt(budget.cardPayoff, { whole: true })}</span>` : ''}
    </div>
    ${budget.shortfall > 0 ? `<div class="alert">Your bills and essentials plus your savings goal come to ${fmt(budget.shortfall, { whole: true })} more than your income. Fun money is £0 until something changes: lower the savings goal, or cut a bill (see Insights).</div>` : ''}
    ${budget.unallocated > 2000 ? `<p class="sub">${fmt(budget.unallocated, { whole: true })}/month isn't allocated. Leave it unspent and it adds to your savings.</p>` : ''}
    <p class="sub">Built from ${budget.months.length ? budget.months.map((m) => monthLabel(m, { short: true })).join(', ') : 'this month only'}. Fun money is what's left after bills, essentials and savings, split the way you usually spend it.</p>
  </div>
  ${groups}
  ${Object.keys(state.eff.budgets || {}).length ? '<button class="btn ghost full" data-action="reset-budgets">Reset all custom budgets</button>' : ''}`;
}

function moneySheet({ title, help, value, allowClear = true, onSave }) {
  openSheet(`<h2>${esc(title)}</h2>${help ? `<p class="muted">${esc(help)}</p>` : ''}
    <label class="field"><span>£</span><input id="ms-in" inputmode="decimal" autocomplete="off" value="${value != null ? (value / 100).toFixed(0) : ''}" placeholder="Amount"></label>
    <div class="row gap">${allowClear ? '<button class="btn ghost grow" id="ms-clear">Use automatic</button>' : ''}<button class="btn primary grow" id="ms-save">Save</button></div>`, {
    onMount(p) {
      const input = p.querySelector('#ms-in');
      setTimeout(() => input.focus(), 50);
      p.querySelector('#ms-save').onclick = async () => {
        const v = parsePrice(input.value);
        if (v == null) return toast('Enter an amount', { error: true });
        await onSave(v); closeSheet();
      };
      const c = p.querySelector('#ms-clear');
      if (c) c.onclick = async () => { await onSave(null); closeSheet(); };
    },
  });
}

export const actions = {
  'edit-income': (_, rerender) => moneySheet({
    title: 'Monthly take-home pay', help: 'After tax. Leave on automatic to use the average of your statements.',
    value: state.eff.income ?? state.derived.budget.income,
    onSave: async (v) => { await saveSettings({ income: v }); rerender(); },
  }),
  'edit-savings': (_, rerender) => moneySheet({
    title: 'Monthly savings goal', help: 'Automatic is 20% of income (the 50/30/20 rule).',
    value: state.derived.budget.savingsTarget,
    onSave: async (v) => { await saveSettings({ savingsTarget: v }); rerender(); },
  }),
  'edit-payday': (_, rerender) => {
    openSheet(`<h2>Payday</h2><p class="muted">Day of the month your main income arrives. Used to check which bills land before you're paid.</p>
      <label class="field"><input id="pd" type="number" min="1" max="31" inputmode="numeric" value="${state.derived.payday ?? ''}"></label>
      <div class="row gap"><button class="btn ghost grow" id="pd-auto">Detect automatically</button><button class="btn primary grow" id="pd-save">Save</button></div>`, {
      onMount(p) {
        p.querySelector('#pd-save').onclick = async () => {
          const d = parseInt(p.querySelector('#pd').value, 10);
          if (!(d >= 1 && d <= 31)) return toast('Enter a day from 1 to 31', { error: true });
          await saveSettings({ payday: d }); closeSheet(); rerender();
        };
        p.querySelector('#pd-auto').onclick = async () => { await saveSettings({ payday: null }); closeSheet(); rerender(); };
      },
    });
  },
  'edit-budget': (el, rerender) => {
    const cat = el.dataset.cat;
    const line = state.derived.budget.byCategory[cat];
    moneySheet({
      title: `${CAT[cat]?.icon || ''} ${catName(cat)} budget`,
      help: line ? `You usually spend ${fmt(line.hist, { whole: true })} a month here.` : '',
      value: line?.budget ?? 0,
      onSave: async (v) => {
        const budgets = { ...(state.eff.budgets || {}) };
        if (v == null) delete budgets[cat]; else budgets[cat] = v;
        await saveSettings({ budgets }); rerender();
      },
    });
  },
  'reset-budgets': async (_, rerender) => { await saveSettings({ budgets: {} }); rerender(); toast('Budgets reset'); },
};
