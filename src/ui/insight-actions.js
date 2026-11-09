// Tap an insight: what to do about it, the payments involved, and where to go or who to call.
import { state, saveSettings, accountName, recompute } from '../state.js';
import { esc, openSheet, closeSheet, toast } from './dom.js';
import { fmt } from '../lib/money.js';
import { catName } from '../lib/categories.js';
import { monthKey, prettyDate, addMonths, monthLabel, daysInMonth } from '../lib/dates.js';
import { HELP, helpFor } from '../lib/directory.js';
import { guideFor, LINKS } from '../lib/guides.js';

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

/** Your numbers for a category: where the money went this month and the last 6 months. */
function catData(cat, month) {
  const mtx = state.txs.filter((t) => t.category === cat && monthKey(t.date) === month && t.amount < 0);
  const by = {};
  for (const t of mtx) { const k = t.merchant || t.description; (by[k] ||= { n: 0, v: 0 }); by[k].n++; by[k].v -= t.amount; }
  const top = Object.entries(by).sort((a, b) => b[1].v - a[1].v).slice(0, 6);
  const months = Array.from({ length: 6 }, (_, i) => addMonths(month, i - 5)).filter((m) => state.derived.months.includes(m));
  const vals = months.map((m) => state.txs.filter((t) => t.category === cat && monthKey(t.date) === m).reduce((a, t) => a - t.amount, 0));
  const max = Math.max(1, ...vals);
  return `${top.length ? `<h3>Where it went · ${esc(monthLabel(month, { short: true }))}</h3><div class="act-item">${top.map(([m, x]) => `<div class="row between"><span class="grow ellipsis">${esc(m)} <small class="muted">${x.n}×</small></span><b>${fmt(x.v)}</b></div>`).join('')}</div>` : ''}
    ${months.length > 1 ? `<h3>Last ${months.length} months</h3><div class="act-item">${months.map((m, i) => `<div class="mini-bar static"><span>${esc(monthLabel(m, { short: true }))}</span><span class="mb-track"><i style="width:${((Math.max(0, vals[i]) / max) * 100).toFixed(1)}%;background:var(--accent)"></i></span><b>${fmt(vals[i], { whole: true })}</b></div>`).join('')}</div>` : ''}
    <button class="btn ghost full" data-action="dash-cat" data-cat="${esc(cat)}">📊 Chart and every transaction</button>`;
}
const round10 = (p) => Math.ceil(p / 1000) * 1000;

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
    steps.push('Why it matters: bills on a credit card add to a balance that charges interest if it isn\'t cleared in full, and make the card harder to pay off.', 'For each one below, open the company\'s app or account page → payment details → replace the card with your main debit card.', 'Check next month\'s card statement to make sure it moved.', 'Once nothing regular is on the card, take it out of Apple Pay so it only gets used deliberately.');
    cta = go('#/cards', 'Credit card payoff plan');
    extra.push(paymentList(recurringIn((r) => state.accounts.find((a) => a.id === r.accountId)?.type === 'credit')));
  } else if (id === 'fees') {
    steps.push('Bounced Direct Debits cost a fee each time AND can show as a missed payment on your credit file. Make sure each bill comes from an account that has the money on that day.', 'Move bill dates to just after payday: ask each company to change the collection date (most do it online).', 'Turn on low-balance alerts in each bank app.', 'Ask the bank to refund recent fees as a one-off goodwill gesture: many will, especially the first time.', 'Card interest: pay more than the minimum on the highest-rate card (Aqua) once every card is under its limit.');
    cta = go('#/movebills', 'Move bills to one account');
  } else if (/^(over|up|down)-/.test(id)) {
    const cat = id.replace(/^(over|up|down)-/, '');
    const g = guideFor(cat);
    const good = id.startsWith('down-');
    const line = state.derived.budget.byCategory?.[cat];
    const avg = i.average ?? line?.hist ?? 0;
    const base = i.live ? i.pace : i.current;
    if (good) {
      if (i.live) steps.push(`You're ${Math.round((state.derived.today.slice(8) / daysInMonth(month)) * 100)}% through the month, so this is your pace, not the final number. Check again at month end.`);
      steps.push(`Lock it in: set your ${catName(cat)} budget to about ${fmt(round10(base || 0), { whole: true })} (button below), so you get a warning if it creeps back up.`);
      if (avg && base != null && avg > base) steps.push(`Move the difference, about ${fmt(round10(avg - base), { whole: true })} a month, into savings on payday with a standing order. Money left in the current account tends to get spent elsewhere.`);
      steps.push(...g.keep);
      steps.push('Worth knowing what changed: if it was a one-off (holiday, fewer shops), expect it to bounce back next month.');
    } else {
      if (id.startsWith('over-') && line?.budget) steps.push(`You're over your ${fmt(line.budget, { whole: true })} budget. Either cut back for the rest of the month or, if the budget was unrealistic, raise it and cut somewhere else.`);
      steps.push(...g.cut);
    }
    if (cat === 'bills') links.push(HELP.compare, HELP.socialTariffs, HELP.ofgemSwitch, HELP.councilTax);
    links.push(...g.links.map((k) => LINKS[k]).filter(Boolean));
    if (!good) links.push(LINKS.moneyhelperBudget);
    const target = good ? round10(base || 0) : round10(avg || base || 0);
    extra.push(catData(cat, month));
    if (target > 0) extra.push(`<div class="act-item"><b>${good ? 'Keep it at this level' : 'Set a realistic limit'}</b><div class="sub">${line?.budget ? `Budget now ${fmt(line.budget, { whole: true })}. ` : 'No budget yet. '}${good ? 'Use your new level as the budget.' : `Your 3-month average is ${fmt(avg, { whole: true })}.`}</div>
      <div class="row gap wrap"><button class="chip sel" data-action="act-budget" data-cat="${esc(cat)}" data-amt="${target}">Set budget to ${fmt(target, { whole: true })}</button>${good || !avg ? '' : `<button class="chip" data-action="act-budget" data-cat="${esc(cat)}" data-amt="${round10(avg * 0.85)}">Aim 15% lower: ${fmt(round10(avg * 0.85), { whole: true })}</button>`}</div></div>`);
    if (cat === 'subscriptions') extra.push(paymentList(recurringIn((r) => r.category === 'subscriptions')));
    cta = go('#/track', good ? 'See all budgets' : 'My path to living within my means');
  } else if (id === 'subs' || id === 'streaming' || id === 'music') {
    steps.push('Keep one streaming service at a time and rotate monthly: you lose nothing by cancelling and re-joining.', 'Cancel anything you haven\'t used in the last month.', 'Apple charges: check iPhone Settings → your name → Subscriptions.');
    extra.push(paymentList(recurringIn((r) => ['subscriptions', 'entertainment', 'fitness'].includes(r.category))));
    cta = go('#/bills', 'All bills and subscriptions');
  } else if (id.startsWith('rise-')) {
    const r = state.derived.recurring.find((x) => 'rise-' + x.key === id);
    steps.push('Check your contract end date in their app or account page.', 'Compare what new customers pay (link below), so you know a fair price.', 'Call or chat and say: "My price has gone up. I\'m comparing alternatives; what\'s the best price you can offer to keep me?"', 'Out of contract? You can usually switch with no fee, and the new provider often handles the switch.', 'Still in contract? Check whether the rise was set out in your contract. If it wasn\'t, you may be able to leave without an exit fee: ask them.');
    if (r) extra.push(paymentList([r]));
    links.push(HELP.compare);
  } else if (id === 'consolidate') {
    steps.push('Choose one main account that your pay goes into, and move every bill there.', 'The step-by-step guide shows each bill, where it comes from now, and how to move it.');
    cta = go('#/movebills', 'Move my bills step by step');
  } else if (id === 'rate' && i.level === 'good') {
    steps.push('Move what\'s left to savings now, before it drifts: set a standing order for the day after payday.', 'First goal: an emergency fund of 3 months of essential spending, in an easy-access account.', 'Then: pay off the highest-rate card, then save for goals (house deposit: a Lifetime ISA adds 25% for first-time buyers).');
    links.push(LINKS.emergency, LINKS.isa);
    cta = go('#/goals', 'Set up a savings goal');
  } else if (id === 'rate') {
    const cmpRows = state.derived.budget.lines.filter((l) => l.kind !== 'fixed' && l.hist > 0).map((l) => ({ c: l.category, v: state.txs.filter((t) => t.category === l.category && monthKey(t.date) === month).reduce((a, t) => a - t.amount, 0), avg: l.hist })).filter((x) => x.v > x.avg).sort((a, b) => (b.v - b.avg) - (a.v - a.avg)).slice(0, 3);
    steps.push('Pay yourself first: set a standing order to savings for the day after payday, even £50. What\'s left is what you can spend.', cmpRows.length ? `Start with what grew most this month: ${cmpRows.map((x) => `${catName(x.c)} ${fmt(x.v, { whole: true })} (usually ${fmt(x.avg, { whole: true })})`).join(', ')}.` : 'Look at your three biggest flexible categories first.', 'Set a budget for each of those (tap a category in Insights for one-tap budgets).', 'The On track page lists actions with the £ each saves, so you can see the path back to living within your means.', 'If you\'re falling behind on bills or debts, free and confidential help is below.');
    links.push(LINKS.moneyhelperBudget);
    links.push(HELP.stepchange, HELP.moneyhelper);
    cta = go('#/track', 'My path to living within my means');
  } else if (id === 'food' || id === 'small') {
    steps.push('Set an eating-out budget for the month and check the per-day allowance before you buy.', 'Batch-cook twice a week and take lunch to work.', 'Delete saved cards from delivery apps so ordering takes effort.', ...guideFor('takeaway').cut.slice(1, 3));
    links.push(LINKS.bbcBudget, LINKS.lfhw, LINKS.tgtg);
    cta = go('#/track', 'Set my budgets');
  } else if (id.startsWith('new-')) {
    steps.push('Check it\'s expected. If it\'s a transfer between your own accounts or the wrong category, change it in Transactions.', 'If you don\'t recognise it, freeze the card in your bank app and call the number on the back of the card. Don\'t use numbers from texts or emails.', 'A big one-off (flights, a holiday, a repair)? Next time, save for it monthly in a separate pot so it doesn\'t land on one month.', 'A new subscription? Put it on your cancel list now if it was a trial.');
    links.push(LINKS.travelSaving);
    cta = go('#/transactions', 'Open transactions');
  }
  if (!steps.length) steps.push('Look at the details and decide what to change.');
  openSheet(`<h2>${esc(i.title)}</h2>
    <p class="muted">${esc(i.detail || '')}</p>
    ${i.saving > 0 && i.level !== 'good' ? `<div class="pill save">Could save ~${fmt(i.saving, { whole: true })}/month</div>` : ''}
    <h3>${i.level === 'good' ? 'How to keep it up' : 'What to do, step by step'}</h3><ol class="act-steps">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    ${extra.join('')}
    ${links.length ? `<h3>Where to go</h3><div class="act-links">${links.map(link).join('')}</div>` : ''}
    ${cta}
    <button class="btn ghost full" data-action="ins-ask-q" data-q="${esc(`About "${i.title}" (${i.detail}): what exactly should we do, step by step, and how much could it save?`)}">✨ Ask Claude about this</button>
    <button class="btn ghost full" data-action="close-sheet">Done</button>`, { wide: true });
}

export const insightActions = {
  'act-budget': async (el) => {
    const amt = +el.dataset.amt, cat = el.dataset.cat;
    await saveSettings({ budgets: { ...(state.settings.budgets || {}), [cat]: amt } });
    recompute();
    el.closest('.row')?.querySelectorAll('.chip').forEach((c) => c.classList.remove('sel'));
    el.classList.add('sel'); el.textContent = `✓ Budget ${fmt(amt, { whole: true })}`;
    toast(`${catName(cat)} budget set to ${fmt(amt, { whole: true })}`);
  },
  'act-flag': async (el) => {
    const flags = { ...(state.settings.billFlags || {}) };
    flags[el.dataset.key] = flags[el.dataset.key] === 'cancel' ? undefined : 'cancel';
    await saveSettings({ billFlags: flags });
    el.classList.toggle('sel'); el.textContent = flags[el.dataset.key] === 'cancel' ? '✓ On my cancel list' : '＋ Add to cancel list';
    toast(flags[el.dataset.key] === 'cancel' ? 'Added to your cancel list (Bills)' : 'Removed from cancel list');
  },
};

export { closeSheet, HELP, link as helpLink };
