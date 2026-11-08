import { state, recompute, saveSettings } from '../../state.js';
import { db } from '../../lib/db.js';
import { esc, toast, imageForUpload, busy } from '../dom.js';
import { fmt, parsePrice } from '../../lib/money.js';
import { canIAfford } from '../../lib/afford.js';
import { goalPlan, goalInScope } from '../../lib/goals.js';
import { categorize, merchantKey } from '../../lib/categorize.js';
import { CATEGORIES, catName } from '../../lib/categories.js';
import { aiReadPrice } from '../../lib/ai.js';
import { todayISO, prettyDate } from '../../lib/dates.js';
import { emptyState } from '../common.js';

const form = { item: '', price: '', category: '', photo: null, result: null, note: '' };

/** Allow iOS Shortcuts / links: #/afford?price=49.99&item=Trainers */
export function applyParams(params) {
  if (params.get('price')) form.price = params.get('price');
  if (params.get('item')) form.item = params.get('item');
  if (params.get('category')) form.category = params.get('category');
  form.result = null;
  if (form.price && state.txs.length) runCheck();
}

const spendCats = CATEGORIES.filter((c) => ['personal', 'essential', 'fixed'].includes(c.kind));

export function render() {
  if (!state.txs.length) return emptyState({ title: 'Import first', body: 'To answer "can I afford this?" I need to know your income, bills and budget. Import a statement or try the sample data.' });
  const r = form.result;
  const guessed = form.category || (form.item ? categorize(form.item, -1) : 'shopping');
  const cat = guessed === 'other' || guessed === 'income' ? 'shopping' : guessed;
  return `
  <h1 class="page-title">Can I afford this?</h1>
  <div class="card">
    <div class="photo-drop ${form.photo ? 'has' : ''}">
      ${form.photo ? `<img src="${form.photo}" alt="">` : ''}
      <label class="btn ghost">
        📷 ${form.photo ? 'Another photo' : 'Photo or screenshot'}
        <input type="file" accept="image/*" data-change="afford-photo" hidden>
      </label>
      ${state.settings.apiKey ? '' : '<p class="sub">Add a Claude API key in Settings to read prices from photos. Or just type the price below.</p>'}
    </div>
    ${form.note ? `<p class="sub">${esc(form.note)}</p>` : ''}
    <label class="field big-price"><span>£</span><input id="af-price" inputmode="decimal" placeholder="0.00" value="${esc(form.price)}" autocomplete="off"></label>
    <label class="field"><input id="af-item" placeholder="What is it? (optional)" value="${esc(form.item)}" autocomplete="off"></label>
    <label class="field select"><select id="af-cat">${spendCats.map((c) => `<option value="${c.id}" ${c.id === cat ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('')}</select></label>
    <button class="btn primary full" data-action="afford-check">Check</button>
  </div>
  ${r ? verdictCard(r) : ''}
  ${wishlistCard()}
  ${state.checks.length ? `<div class="card"><h3>Recent checks</h3>
    ${state.checks.slice(0, 8).map((c) => `<div class="list-row"><span class="verdict-dot ${c.verdict}"></span><div class="grow">${esc(c.item || catName(c.category))}<div class="sub">${prettyDate(c.date)} · ${esc(catName(c.category))}${c.bought ? ' · bought' : ''}</div></div><b>${fmt(c.price)}</b></div>`).join('')}
  </div>` : ''}
  <p class="sub center">Tip: an iPhone Shortcut can open <code>…/#/afford?price=49.99&amp;item=Trainers</code>, so you can ask from the Action Button or Siri.</p>`;
}

function verdictCard(r) {
  const icon = { yes: '✓', tight: '≈', no: '✕' }[r.verdict];
  return `<div class="card verdict ${r.verdict}">
    <div class="verdict-head"><span class="verdict-icon">${icon}</span><div><div class="verdict-word">${r.verdict === 'yes' ? 'Yes' : r.verdict === 'tight' ? 'Yes, if…' : 'Not right now'}</div>
    <div>${esc(r.headline)}</div></div></div>
    <ul class="checks">${r.checks.map((c) => `<li class="${c.pass === true ? 'pass' : c.pass === false ? 'fail' : 'skip'}"><b>${esc(c.label)}</b><span>${esc(c.detail)}</span></li>`).join('')}</ul>
    ${r.advice.length ? `<ul class="advice">${r.advice.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
    <div class="row gap">
      ${r.verdict !== 'yes' ? '<button class="btn primary grow" data-action="wish-add">Save to wishlist</button>' : ''}
      <button class="btn ghost grow" data-action="afford-bought">I bought it</button>
      <button class="btn ghost grow" data-action="afford-clear">New check</button>
    </div>
    <p class="sub">"I bought it" counts it against your budget now, and it's swapped for the real transaction when you next import that statement.</p>
  </div>`;
}

function wishlistCard() {
  const list = state.settings.wishlist;
  if (!list.length) return '';
  const { budget, recurring, balance, payday, today } = state.derived;
  return `<div class="card"><h3>Wishlist</h3><p class="sub">Re-checked against your budget every time you open this page.</p>
    ${list.map((w) => {
      const v = canIAfford({ price: w.price, category: w.category, txs: state.txs, budget, recurring, balance, payday, today, bufferPence: state.settings.bufferPence, cardsOwed: state.derived.cards.totalOwed, goals: goalsForAfford() });
      return `<div class="list-row"><span class="verdict-dot ${v.verdict}"></span>
        <div class="grow"><div class="ellipsis">${esc(w.item || catName(w.category))}</div>
        <div class="sub">${v.verdict === 'yes' ? '<b class="pos">Affordable now</b>' : v.verdict === 'tight' ? 'Affordable if you move budget' : 'Not yet'} · added ${prettyDate(w.added)}</div></div>
        <b>${fmt(w.price)}</b>
        <button class="icon-btn small" data-action="wish-remove" data-id="${esc(w.id)}" aria-label="Remove">×</button></div>`;
    }).join('')}</div>`;
}

function goalsForAfford() {
  const byId = Object.fromEntries((state.allAccounts || state.accounts).map((a) => [a.id, a]));
  return (state.settings.goals || []).filter((g) => goalInScope(g, state.settings.scope)).map((g) => ({ ...g, monthly: goalPlan(g, state.derived.today, byId).monthly }));
}

function readForm() {
  form.price = document.getElementById('af-price')?.value ?? form.price;
  form.item = document.getElementById('af-item')?.value ?? form.item;
  form.category = document.getElementById('af-cat')?.value ?? form.category;
}

function runCheck() {
  const price = parsePrice(form.price);
  if (!price) { toast('Enter a price', { error: true }); return false; }
  const { budget, recurring, balance, payday, today } = state.derived;
  // Same rule as the category box shows: unknown items count as Shopping.
  const guess = form.category || categorize(form.item, -1);
  const category = guess === 'other' || guess === 'income' ? 'shopping' : guess;
  const res = canIAfford({ price, category, txs: state.txs, budget, recurring, balance, payday, today, bufferPence: state.settings.bufferPence, cardsOwed: state.derived.cards.totalOwed, goals: goalsForAfford() });
  form.result = { ...res, price, category };
  const rec = { id: crypto.randomUUID?.() || String(Date.now()), at: Date.now(), date: todayISO(), item: form.item, price, category, verdict: res.verdict };
  form.result.checkId = rec.id;
  state.checks.unshift(rec);
  db.put('checks', rec);
  return true;
}

export const actions = {
  'wish-add': async (_, rerender) => {
    const r = form.result;
    if (!r) return;
    const w = { id: r.checkId, item: form.item, price: r.price, category: r.category, added: todayISO() };
    await saveSettings({ wishlist: [w, ...state.settings.wishlist.filter((x) => x.id !== w.id)] });
    toast('Saved to wishlist. It tells you when it becomes affordable.');
    actions['afford-clear'](null, rerender);
  },
  'wish-remove': async (el, rerender) => { await saveSettings({ wishlist: state.settings.wishlist.filter((w) => w.id !== el.dataset.id) }); rerender(); },
  'afford-check': (_, rerender) => { readForm(); if (runCheck()) rerender(); },
  'afford-clear': (_, rerender) => { Object.assign(form, { item: '', price: '', category: '', photo: null, result: null, note: '' }); rerender(); },
  'afford-bought': async (_, rerender) => {
    const r = form.result;
    if (!r) return;
    const main = state.settings.mainAccountId || state.accounts.find((a) => a.type === 'current')?.id || 'manual';
    const tx = {
      id: 'm-' + r.checkId, accountId: main, importId: null, source: 'manual', manual: true,
      date: todayISO(), description: form.item || catName(r.category), merchant: merchantKey(form.item || 'MANUAL'),
      amount: -r.price, balance: null, category: r.category, userCategory: true,
    };
    state.txs.push(tx);
    await db.put('tx', tx);
    const chk = state.checks.find((c) => c.id === r.checkId);
    if (chk) { chk.bought = true; await db.put('checks', chk); }
    recompute();
    toast(`Added ${fmt(r.price)} to ${catName(r.category)}`);
    actions['afford-clear'](null, rerender);
  },
};

export const changes = {
  'afford-photo': async (input, rerender) => {
    const file = input.files?.[0];
    if (!file) return;
    readForm();
    let img;
    try { img = await imageForUpload(file); } catch { return toast("Couldn't open that image", { error: true }); }
    form.photo = img.preview;
    form.result = null;
    if (!state.settings.apiKey) { form.note = 'Type the price shown in the photo.'; rerender(); return; }
    const done = busy('Reading the price…');
    try {
      const r = await aiReadPrice({ apiKey: state.settings.apiKey, model: state.settings.model, imageBase64: img.base64, mediaType: img.mediaType });
      if (r.price != null) form.price = (r.price / 100).toFixed(2);
      form.item = r.item || form.item;
      if (r.category && r.category !== 'income' && r.category !== 'transfer') form.category = r.category;
      form.note = `${r.confidence === 'high' ? 'Read' : 'Best guess'}: ${r.item}${r.price != null ? ' for ' + fmt(r.price) : ' (no price found)'}${r.notes ? '. ' + r.notes : ''}`;
    } catch (e) {
      form.note = e.message;
    } finally { done(); }
    rerender();
  },
};
