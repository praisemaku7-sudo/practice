// One screen to fix every account: type (debit/current, credit card, savings),
// today's balance or amount owed, and merging duplicates of the same account.
import { state, recompute, relinkTransfers, saveSettings, ownerOf } from '../../state.js';
import { db } from '../../lib/db.js';
import { esc, toast, confirmSheet } from '../dom.js';
import { fmt, parsePrice } from '../../lib/money.js';
import { prettyDate } from '../../lib/dates.js';
import { mergePlan } from '../../lib/duplicates.js';
import { suggestAccountName } from '../../lib/parse/details.js';

const TYPES = [['current', 'Current / debit card'], ['credit', 'Credit card'], ['savings', 'Savings']];
const draft = {}; // accountId -> { type, balance (string), name, mergeInto }

function d(a) {
  if (!draft[a.id]) draft[a.id] = { type: a.type, name: a.name, balance: '', mergeInto: '', owner: ownerOf(a) };
  return draft[a.id];
}

function ownerSelect(a, x) {
  const people = state.settings.people;
  if (people.length < 2) return '';
  return `<label class="field select slim"><span>Whose account</span><select data-change="su-owner" data-id="${esc(a.id)}">
    ${[...people.map((p) => [p.id, p.name]), ['joint', 'Joint']].map(([id, n]) => `<option value="${esc(id)}" ${x.owner === id ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>`;
}

export function render() {
  if (!state.accounts.length) return '<h1 class="page-title">Fix accounts</h1><p class="muted">No accounts yet.</p>';
  const counts = {};
  for (const t of state.txs) counts[t.accountId] = (counts[t.accountId] || 0) + 1;
  const suspects = new Set(state.derived.suspects.map((a) => a.id));
  return `
  <h1 class="page-title">Fix accounts</h1>
  <div class="card tip-box">
    <b>For each account:</b> choose what it really is, and type today's figure from that bank's app. When you save, each account's type is <b>locked</b> 🔒 and the prompts about it stop. Tap Edit to change it later.
    <ul class="tips">
      <li><b>Current / debit card</b>: your everyday account; the debit card is part of it. Enter the balance.</li>
      <li><b>Credit card</b>: money you borrow. Enter what you <b>owe</b> (current balance), not the available credit.</li>
      <li>If two rows are the <b>same account</b> (e.g. "Revolut Card" and "Revolut Current"), use "Same account as" to merge them. Duplicate payments are removed.</li>
    </ul>
  </div>
  ${state.accounts.map((a) => {
    const x = d(a);
    const shown = a.balance == null ? null : a.type === 'credit' ? Math.max(0, -a.balance) : a.balance;
    const det = a.details || {};
    const suggested = a.details ? suggestAccountName(det, x.type) : null;
    const detailsLine = a.details ? `<div class="details-line">🏦 ${esc([det.bank, det.product].filter(Boolean).join(' · ') || 'bank unknown')}${det.sortCode ? ` · ${esc(det.sortCode)}${det.bankFromSort ? ` (${esc(det.bankFromSort)}${det.bankFromSort === det.bank ? ' ✓' : ' ⚠︎'})` : ''}` : ''}${det.last4 ? ` · ••${esc(det.last4)}` : ''}${det.holder ? ` · 👤 ${esc(det.holder)}` : ''}</div>` : '';
    const suggestBtn = suggested && suggested !== x.name ? `<button class="chip" data-action="su-suggest" data-id="${esc(a.id)}" data-name="${esc(suggested)}">✨ Use "${esc(suggested)}"</button>` : '';
    if (a.typeLocked && !x.editing) {
      // Confirmed accounts stay locked: just a quick balance update, or Edit to change anything.
      return `<div class="card acct-fix locked">
        <div class="row between"><b class="ellipsis grow">🔒 ${esc(x.name)}</b><button class="link" data-action="su-edit" data-id="${esc(a.id)}">Edit</button></div>
        ${detailsLine}${suggestBtn}
        <div class="sub">${esc(TYPES.find(([k]) => k === a.type)?.[1] || a.type)} · ${shown == null ? 'no balance' : `${fmt(shown)}${a.type === 'credit' ? ' owed' : ''}`}${a.balanceDate ? ` on ${prettyDate(a.balanceDate)}` : ''}</div>
        <label class="field slim"><span>${a.type === 'credit' ? 'Owed today £' : 'Balance today £'}</span>
          <input inputmode="decimal" placeholder="update from the bank app" value="${esc(x.balance)}" data-input="su-bal" data-id="${esc(a.id)}"></label>
        ${ownerSelect(a, x)}
      </div>`;
    }
    return `<div class="card acct-fix ${x.mergeInto ? 'merging' : ''}">
      <div class="row between"><input class="name-input" value="${esc(x.name)}" data-input="su-name" data-id="${esc(a.id)}" aria-label="Account name">
        ${suspects.has(a.id) ? '<span class="pill warn">looks like a card</span>' : ''}</div>
      ${detailsLine}${suggestBtn}
      <div class="sub">${esc(a.bank || '')} · ${counts[a.id] || 0} transactions · statement says ${shown == null ? 'no balance' : `${fmt(shown)}${a.type === 'credit' ? ' owed' : ''}`}${a.balanceDate ? ` on ${prettyDate(a.balanceDate)}` : ''}</div>
      <div class="seg three">${TYPES.map(([k, l]) => `<button class="${x.type === k ? 'on' : ''}" data-action="su-type" data-id="${esc(a.id)}" data-type="${k}">${l}</button>`).join('')}</div>
      <label class="field slim"><span>${x.type === 'credit' ? 'Owed today £' : 'Balance today £'}</span>
        <input inputmode="decimal" placeholder="${shown == null ? 'from the bank app' : (shown / 100).toFixed(2)}" value="${esc(x.balance)}" data-input="su-bal" data-id="${esc(a.id)}"></label>
      ${ownerSelect(a, x)}
      <label class="field select slim"><span>Same account as</span><select data-change="su-merge" data-id="${esc(a.id)}">
        <option value="">— no, it's separate —</option>
        ${state.accounts.filter((o) => o.id !== a.id).map((o) => `<option value="${esc(o.id)}" ${x.mergeInto === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>
      ${x.mergeInto ? `<p class="sub warn-text">Will be merged into ${esc(state.accounts.find((o) => o.id === x.mergeInto)?.name || '')} when you save.</p>` : ''}
    </div>`;
  }).join('')}
  <div class="sticky-cta"><a class="btn ghost" href="#/accounts">Cancel</a><button class="btn primary grow" data-action="su-save">Save all</button></div>`;
}

async function mergeAccount(from, to) {
  const fromTxs = state.txs.filter((t) => t.accountId === from.id);
  const toTxs = state.txs.filter((t) => t.accountId === to.id);
  const { drop, move } = mergePlan(fromTxs, toTxs);
  for (const t of drop) await db.del('tx', t.id);
  for (const t of move) t.accountId = to.id;
  await db.putMany('tx', move);
  const dropIds = new Set(drop.map((t) => t.id));
  state.txs = state.txs.filter((t) => !dropIds.has(t.id));
  for (const i of state.imports.filter((x) => x.accountId === from.id)) { i.accountId = to.id; await db.put('imports', i); }
  if (to.balance == null && from.balance != null) { to.balance = from.balance; to.balanceDate = from.balanceDate; }
  if (!to.ref && from.ref) to.ref = from.ref;
  await db.put('accounts', to);
  await db.del('accounts', from.id);
  state.accounts = state.accounts.filter((x) => x.id !== from.id);
  if (state.settings.mainAccountId === from.id) await saveSettings({ mainAccountId: to.id });
  return { moved: move.length, dropped: drop.length };
}

export const actions = {
  'su-suggest': (el, rerender) => { const a = state.accounts.find((x) => x.id === el.dataset.id); d(a).name = el.dataset.name; d(a).renamed = true; rerender(); },
  'su-edit': (el, rerender) => { const a = state.accounts.find((x) => x.id === el.dataset.id); d(a).editing = true; rerender(); },
  'su-type': (el, rerender) => { const a = state.accounts.find((x) => x.id === el.dataset.id); d(a).type = el.dataset.type; rerender(); },
  'su-save': async (_, rerender) => {
    const merges = state.accounts.filter((a) => draft[a.id]?.mergeInto);
    if (merges.length && !(await confirmSheet({ title: `Merge ${merges.length} account${merges.length > 1 ? 's' : ''}?`, body: merges.map((a) => `${a.name} → ${state.accounts.find((o) => o.id === draft[a.id].mergeInto)?.name}`).join(', ') + '. Payments that appear in both are kept once.', ok: 'Merge and save' }))) return;
    const today = state.derived.today;
    for (const a of state.accounts) {
      const x = draft[a.id];
      if (!x) continue;
      if (x.name.trim() && x.name.trim() !== a.name) { a.name = x.name.trim(); a.autoName = false; }
      const wasCredit = a.type === 'credit';
      a.type = x.type;
      a.owner = x.owner || a.owner;
      a.typeLocked = true; // confirmed: no more "looks like a card" prompts, stays until you tap Edit
      const v = x.balance.trim() ? parsePrice(x.balance.replace(/^-/, '')) : null;
      if (v != null) {
        const neg = x.balance.trim().startsWith('-');
        a.balance = a.type === 'credit' ? -v : neg ? -v : v;
        a.balanceDate = today;
      } else if (a.balance != null && wasCredit !== (a.type === 'credit')) {
        // Type changed without a new figure: keep the amount, flip how it's stored.
        a.balance = a.type === 'credit' ? -Math.abs(a.balance) : Math.abs(a.balance);
      }
      await db.put('accounts', a);
    }
    let moved = 0, dropped = 0;
    for (const a of merges) {
      const to = state.accounts.find((o) => o.id === draft[a.id].mergeInto);
      if (!to) continue;
      const r = await mergeAccount(a, to);
      moved += r.moved; dropped += r.dropped;
    }
    for (const k of Object.keys(draft)) delete draft[k];
    await relinkTransfers();
    recompute();
    toast(merges.length ? `Saved · merged ${merges.length} (${dropped} duplicate payments removed)` : 'Accounts saved');
    location.hash = '#/accounts';
    rerender();
  },
};
export const changes = {
  'su-owner': (el) => { const a = state.accounts.find((x) => x.id === el.dataset.id); d(a).owner = el.value; },
  'su-merge': (el, rerender) => { const a = state.accounts.find((x) => x.id === el.dataset.id); d(a).mergeInto = el.value; rerender(); },
};
export const inputs = {
  'su-name': (el) => { draft[el.dataset.id].name = el.value; },
  'su-bal': (el) => { draft[el.dataset.id].balance = el.value; },
};
