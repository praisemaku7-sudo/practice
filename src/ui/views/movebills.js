// Move every regular payment to one main account: decide move / cancel / leave for each, grouped by the
// account it leaves from, with a ready-to-send message per company, timing warnings, one-place switches
// (Apple, PayPal, Amazon), and automatic confirmation once a payment is seen leaving the main account.
import { state, saveSettings, accountName, personName, ownerOf } from '../../state.js';
import { esc, toast } from '../dom.js';
import { fmt } from '../../lib/money.js';
import { catName } from '../../lib/categories.js';
import { helpFor } from '../../lib/directory.js';
import { daysBetween, prettyDate } from '../../lib/dates.js';

const ord = (d) => `${d}${d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th'}`;
// Bank details for the messages: kept on screen only, never saved.
const mine = { name: '', sort: '', acc: '' };
const ui = { show: 'todo' };

/** The account your pay goes into is the natural main account. */
function suggestedMain() {
  const inc = {};
  for (const t of state.allTxs || state.txs) if (t.category === 'income' && t.amount > 0) inc[t.accountId] = (inc[t.accountId] || 0) + t.amount;
  const best = Object.entries(inc).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : state.accounts.find((a) => a.type === 'current')?.id;
}

/** How a payment is taken, from its label and the account it comes from. */
function kindOf(r, fromAcc) {
  if (fromAcc?.type === 'credit' || /Card|Subscription/i.test(r.type || '')) return 'card';
  if (/Standing/i.test(r.type || '')) return 'so';
  if (/Direct Debit/i.test(r.type || '')) return 'dd';
  return 'unknown';
}
const KIND_LABEL = { card: 'Card payment', so: 'Standing order', dd: 'Direct Debit', unknown: 'Payment' };
// One change covers many subscriptions at once.
const HUBS = [
  [/APPLE|ITUNES/i, 'Apple', 'iPhone: Settings › your name › Payment & Shipping. Change the card once and every App Store, iCloud, Apple Music and TV+ subscription moves.'],
  [/PAYPAL/i, 'PayPal', 'In PayPal: Wallet › change your preferred card. Subscriptions paid through PayPal follow it (check Settings › Payments › Automatic payments).'],
  [/AMAZON|AMZN|PRIME/i, 'Amazon', 'Amazon: Your Account › Prime › payment method, and Your Payments for Kindle, Audible and other subscriptions.'],
  [/GOOGLE/i, 'Google', 'Google Play: Payments & subscriptions › Payment methods. Covers Google One, YouTube Premium and Play subscriptions.'],
];

function message(r, mainName) {
  const det = [mine.name && `Name on the account: ${mine.name}`, `Sort code: ${mine.sort || '[sort code]'}`, `Account number: ${mine.acc || '[account number]'}`].filter(Boolean).join('\n');
  const pd = state.derived.payday;
  return `Hello,\n\nPlease change the Direct Debit on my account to my new bank account (${mainName}):\n${det}\n\nMy customer/account reference with you: [your reference]\n${pd ? `\nIf possible, please also move the payment date to the ${ord(Math.min(pd + 2, 28))} of each month.\n` : ''}\nPlease confirm the date of the first payment from the new account.\n\nThank you`;
}

function steps(r, k, mainName, fromName) {
  if (k === 'card') return [`Log in to ${r.name} (app or website) › payment details › add your ${mainName} debit card and make it the default.`, 'Remove the old card, so they can\'t fall back to it.', 'The next payment confirms it: the app ticks it off automatically.'];
  if (k === 'so') return [`In the ${mainName} app: new standing order for ${fmt(r.amount)} on the ${ord(r.day)}, same payee and reference as the old one.`, `Then cancel the old standing order in the ${fromName} app, so it isn't paid twice.`];
  if (k === 'dd') return [`Send ${r.name} the message below (their app, web chat or account page). They set up the new Direct Debit and cancel the old one.`, 'Don\'t cancel the old Direct Debit yourself: if the company hasn\'t switched yet, the payment fails.', 'It usually takes 1–2 payment cycles. Keep money in the old account until the first payment leaves the new one.'];
  return [`Check in the ${fromName} app how ${r.name} is paid (Direct Debit, standing order or card), then move it the same way.`];
}

export function render() {
  const s = state.settings;
  const accs = state.allAccounts || state.accounts;
  const main = s.mainAccountId || suggestedMain();
  const mainAcc = accs.find((a) => a.id === main);
  const mainName = mainAcc?.name || 'main account';
  const status = s.billsMoved || {};
  const flags = s.billFlags || {};
  const today = state.derived.today;
  const all = state.derived.recurring.filter((r) => r.active && r.direction === 'out' && (r.category !== 'transfer' || r.cardRepay) && !(s.billHidden || {})[r.key]);
  const byId = new Map((state.allTxs || state.txs).map((t) => [t.id, t]));
  // Confirmed: earlier payments came from elsewhere, the latest from the main account.
  const confirmed = all.filter((r) => r.accountId === main && (r.txIds || []).some((id) => { const t = byId.get(id); return t && t.accountId !== main; }));
  const toMove = all.filter((r) => r.accountId !== main);
  const stateOf = (r) => (flags[r.key] === 'cancel' || flags[r.key] === 'cancelled' ? 'cancel' : status[r.key] === true || status[r.key] === 'done' ? 'done' : status[r.key] || 'todo');
  const settled = toMove.filter((r) => ['done', 'cancel', 'leave'].includes(stateOf(r)));
  const asked = toMove.filter((r) => stateOf(r) === 'asked');
  const totalN = toMove.length + confirmed.length;
  const doneN = settled.length + confirmed.length;
  const monthlyIn = all.filter((r) => stateOf(r) !== 'cancel' && stateOf(r) !== 'leave').reduce((a, r) => a + r.amount, 0);
  const current = accs.filter((a) => a.type === 'current');
  const groups = {};
  for (const r of toMove) (groups[r.accountId || ''] ||= []).push(r);
  const hubs = HUBS.map(([re, label, how]) => [label, how, toMove.filter((r) => re.test(r.name + ' ' + (r.description || '')) && kindOf(r, accs.find((a) => a.id === r.accountId)) === 'card')]).filter(([, , l]) => l.length);
  const filterFn = (r) => ui.show === 'all' || (ui.show === 'todo' ? ['todo', 'asked'].includes(stateOf(r)) : !['todo', 'asked'].includes(stateOf(r)));

  const item = (r) => {
    const from = accs.find((a) => a.id === r.accountId);
    const k = kindOf(r, from);
    const st = stateOf(r);
    const h = helpFor(r.name);
    const soon = r.nextDue ? daysBetween(today, r.nextDue) : 99;
    return `<div class="move-item st-${st}">
      <div class="row between"><div class="grow"><b>${esc(r.name)}</b> <span class="muted">${fmt(r.amount)}/mo</span><div class="sub">${KIND_LABEL[k]} · ${esc(catName(r.category))} · next ${prettyDate(r.nextDue)}</div></div>
      ${st === 'done' ? '<span class="pill ok">✓ Moved</span>' : st === 'cancel' ? '<span class="pill">Cancelling</span>' : st === 'leave' ? '<span class="pill">Staying</span>' : st === 'asked' ? '<span class="pill warn">Asked</span>' : ''}</div>
      <div class="seg three mv-seg" role="radiogroup" aria-label="What to do with ${esc(r.name)}">${[['todo', 'Move'], ['cancel', 'Cancel'], ['leave', 'Leave']].map(([v, l]) => `<button role="radio" aria-checked="${(v === 'todo' ? ['todo', 'asked', 'done'].includes(st) : st === v)}" class="${(v === 'todo' ? ['todo', 'asked', 'done'].includes(st) : st === v) ? 'sel' : ''}" data-action="mv-set" data-key="${esc(r.key)}" data-v="${v}">${l}</button>`).join('')}</div>
      ${st === 'cancel' ? `<div class="row gap wrap"><button class="chip" data-action="bill-cancelhow" data-key="${esc(r.key)}">🚫 How to cancel</button>${h ? `<a class="chip" href="${esc(h.url)}" target="_blank" rel="noopener">${esc(h.label)} ↗</a>` : ''}</div>` : ''}
      ${['todo', 'asked'].includes(st) ? `
        ${soon <= 10 && k !== 'card' ? `<div class="cal-tip"><b>Due in ${soon} day${soon === 1 ? '' : 's'}</b><span>The change may not be in time: leave ${fmt(r.amount)} in ${esc(from?.name || 'the old account')} for this payment.</span></div>` : ''}
        <ol class="act-steps">${steps(r, k, mainName, from?.name || 'old account').map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
        ${k === 'dd' || k === 'unknown' ? `<details class="mv-msg"><summary>Message to send</summary><pre>${esc(message(r, mainName))}</pre><button class="chip sel" data-action="mv-copy" data-key="${esc(r.key)}">Copy message</button></details>` : ''}
        <div class="row gap wrap">${h ? `<a class="chip" href="${esc(h.url)}" target="_blank" rel="noopener">${esc(h.label)} account ↗</a>` : ''}${st === 'todo' && k === 'dd' ? `<button class="chip" data-action="mv-set" data-key="${esc(r.key)}" data-v="asked">I've asked them</button>` : ''}<button class="chip sel" data-action="mv-set" data-key="${esc(r.key)}" data-v="done">✓ Done</button></div>` : ''}
    </div>`;
  };

  return `<h1 class="page-title">Move bills to one account</h1>
  <div class="card hero">
    <div class="label">Sorted</div>
    <div class="big">${doneN}<small> of ${totalN}</small></div>
    <div class="cat-bar"><span style="width:${totalN ? ((doneN / totalN) * 100).toFixed(1) : 100}%"></span></div>
    <div class="sub">${asked.length ? `${asked.length} waiting for the company to switch · ` : ''}${confirmed.length ? `${confirmed.length} confirmed from ${esc(mainName)} · ` : ''}Once everything leaves one account, your budgets and bills calendar match one balance.</div>
  </div>
  <div class="card keep-open">
    <h3>1. Main account</h3>
    <label class="field select"><span>Everything moves to</span><select data-change="mb-main">${current.map((a) => `<option value="${esc(a.id)}" ${a.id === main ? 'selected' : ''}>${esc(a.name)}${ownerOf(a) === 'joint' ? ' · Joint' : state.settings.people.length > 1 ? ` · ${esc(personName(ownerOf(a)).split(' ')[0])}` : ''}</option>`).join('')}</select></label>
    <p class="sub">After the move it pays about <b>${fmt(monthlyIn, { whole: true })}</b> a month in regular payments.</p>
    <details class="checks"><summary>Your details for the messages (not saved)</summary>
      <p class="sub">Typed here, they fill in the messages below. They stay on screen only and are cleared when you close the app.</p>
      <label class="field"><span>Name on the account</span><input id="mv-name" value="${esc(mine.name)}" data-input="mv-det" data-id="name" autocomplete="off"></label>
      <div class="plan-grid"><label class="field"><span>Sort code</span><input id="mv-sort" value="${esc(mine.sort)}" inputmode="numeric" data-input="mv-det" data-id="sort" autocomplete="off" placeholder="00-00-00"></label>
      <label class="field"><span>Account number</span><input id="mv-acc" value="${esc(mine.acc)}" inputmode="numeric" data-input="mv-det" data-id="acc" autocomplete="off" placeholder="8 digits"></label></div>
    </details>
  </div>
  <div class="card">
    <h3>2. Decide first: move, cancel or leave</h3>
    <p class="sub">Don't move something you're about to cancel: that's double the work. For each payment pick <b>Move</b>, <b>Cancel</b> (adds it to your cancel list) or <b>Leave</b> (stays where it is, e.g. personal).</p>
    ${hubs.length ? `<div class="cal-tip"><b>Do these first: one change moves several</b>${hubs.map(([label, how, l]) => `<span><b>${esc(label)}</b> (${esc(l.map((r) => r.name).join(', '))}): ${esc(how)}</span>`).join('')}</div>` : ''}
    <div class="seg three" role="radiogroup" aria-label="Show">${[['todo', `To do (${toMove.length - settled.length})`], ['sorted', `Sorted (${settled.length})`], ['all', 'All']].map(([v, l]) => `<button role="radio" aria-checked="${ui.show === v}" class="${ui.show === v ? 'sel' : ''}" data-action="mv-show" data-v="${v}">${l}</button>`).join('')}</div>
  </div>
  ${toMove.length ? Object.entries(groups).sort((a, b) => b[1].length - a[1].length).map(([id, l]) => {
    const shown = l.filter(filterFn).sort((a, b) => b.amount - a.amount);
    if (!shown.length) return '';
    const left = l.filter((r) => ['todo', 'asked'].includes(stateOf(r)));
    return `<div class="card"><h3>From ${esc(id ? accountName(id) : 'an account not known')} <small class="muted">${left.length ? `${left.length} to go · ${fmt(left.reduce((a, r) => a + r.amount, 0), { whole: true })}/mo` : '✓ all sorted'}</small></h3>${shown.map(item).join('')}</div>`;
  }).join('') || `<div class="card"><p class="sub">${ui.show === 'todo' ? '✓ Nothing left to do. Payments still to leave the main account for the first time are ticked automatically once seen in your statements.' : 'Nothing here yet.'}</p></div>` : '<div class="card"><p class="sub">✓ Every regular payment already comes from your main account.</p></div>'}
  ${confirmed.length ? `<div class="card"><h3>Confirmed from ${esc(mainName)} <small class="muted">${confirmed.length}</small></h3>${confirmed.map((r) => `<div class="pt-row two"><span>✓ ${esc(r.name)}</span><b>${fmt(r.amount)}</b></div>`).join('')}<p class="sub">Seen leaving ${esc(mainName)} in your latest statement. Nothing more to do.</p></div>` : ''}
  <div class="card">
    <h3>3. After the move</h3>
    <ol class="act-steps"><li>Import ${esc(mainName)} statements each month: payments seen leaving it are confirmed here automatically.</li><li>A Direct Debit that fails during the switch shows as a "Not paid?" alert: pay it straight away.</li><li>Once an old account has had no payments for a month, cancel anything left on it and keep it at £0.</li><li>Then set budgets from one place: <a href="#/budget">Budget</a> uses these regular payments.</li></ol>
    <div class="act-links"><a class="act-link" href="#/bills">Bills & cancel list ›</a><a class="act-link" href="#/budget">Budget ›</a></div>
  </div>`;
}

async function setState(key, v) {
  const moved = { ...(state.settings.billsMoved || {}) };
  const flags = { ...(state.settings.billFlags || {}) };
  if (v === 'cancel') { flags[key] = 'cancel'; delete moved[key]; }
  else { if (flags[key] === 'cancel') delete flags[key]; if (v === 'todo') delete moved[key]; else moved[key] = v; }
  await saveSettings({ billsMoved: moved, billFlags: flags });
}

export const actions = {
  'mv-set': async (el, rerender) => { await setState(el.dataset.key, el.dataset.v); rerender(); if (el.dataset.v === 'done') toast('Ticked off: confirmed once seen in a statement'); },
  'mv-show': (el, rerender) => { ui.show = el.dataset.v; rerender(); },
  'mv-copy': async (el) => {
    const r = state.derived.recurring.find((x) => x.key === el.dataset.key);
    const main = state.settings.mainAccountId || suggestedMain();
    const text = message(r, (state.allAccounts || state.accounts).find((a) => a.id === main)?.name || 'main account');
    try { await navigator.clipboard.writeText(text); toast('Message copied'); } catch { if (navigator.share) await navigator.share({ text }).catch(() => {}); else toast('Select the text to copy it', { error: true }); }
  },
};
export const inputs = {
  'mv-det': (el) => {
    mine[el.dataset.id] = el.value.trim();
    // Refresh the open messages without redrawing the page (keeps the keyboard up).
    const main = state.settings.mainAccountId || suggestedMain();
    const name = (state.allAccounts || state.accounts).find((a) => a.id === main)?.name || 'main account';
    document.querySelectorAll('[data-action=mv-copy]').forEach((b) => { const r = state.derived.recurring.find((x) => x.key === b.dataset.key); const pre = b.parentElement.querySelector('pre'); if (r && pre) pre.textContent = message(r, name); });
  },
};
export const changes = {
  'mb-main': async (el, rerender) => { await saveSettings({ mainAccountId: el.value }); rerender(); toast('Main account set'); },
};
