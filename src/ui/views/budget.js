import { paydaySplitCard, runwayCard } from '../afford-extras.js';
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
  // A short summary; everything about income lives on the Income page.
  return `<a class="income-box income-link" href="#/income">${people.map((p) => `<div class="income-person"><b>${esc(p.name.split(' ')[0])}</b> <span class="muted">${personIncome(p.id) != null ? fmt(personIncome(p.id), { whole: true }) : `~${fmt(estimatedIncome(p.id), { whole: true })}`}/mo${activeTempIncome(p.id) ? ` · ${esc(activeTempIncome(p.id).label)}` : s.payslips?.[p.id] ? ' · payslip' : ''}</span></div>`).join('')}${(s.otherIncome || []).length ? `<div class="income-person"><b>+ household</b> <span class="muted">${esc(s.otherIncome.map((x) => x.label).join(', '))}</span></div>` : ''}<span class="banner-go">Income ›</span></a>`;
}


function incomeSource() {
  const s = state.settings;
  const slips = s.payslips || {};
  if (s.scope !== 'all') return slips[s.scope] ? `<small class="pill ok">from payslip</small>` : '';
  return s.people.some((p) => slips[p.id]) ? `<small class="pill ok">from payslips</small>` : '';
}

const KIND_LABEL = { fixed: 'Bills & commitments', essential: 'Essentials', personal: 'Fun money (you choose)' };

export function render() {
  if (!state.txs.length) return emptyState({ title: 'No budget yet', body: 'Your budget is built from your regular payments and your last 3 months of statements.' });
  const { budget, payday, detectedPayday, today, recurring } = state.derived;
  const key = monthKey(today);
  const prog = budgetProgress(state.txs, budget, key);
  const inc = budget.income || 0;
  const sumK = (k) => prog.rows.filter((r) => r.kind === k).reduce((a, r) => a + r.budget, 0);
  const fixed = sumK('fixed'), ess = sumK('essential'), fun = budget.personalAllowance, save = budget.savingsTarget, pay = budget.cardPayoff || 0;
  const left = inc - fixed - ess - fun - save - pay;
  const housing = budget.byCategory.housing?.budget || 0;
  const pct = (v) => (inc ? Math.round((v / inc) * 100) : 0);
  const flags = state.settings.billFlags || {}, hidden = state.settings.billHidden || {};
  const sources = (cat) => recurring.filter((r) => r.active && r.direction === 'out' && r.category === cat && !hidden[r.key] && flags[r.key] !== 'cancelled');
  const ord = (d) => `${d}${d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th'}`;
  const step = (label, v, cls, sign = '−') => `<div class="wf-row"><span class="grow">${label}</span><span class="wf-bar"><i class="${cls}" style="width:${Math.min(100, Math.max(0, pct(v)))}%"></i></span><b>${sign}${fmt(v, { whole: true })}</b><small>${pct(v)}%</small></div>`;
  const groups = ['fixed', 'essential', 'personal'].map((kind) => {
    const rows = prog.rows.filter((r) => r.kind === kind && (r.budget > 0 || r.spent > 0)).sort((a, b) => b.budget - a.budget);
    if (!rows.length) return '';
    return `<div class="card"><h3>${KIND_LABEL[kind]} <small class="muted">${fmt(rows.reduce((a, r) => a + r.budget, 0), { whole: true })}</small></h3>
      ${rows.map((r) => { const src = kind === 'fixed' ? sources(r.category) : []; return `<button class="list-row tap" data-action="edit-budget" data-cat="${r.category}">${catChip(r.category)}
        <div class="grow"><div class="row between"><span>${esc(catName(r.category))}${r.overridden ? ' <small class="pill">custom</small>' : ''}</span>
        <span><b>${fmt(r.spent, { whole: true })}</b> <span class="muted">/ ${fmt(r.budget, { whole: true })}</span></span></div>
        ${progressBar(r.pct)}
        <div class="sub">${src.length ? `From: ${src.slice(0, 3).map((x) => `${esc(x.name)} ${fmt(x.amount, { whole: true })} (${ord(x.day)})`).join(', ')}${src.length > 3 ? ` +${src.length - 3}` : ''}` : `usually ${fmt(r.hist, { whole: true })}`} · <span class="${r.left < 0 ? 'neg' : ''}">${r.left < 0 ? fmt(-r.left, { whole: true }) + ' over' : fmt(r.left, { whole: true }) + ' left'}</span></div></div></button>`; }).join('')}
      ${kind === 'fixed' ? '<a class="link small-link" href="#/bills">Bill wrong or missing? Fix it in Bills ›</a>' : ''}
    </div>`;
  }).join('');

  return `
  <h1 class="page-title">Budget <small>${esc(monthLabel(key))}</small></h1>
  <div class="card">
    <h3>Your month on paper</h3>
    <div class="wf-row top"><span class="grow">Take-home income</span><button class="link" data-action="edit-income">${fmt(inc, { whole: true })} ${budget.incomeIsEstimate ? '<small class="pill">estimated</small>' : incomeSource()} ✎</button></div>
    ${incomeBreakdown()}
    ${step('Bills (regular payments)', fixed, 'fixed')}
    ${step('Essentials (food, travel…)', ess, 'essential')}
    ${step('Savings goal', save, 'savings')}
    ${pay ? step('Card payoff', pay, 'payoff') : ''}
    ${step('Fun money', fun, 'personal')}
    <div class="wf-row total"><span class="grow">${left >= 0 ? 'Not allocated' : 'Short each month'}</span><b class="${left < 0 ? 'neg' : 'pos'}">${fmt(Math.abs(left), { whole: true })}</b></div>
    ${housing && inc ? `<p class="sub ${pct(housing) > 35 ? 'warn-text' : ''}">Rent/mortgage is <b>${pct(housing)}%</b> of take-home${pct(housing) > 35 ? ': above the 30–35% that\'s usually comfortable, so everything else has to be tight.' : '.'} Bills in total: ${pct(fixed)}%.</p>` : ''}
    ${budget.shortfall > 0 ? `<div class="alert">Bills, essentials and your savings goal come to ${fmt(budget.shortfall, { whole: true })} more than your income, so fun money is £0. Lower the savings goal for now, or cut a bill: <a href="#/track">your path</a> shows what each change frees up.</div>` : ''}
    <div class="row-links"><button class="link" data-action="edit-savings">Savings goal ${fmt(save, { whole: true })} ✎</button><button class="link" data-action="edit-payday">Payday ${payday ? ord(payday) : 'not set'}${state.eff.payday == null && detectedPayday ? ' (detected)' : ''} ✎</button><a class="link" href="#/goals">Goals ›</a><a class="link" href="#/cards">Cards ›</a></div>
    <p class="sub">Bills come from your regular payments; essentials and fun money from ${budget.months.length ? budget.months.map((m) => monthLabel(m, { short: true })).join(', ') : 'this month'}. Tap any line to set your own amount.</p>
  </div>
  ${paydaySplitCard()}
  ${groups}
  ${runwayCard()}
  ${Object.keys(state.eff.budgets || {}).length ? '<button class="btn ghost full" data-action="reset-budgets">Reset all custom budgets</button>' : ''}
  <div class="act-links"><a class="act-link" href="#/plan">Future planning (mortgage) ›</a><a class="act-link" href="#/categories">Categories ›</a></div>`;
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
