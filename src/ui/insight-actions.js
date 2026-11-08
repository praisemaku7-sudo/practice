// Tap an insight: what to do about it, the payments involved, and where to go or who to call.
import { state, saveSettings, accountName } from '../state.js';
import { esc, openSheet, closeSheet, toast } from './dom.js';
import { fmt } from '../lib/money.js';
import { catName, catKind } from '../lib/categories.js';
import { monthKey, prettyDate } from '../lib/dates.js';
import { HELP, helpFor } from '../lib/directory.js';

const link = (h) => `<a class="act-link" href="${esc(h.url)}" target="_blank" rel="noopener">${esc(h.name || h.label)} ↗</a>${h.tel ? `<a class="act-tel" href="tel:${esc(h.tel.replace(/\s+/g, ''))}">📞 ${esc(h.tel)}</a>` : ''}`;
const go = (href, label) => `<a class="btn primary full" href="${esc(href)}" data-action="close-sheet-go" data-to="${esc(href.replace('#/', ''))}">${esc(label)}</a>`;

/** Regular payments, each with how to cancel/manage it and a "mark to cancel" button. */
function paymentList(rows) {
  const flags = state.settings.billFlags || {};
  return rows.map((r) => {
    const h = helpFor(r.name);
    return `<div class="act-item"><div class="row between"><b class="grow">${esc(r.name)}</b><b>${fmt(r.amount)}/mo</b></div>
      <div class="sub">${esc(catName(r.category))} · from ${esc(accountName(r.accountId))}${r.nextDue ? ` · next ${prettyDate(r.nextDue)}` : ''}</div>
      ${h ? `<div class="sub">${esc(h.how)}</div><a class="act-link" href="${esc(h.url)}" target="_blank" rel="noopener">Manage ${esc(h.label)} ↗</a>` : '<div class="sub">Cancel in the company\'s app or website, or ask your bank to cancel the Direct Debit.</div>'}
      <button class="chip ${flags[r.key] === 'cancel' ? 'sel' : ''}" data-action="act-flag" data-key="${esc(r.key)}">${flags[r.key] === 'cancel' ? '✓ On my cancel list' : '＋ Add to cancel list'}</button></div>`;
  }).join('');
}

const recurringIn = (pred) => state.derived.recurring.filter((r) => r.active && r.direction === 'out' && pred(r));

export function openInsight(i) {
  const id = i.id || '';
  const steps = [], extra = [], links = [];
  let cta = '';
  const month = state.month || monthKey(state.derived.today);
  if (id === 'card-spend') {
    steps.push('Make your debit card the default in Apple Wallet: Wallet → your debit card → ⋯ → Make default (or drag it to the front).', 'Take the credit cards out of Apple Pay and saved shop accounts (Amazon, Uber, apps) so they can\'t be used by accident.', 'Move any regular payments off the cards (below) to your main debit card.', 'Turn on spending notifications in each card\'s app.');
    extra.push(paymentList(recurringIn((r) => state.accounts.find((a) => a.id === r.accountId)?.type === 'credit')));
    cta = go('#/cards', 'Credit card payoff plan');
  } else if (id === 'card-recurring') {
    steps.push('For each one, update the payment card in the company\'s account to your main debit card.', 'Then check next month\'s card statement to make sure it moved.');
    extra.push(paymentList(recurringIn((r) => state.accounts.find((a) => a.id === r.accountId)?.type === 'credit')));
  } else if (id === 'fees') {
    steps.push('Bounced Direct Debits cost a fee each time AND can show as a missed payment on your credit file. Make sure each bill comes from an account that has the money on that day.', 'Move bill dates to just after payday: ask each company to change the collection date (most do it online).', 'Turn on low-balance alerts in each bank app.', 'Ask the bank to refund recent fees as a one-off goodwill gesture: many will, especially the first time.', 'Card interest: pay more than the minimum on the highest-rate card (Aqua) once every card is under its limit.');
    cta = go('#/movebills', 'Move bills to one account');
  } else if (id.startsWith('over-') || id.startsWith('up-')) {
    const cat = id.replace(/^(over|up)-/, '');
    const mtx = state.txs.filter((t) => t.category === cat && monthKey(t.date) === month && t.amount < 0);
    const by = {};
    for (const t of mtx) by[t.merchant] = (by[t.merchant] || 0) - t.amount;
    const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (cat === 'bills') {
      steps.push('Check each bill: anything out of contract can usually be cut by asking for a better price, or by switching.', 'Mobile: out of contract → SIM-only is typically £8–£15 a month.', 'Energy: check you\'re on the cheapest tariff and give meter readings.', 'Council tax: if you\'re on a low income you may get a reduction.', 'Not a bill? If something here is a transfer to your own account, change its category: tap it in Transactions.');
      links.push(HELP.compare, HELP.socialTariffs, HELP.ofgemSwitch, HELP.councilTax);
    } else if (cat === 'subscriptions' || catKind(cat) === 'personal') {
      steps.push(cat === 'eating_out' || cat === 'takeaway' ? 'Plan 2 nights out (or takeaways) a week and cook the rest: the per-day allowance in On track keeps you honest.' : 'Decide what to keep this month and pause the rest.', 'Check the biggest ones below first.');
      if (cat === 'subscriptions') extra.push(paymentList(recurringIn((r) => r.category === 'subscriptions')));
    } else steps.push('Look at the biggest payments below and decide which you can cut or delay.');
    if (top.length) extra.push(`<div class="act-item"><b>Biggest this month</b>${top.map(([m, v]) => `<div class="row between"><span class="grow">${esc(m)}</span><b>${fmt(v)}</b></div>`).join('')}</div>`);
    cta = go('#/track', 'See my budgets and plan');
  } else if (id === 'subs' || id === 'streaming' || id === 'music') {
    steps.push('Keep one streaming service at a time and rotate monthly: you lose nothing by cancelling and re-joining.', 'Cancel anything you haven\'t used in the last month.', 'Apple charges: check iPhone Settings → your name → Subscriptions.');
    extra.push(paymentList(recurringIn((r) => ['subscriptions', 'entertainment', 'fitness'].includes(r.category))));
    cta = go('#/bills', 'All bills and subscriptions');
  } else if (id.startsWith('rise-')) {
    const r = state.derived.recurring.find((x) => 'rise-' + x.key === id);
    steps.push('Call or chat and say: "My price has gone up. I\'m comparing alternatives; what\'s the best price you can offer to keep me?"', 'Out of contract? You can usually switch with no fee.');
    if (r) extra.push(paymentList([r]));
    links.push(HELP.compare);
  } else if (id === 'consolidate') {
    steps.push('Choose one main account that your pay goes into, and move every bill there.', 'The step-by-step guide shows each bill, where it comes from now, and how to move it.');
    cta = go('#/movebills', 'Move my bills step by step');
  } else if (id === 'rate') {
    steps.push('Spending is above income. The On track page lists actions with the £ each one saves, so you can see the path back to living within your means.', 'If you\'re falling behind on bills or debts, free and confidential help is below.');
    links.push(HELP.stepchange, HELP.moneyhelper);
    cta = go('#/track', 'My path to living within my means');
  } else if (id === 'food' || id === 'small') {
    steps.push('Set an eating-out budget for the month and check the per-day allowance before you buy.', 'Batch-cook twice a week and take lunch to work.', 'Delete saved cards from delivery apps so ordering takes effort.');
    cta = go('#/track', 'Set my budgets');
  } else if (id.startsWith('new-')) {
    steps.push('Check it\'s expected. If it\'s a transfer between your own accounts or the wrong category, change it in Transactions.', 'If you don\'t recognise it, call your bank using the number on the back of your card.');
    cta = go('#/transactions', 'Open transactions');
  }
  if (!steps.length) steps.push('Look at the details and decide what to change.');
  openSheet(`<h2>${esc(i.title)}</h2>
    <p class="muted">${esc(i.detail || '')}</p>
    ${i.saving > 0 && i.level !== 'good' ? `<div class="pill save">Could save ~${fmt(i.saving, { whole: true })}/month</div>` : ''}
    <h3>What to do</h3><ol class="act-steps">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    ${extra.join('')}
    ${links.length ? `<h3>Where to go</h3><div class="act-links">${links.map(link).join('')}</div>` : ''}
    ${cta}
    <button class="btn ghost full" data-action="close-sheet">Done</button>`, { wide: true });
}

export const insightActions = {
  'act-flag': async (el) => {
    const flags = { ...(state.settings.billFlags || {}) };
    flags[el.dataset.key] = flags[el.dataset.key] === 'cancel' ? undefined : 'cancel';
    await saveSettings({ billFlags: flags });
    el.classList.toggle('sel'); el.textContent = flags[el.dataset.key] === 'cancel' ? '✓ On my cancel list' : '＋ Add to cancel list';
    toast(flags[el.dataset.key] === 'cancel' ? 'Added to your cancel list (Bills)' : 'Removed from cancel list');
  },
};

export { closeSheet, HELP, link as helpLink };
