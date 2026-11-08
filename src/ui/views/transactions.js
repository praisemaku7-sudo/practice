import { state, recompute, saveSettings, accountName } from '../../state.js';
import { db } from '../../lib/db.js';
import { esc, openSheet, closeSheet, toast } from '../dom.js';
import { fmt } from '../../lib/money.js';
import { CATEGORIES, catName } from '../../lib/categories.js';
import { monthKey, prettyDate } from '../../lib/dates.js';
import { catChip, monthSwitcher } from '../common.js';

const filter = { q: '', cat: '', all: false };
const PAGE = 300;

export function applyParams(params) {
  filter.cat = params.get('cat') || '';
  filter.q = '';
}

export function render() {
  const q = filter.q.trim().toLowerCase();
  let list = state.txs.filter((t) => (filter.all || monthKey(t.date) === state.month)
    && (!filter.cat || t.category === filter.cat)
    && (!q || t.description.toLowerCase().includes(q) || (t.merchant || '').toLowerCase().includes(q)));
  list = list.sort((a, b) => b.date.localeCompare(a.date) || a.amount - b.amount);
  const total = list.reduce((a, t) => a + t.amount, 0);
  let lastDate = '';
  const rows = list.slice(0, PAGE).map((t) => {
    const head = t.date !== lastDate ? `<div class="date-head">${prettyDate(t.date)}</div>` : '';
    lastDate = t.date;
    return `${head}<button class="list-row tap" data-action="tx-edit" data-id="${esc(t.id)}">${catChip(t.category)}
      <div class="grow"><div class="ellipsis">${esc(t.description)}</div><div class="sub">${esc(catName(t.category))} · ${state.accounts.find((a) => a.id === t.accountId)?.type === 'credit' ? '💳 ' : ''}${esc(accountName(t.accountId))}${t.cardholder ? ` · 👤 ${esc(t.cardholder)}` : ''}${t.manual ? ' · manual' : ''}</div></div>
      <b class="${t.amount > 0 ? 'pos' : ''}">${fmt(t.amount, { sign: true })}</b></button>`;
  }).join('');
  return `
  ${filter.all ? '<h1 class="page-title">All transactions</h1>' : monthSwitcher(state.month, state.derived.months)}
  <div class="card filters">
    <input type="search" id="tx-q" placeholder="Search" value="${esc(filter.q)}" data-input="tx-search">
    <div class="row gap">
      <select data-change="tx-cat" class="grow"><option value="">All categories</option>${CATEGORIES.map((c) => `<option value="${c.id}" ${filter.cat === c.id ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('')}</select>
      <label class="toggle"><input type="checkbox" data-change="tx-all" ${filter.all ? 'checked' : ''}> All months</label>
    </div>
    <div class="sub">${list.length} transactions · net ${fmt(total, { sign: true })}</div>
  </div>
  <div class="card tx-list">${rows || '<p class="muted">No transactions match.</p>'}
  ${list.length > PAGE ? `<p class="sub center">Showing the latest ${PAGE}. Search to narrow down.</p>` : ''}</div>`;
}

export const actions = {
  'tx-edit': (el, rerender) => {
    const t = state.txs.find((x) => x.id === el.dataset.id);
    if (!t) return;
    openSheet(`<h2 class="ellipsis">${esc(t.description)}</h2>
      <p class="muted">${prettyDate(t.date)} · ${esc(accountName(t.accountId))} · <b>${fmt(t.amount, { sign: true })}</b></p>
      <div class="cat-grid">${CATEGORIES.map((c) => `<button class="cat-opt ${c.id === t.category ? 'sel' : ''}" data-cat="${c.id}">${c.icon}<span>${esc(c.name)}</span></button>`).join('')}</div>
      <label class="toggle"><input type="checkbox" id="tx-rule" checked> Always use this for “${esc(t.merchant)}”</label>
      ${t.manual ? '<button class="btn danger full" id="tx-del">Delete manual entry</button>' : ''}`, {
      onMount(p) {
        p.querySelectorAll('.cat-opt').forEach((b) => {
          b.onclick = async () => {
            const cat = b.dataset.cat;
            const asRule = p.querySelector('#tx-rule').checked;
            const targets = asRule ? state.txs.filter((x) => x.merchant === t.merchant && Math.sign(x.amount) === Math.sign(t.amount)) : [t];
            for (const x of targets) { x.category = cat; x.userCategory = true; }
            await db.putMany('tx', targets);
            if (asRule) await saveSettings({ userRules: { ...state.settings.userRules, [t.merchant]: cat } });
            recompute(); closeSheet(); rerender();
            toast(asRule && targets.length > 1 ? `Updated ${targets.length} transactions` : 'Updated');
          };
        });
        const del = p.querySelector('#tx-del');
        if (del) del.onclick = async () => {
          await db.del('tx', t.id);
          state.txs = state.txs.filter((x) => x.id !== t.id);
          recompute(); closeSheet(); rerender();
        };
      },
    });
  },
};

export const changes = {
  'tx-cat': (el, rerender) => { filter.cat = el.value; rerender(); },
  'tx-all': (el, rerender) => { filter.all = el.checked; rerender(); },
};

export const inputs = {
  'tx-search': (el, rerender) => {
    filter.q = el.value;
    const pos = el.selectionStart;
    rerender();
    const n = document.getElementById('tx-q');
    if (n) { n.focus(); n.setSelectionRange(pos, pos); }
  },
};
