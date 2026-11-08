// Savings goals page.
import { state, saveSettings, personName } from '../../state.js';
import { esc, openSheet, closeSheet, toast, confirmSheet } from '../dom.js';
import { fmt, parsePrice } from '../../lib/money.js';
import { goalPlan, goalInScope } from '../../lib/goals.js';
import { monthLabel, monthKey, addMonths } from '../../lib/dates.js';
import { progressBar } from '../charts.js';

const ICONS = ['🏖️', '🏠', '🚗', '💍', '🎓', '🛟', '🎁', '✈️', '💻', '👶'];

export function render() {
  const { today, budget } = state.derived;
  const byId = Object.fromEntries((state.allAccounts || state.accounts).map((a) => [a.id, a]));
  const goals = (state.settings.goals || []).filter((g) => goalInScope(g, state.settings.scope));
  const total = goals.reduce((a, g) => a + goalPlan(g, today, byId).monthly, 0);
  return `
  <h1 class="page-title">Savings goals</h1>
  <div class="card hero feature">
    <div class="label">Set aside each month for your goals</div>
    <div class="big">${fmt(total, { whole: true })}<small>/month</small></div>
    <div class="sub">${total ? `Built into your budget: your savings goal is ${fmt(budget.savingsTarget, { whole: true })}/month and fun money is what's left after it. "Can I afford this?" protects it.` : 'Add a goal and the app works out how much to put aside each month.'}</div>
  </div>
  ${goals.map((g) => {
    const p = goalPlan(g, today, byId);
    return `<button class="card goal tap" data-action="goal-edit" data-id="${esc(g.id)}">
      <div class="row between"><b>${esc(g.icon || '🎯')} ${esc(g.name)}</b><span class="${p.done ? 'pos' : ''}">${fmt(p.saved, { whole: true })} / ${fmt(g.target, { whole: true })}</span></div>
      ${progressBar(p.progress, { warnAt: 2 })}
      <div class="sub">${p.done ? '✓ Reached. Well done!' : p.overdue ? `<span class="neg">Target date passed, ${fmt(p.remaining, { whole: true })} to go</span>` : g.by ? `${fmt(p.monthly, { whole: true })}/month for ${p.monthsLeft} month${p.monthsLeft === 1 ? '' : 's'} · by ${esc(monthLabel(g.by))}` : 'No date set'}${g.accountId ? ` · tracks ${esc(byId[g.accountId]?.name || 'account')}` : ''}${state.settings.people.length > 1 ? ` · ${esc(g.owner && g.owner !== 'all' ? personName(g.owner) : 'Household')}` : ''}</div>
    </button>`;
  }).join('')}
  <button class="btn primary full" data-action="goal-edit">＋ New goal</button>`;
}

function goalSheet(goal, rerender) {
  const g = goal || { name: '', target: null, by: addMonths(monthKey(state.derived.today), 6), saved: 0, icon: '🏖️', owner: state.settings.scope };
  const savers = (state.allAccounts || state.accounts).filter((a) => a.type === 'savings' || a.type === 'current');
  openSheet(`<h2>${goal ? 'Edit goal' : 'New goal'}</h2>
    <div class="chip-grid">${ICONS.map((i) => `<button class="chip icon-chip ${g.icon === i ? 'sel' : ''}" data-icon="${i}">${i}</button>`).join('')}</div>
    <label class="field"><span>Name</span><input id="g-name" value="${esc(g.name)}" placeholder="e.g. Holiday"></label>
    <label class="field"><span>Target £</span><input id="g-target" inputmode="decimal" value="${g.target ? (g.target / 100).toFixed(0) : ''}" placeholder="1500"></label>
    <label class="field"><span>By</span><input id="g-by" type="month" value="${esc(g.by || '')}"></label>
    <label class="field select"><span>Track</span><select id="g-acc"><option value="">Amount I enter</option>${savers.map((a) => `<option value="${esc(a.id)}" ${g.accountId === a.id ? 'selected' : ''}>Balance of ${esc(a.name)}</option>`).join('')}</select></label>
    <label class="field" id="g-saved-row" ${g.accountId ? 'hidden' : ''}><span>Saved so far £</span><input id="g-saved" inputmode="decimal" value="${g.saved ? (g.saved / 100).toFixed(0) : ''}" placeholder="0"></label>
    ${state.settings.people.length > 1 ? `<label class="field select"><span>Whose</span><select id="g-owner"><option value="all">Household</option>${state.settings.people.map((p) => `<option value="${p.id}" ${g.owner === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>` : ''}
    <div class="row gap">${goal ? '<button class="btn danger grow" id="g-del">Delete</button>' : ''}<button class="btn primary grow" id="g-save">Save</button></div>`, {
    onMount(p) {
      let icon = g.icon;
      p.querySelectorAll('[data-icon]').forEach((b) => { b.onclick = () => { icon = b.dataset.icon; p.querySelectorAll('[data-icon]').forEach((x) => x.classList.toggle('sel', x === b)); }; });
      p.querySelector('#g-acc').onchange = (e) => { p.querySelector('#g-saved-row').hidden = !!e.target.value; };
      p.querySelector('#g-save').onclick = async () => {
        const name = p.querySelector('#g-name').value.trim();
        const target = parsePrice(p.querySelector('#g-target').value);
        if (!name || !target) return toast('Add a name and a target', { error: true });
        const next = { ...g, id: g.id || 'g' + Date.now().toString(36), name, target, icon, by: p.querySelector('#g-by').value || null,
          accountId: p.querySelector('#g-acc').value || null, saved: parsePrice(p.querySelector('#g-saved').value || '0') || 0,
          owner: p.querySelector('#g-owner')?.value || (state.settings.scope === 'joint' ? 'all' : state.settings.scope) };
        const goals = (state.settings.goals || []).filter((x) => x.id !== next.id);
        await saveSettings({ goals: [...goals, next] });
        closeSheet(); rerender(); toast(`${name} saved`);
      };
      const del = p.querySelector('#g-del');
      if (del) del.onclick = async () => {
        closeSheet();
        if (!(await confirmSheet({ title: `Delete ${g.name}?`, body: 'The goal is removed from your budget. No money moves.', ok: 'Delete', danger: true }))) return;
        await saveSettings({ goals: (state.settings.goals || []).filter((x) => x.id !== g.id) });
        rerender();
      };
    },
  });
}

export const actions = {
  'goal-edit': (el, rerender) => goalSheet((state.settings.goals || []).find((g) => g.id === el.dataset.id), rerender),
};
