// "Check my numbers": shows exactly which transactions make up a month's In and Spent,
// and lets you fix the big ones in one tap (own transfers, refunds, exclusions).
import { state, saveSettings, recompute, relinkTransfers, accountName, load } from '../../state.js';
import { db } from '../../lib/db.js';
import { esc, toast } from '../dom.js';
import { fmt } from '../../lib/money.js';
import { catKind, catName } from '../../lib/categories.js';
import { monthKey, monthLabel, prettyDate, daysBetween } from '../../lib/dates.js';
import { similarity } from '../../lib/duplicates.js';
import { monthSwitcher, catChip, checksBox } from '../common.js';

const ui = { showTransfers: false };

function crossAccountDupes(txs) {
  const out = [];
  const byAmt = new Map();
  for (const t of txs) {
    if (catKind(t.category) === 'transfer') continue;
    if (!byAmt.has(t.amount)) byAmt.set(t.amount, []);
    byAmt.get(t.amount).push(t);
  }
  for (const list of byAmt.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.accountId !== b.accountId && Math.abs(daysBetween(a.date, b.date)) <= 3 && similarity(a.description, b.description) >= 0.5) out.push([a, b]);
    }
  }
  return out;
}

export function render() {
  const month = state.month;
  const m = state.txs.filter((t) => monthKey(t.date) === month);
  const income = m.filter((t) => catKind(t.category) === 'income');
  const spend = m.filter((t) => !['income', 'transfer', 'savings'].includes(catKind(t.category)));
  const transfers = m.filter((t) => catKind(t.category) === 'transfer');
  const inTotal = income.reduce((a, t) => a + t.amount, 0);
  const outTotal = spend.reduce((a, t) => a - t.amount, 0);
  const byAcc = new Map();
  for (const a of state.accounts) byAcc.set(a.id, { name: a.name, type: a.type, inn: 0, out: 0, moved: 0 });
  for (const t of income) byAcc.get(t.accountId) && (byAcc.get(t.accountId).inn += t.amount);
  for (const t of spend) byAcc.get(t.accountId) && (byAcc.get(t.accountId).out -= t.amount);
  for (const t of transfers) byAcc.get(t.accountId) && (byAcc.get(t.accountId).moved += Math.abs(t.amount));
  const dupes = crossAccountDupes(m);
  const topIn = [...income].sort((a, b) => b.amount - a.amount).slice(0, 10);
  const topOut = [...spend].sort((a, b) => a.amount - b.amount).slice(0, 15);
  const names = (state.settings.ownNames || []).join(', ');

  const row = (t, buttons) => `<div class="audit-row">
    <div class="row between"><div class="grow ellipsis">${catChip(t.category)} <b>${esc(t.description)}</b></div><b class="${t.amount > 0 ? 'pos' : ''}">${fmt(t.amount, { sign: true })}</b></div>
    <div class="sub">${prettyDate(t.date)} · ${esc(accountName(t.accountId))} · ${esc(catName(t.category))}</div>
    <div class="chip-grid">${buttons}</div></div>`;
  const btn = (t, cat, label) => `<button class="chip" data-action="au-set" data-id="${esc(t.id)}" data-cat="${cat}">${label}</button>`;

  return `
  ${monthSwitcher(month, state.derived.months)}
  <h1 class="page-title">Check my numbers</h1>
  ${checksBox({ title: 'Account balances' }) || '<div class="card"><b>✓ Account balances</b><div class="sub">Every balance agrees with its latest statement.</div></div>'}
  <div class="card">
    <div class="stat-grid"><div><span class="label">Counted as income</span><b class="pos">${fmt(inTotal, { whole: true })}</b></div>
    <div><span class="label">Counted as spending</span><b>${fmt(outTotal, { whole: true })}</b></div></div>
    <p class="sub">Money moving between your own accounts should be neither. If these look too high, the biggest items below are usually transfers that weren't recognised.</p>
  </div>

  <div class="card"><h3>Your name on transfers</h3>
    <p class="muted">When you move money between your own accounts, the statement usually shows your name (e.g. "P MAKU" or "MAKU P"). Anything with it is treated as a transfer, not income or spending.</p>
    <label class="field"><input id="au-names" placeholder="e.g. P MAKU, PRAISE MAKU" value="${esc(names)}"></label>
    <button class="btn primary full" data-action="au-names">Save &amp; recheck</button>
  </div>

  ${dupes.length ? `<div class="card banner"><b>${dupes.length} payment${dupes.length > 1 ? 's appear' : ' appears'} in two accounts</b>
    <span class="sub">e.g. ${esc(dupes[0][0].description)} ${fmt(dupes[0][0].amount)} in ${esc(accountName(dupes[0][0].accountId))} and ${esc(accountName(dupes[0][1].accountId))}. That usually means one real account was imported under two names, and it's counted twice.</span>
    <a class="btn primary full" href="#/setup">Merge them in Fix accounts</a></div>` : ''}

  <div class="card"><h3>By account</h3>
    <div class="month-table">
      <div class="mt-row mt-head"><span>Account</span><span>In</span><span>Spent</span><span>Moved</span></div>
      ${[...byAcc.values()].filter((a) => a.inn || a.out || a.moved).map((a) => `<div class="mt-row"><span class="ellipsis">${esc(a.name)}<br><small class="muted">${a.type === 'credit' ? 'credit card' : a.type}</small></span><span class="pos">${fmt(a.inn, { whole: true })}</span><span>${fmt(a.out, { whole: true })}</span><span class="muted">${fmt(a.moved, { whole: true })}</span></div>`).join('')}
    </div>
    <p class="sub">"Moved" = transfers between your accounts, not counted.</p>
  </div>

  <div class="card"><h3>Biggest money in, counted as income</h3>
    ${topIn.map((t) => row(t, `${btn(t, 'transfer', '↔ My own transfer')}${btn(t, 'other', '↩ Refund')}${btn(t, 'excluded', '🚫 Not mine')}`)).join('') || '<p class="muted">None.</p>'}
  </div>

  <div class="card"><h3>Biggest spending</h3>
    ${topOut.map((t) => row(t, `${btn(t, 'transfer', '↔ My own transfer')}${btn(t, 'savings', '🏦 Saving')}${btn(t, 'excluded', '🚫 Not my spending')}`)).join('') || '<p class="muted">None.</p>'}
  </div>

  <div class="card"><h3>Treated as transfers (${transfers.length}) · ${fmt(transfers.reduce((a, t) => a + Math.abs(t.amount), 0), { whole: true })}</h3>
    <button class="link" data-action="au-toggle">${ui.showTransfers ? 'Hide' : 'Show'} them</button>
    ${ui.showTransfers ? [...transfers].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 25).map((t) => row(t, t.amount < 0 ? btn(t, 'other', 'Actually spending') : btn(t, 'income', 'Actually income'))).join('') : ''}
  </div>
  <p class="sub center">Every choice applies to all payments from the same place, now and in future imports.</p>`;
}

export const actions = {
  // Accept the latest statement's balance when the app couldn't prove it.
  'chk-exclude': async (el, rerender) => {
    const a = state.allAccounts.find((x) => x.id === el.dataset.id);
    if (!a) return;
    a.excluded = true;
    await db.put('accounts', a);
    await load(); recompute();
    toast(`${a.name} is no longer counted. Change it in Accounts → Not counted.`);
    rerender();
  },
  'chk-use': async (el, rerender) => {
    const a = state.allAccounts.find((x) => x.id === el.dataset.id);
    const u = a?.balanceUnverified;
    if (!u) return;
    a.balance = u.amount; a.balanceDate = u.date; delete a.balanceUnverified;
    await db.put('accounts', a);
    recompute();
    toast(`${a.name}: using the statement's balance`);
    rerender();
  },
  'au-toggle': (_, rerender) => { ui.showTransfers = !ui.showTransfers; rerender(); },
  'au-set': async (el, rerender) => {
    const t = state.txs.find((x) => x.id === el.dataset.id);
    const cat = el.dataset.cat;
    const targets = state.txs.filter((x) => x.merchant === t.merchant && Math.sign(x.amount) === Math.sign(t.amount));
    for (const x of targets) { x.category = cat; x.userCategory = true; delete x.autoTransfer; }
    await db.putMany('tx', targets);
    await saveSettings({ userRules: { ...state.settings.userRules, [t.merchant]: cat } });
    recompute(); rerender();
    toast(`${targets.length > 1 ? `${targets.length} payments` : 'Payment'} → ${catName(cat)}`);
  },
  'au-names': async (_, rerender) => {
    const ownNames = document.getElementById('au-names').value.split(',').map((s) => s.trim()).filter(Boolean);
    await saveSettings({ ownNames });
    await relinkTransfers();
    recompute(); rerender();
    toast('Rechecked all transactions');
  },
};
