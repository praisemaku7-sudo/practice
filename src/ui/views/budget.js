import { state, saveSettings, activeTempIncome, personIncome, personName, estimatedIncome } from '../../state.js';
import { esc, openSheet, closeSheet, toast } from '../dom.js';
import { fmt, parsePrice } from '../../lib/money.js';
import { budgetProgress } from '../../lib/budget.js';
import { catName, CAT } from '../../lib/categories.js';
import { monthKey, monthLabel } from '../../lib/dates.js';
import { progressBar } from '../charts.js';
import { catChip, emptyState } from '../common.js';

/** Per-person income: usual (payslip / SA302 / typed) and temporary (maternity etc.). */
function incomeBreakdown() {
  const s = state.settings;
  const people = s.scope === 'all' ? s.people : s.people.filter((p) => p.id === s.scope);
  if (s.scope === 'joint' || (!people.length)) return '';
  return `<div class="income-box">${people.map((p) => {
    const usual = s.scoped?.[p.id]?.income;
    const temp = s.tempIncome?.[p.id];
    const active = activeTempIncome(p.id);
    const src = s.sa302s?.[p.id]?.length ? `SA302 ${s.sa302s[p.id][s.sa302s[p.id].length - 1].taxYear || ''}` : s.payslips?.[p.id] ? 'payslip' : usual != null ? 'typed' : 'not set';
    return `<div class="income-person">
      ${people.length > 1 || s.people.length > 1 ? `<b>${esc(p.name)}</b> · now <b>${personIncome(p.id) != null ? fmt(personIncome(p.id), { whole: true }) : `~${fmt(estimatedIncome(p.id), { whole: true })}`}</b>/mo${personIncome(p.id) == null ? ' <small class="pill">estimated from statements</small>' : ''}` : ''}
      <div class="sub">Usual ${usual != null ? fmt(usual, { whole: true }) : '—'} <small class="pill">${esc(src)}</small>${temp ? ` · ${active ? '<b>' : ''}${esc(temp.label)} ${fmt(temp.monthly, { whole: true })}/mo${temp.until ? ` until ${esc(monthLabel(temp.until))}` : ''}${active ? '</b> (in use)' : ' (ended)'}` : ''}</div>
      <div class="chip-grid"><button class="chip" data-action="edit-person-income" data-id="${esc(p.id)}">✎ Usual income</button><button class="chip" data-action="edit-temp-income" data-id="${esc(p.id)}">${temp ? '✎' : '＋'} Temporary income (e.g. maternity)</button></div>
    </div>`;
  }).join('')}</div>`;
}

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
  <a class="card setup-cta" href="#/plan"><div><b>🏠 Future planning</b><div class="sub">${state.settings.mortgage?.principal || state.settings.mortgage?.price ? `Mortgage from ${esc(monthLabel(state.settings.mortgage.startMonth))}: see your months ahead` : 'Add your mortgage (amount, rate, start date) and see how your months will look'}</div></div><span class="banner-go">›</span></a>
  <div class="card">
    <div class="row between"><span class="label">Monthly income</span>
      <button class="link" data-action="edit-income">${fmt(budget.income, { whole: true })} ${budget.incomeIsEstimate ? '<small class="pill">estimated</small>' : incomeSource()} ✎</button></div>
    ${incomeBreakdown()}
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
  'edit-person-income': (el, rerender) => {
    const pid = el.dataset.id;
    moneySheet({
      title: `${personName(pid)}'s usual monthly take-home`, help: 'After tax. Payslips and SA302s set this automatically when imported.',
      value: state.settings.scoped?.[pid]?.income ?? null,
      onSave: async (v) => { const scoped = { ...(state.settings.scoped || {}) }; scoped[pid] = { ...(scoped[pid] || {}), income: v }; await saveSettings({ scoped }); rerender(); },
    });
  },
  'edit-temp-income': (el, rerender) => {
    const pid = el.dataset.id;
    const t = state.settings.tempIncome?.[pid] || { label: 'Maternity pay', monthly: null, until: null };
    openSheet(`<h2>Temporary income · ${esc(personName(pid))}</h2>
      <p class="muted">Maternity or paternity pay, sick pay, a contract ending… While it lasts it replaces their usual income in every budget and check. When it ends, usual income comes back automatically.</p>
      <div class="chip-grid"><button class="chip" data-preset="Maternity pay">🍼 Maternity pay</button><button class="chip" data-preset="Paternity pay">👶 Paternity pay</button><button class="chip" data-preset="Sick pay">🤒 Sick pay</button></div>
      <label class="field"><span>What</span><input id="ti-label" value="${esc(t.label)}"></label>
      <label class="field"><span>£ a month</span><input id="ti-amt" inputmode="decimal" value="${t.monthly ? (t.monthly / 100).toFixed(0) : ''}" placeholder="800"></label>
      <label class="field"><span>Until</span><input id="ti-until" type="month" value="${esc(t.until || '')}"></label>
      <p class="sub">Maternity Allowance for the self-employed lasts up to 39 weeks; Statutory Maternity Pay also up to 39 weeks.</p>
      <div class="row gap">${state.settings.tempIncome?.[pid] ? '<button class="btn danger grow" id="ti-del">Remove</button>' : ''}<button class="btn primary grow" id="ti-save">Save</button></div>`, {
      onMount(p) {
        p.querySelectorAll('[data-preset]').forEach((b) => { b.onclick = () => { p.querySelector('#ti-label').value = b.dataset.preset; }; });
        p.querySelector('#ti-save').onclick = async () => {
          const monthly = parsePrice(p.querySelector('#ti-amt').value);
          if (!monthly) return toast('Enter the monthly amount', { error: true });
          await saveSettings({ tempIncome: { ...(state.settings.tempIncome || {}), [pid]: { label: p.querySelector('#ti-label').value.trim() || 'Temporary income', monthly, until: p.querySelector('#ti-until').value || null } } });
          closeSheet(); rerender(); toast('Saved: budgets now use it');
        };
        const del = p.querySelector('#ti-del');
        if (del) del.onclick = async () => { const ti = { ...(state.settings.tempIncome || {}) }; delete ti[pid]; await saveSettings({ tempIncome: ti }); closeSheet(); rerender(); };
      },
    });
  },
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
