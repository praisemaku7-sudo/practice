// Affording rent or a mortgage and the bills on your income: commitments vs income, fair shares
// of joint bills, a subscription audit with a "what if I cancel" simulator, cancel-list savings,
// emergency-fund runway, a payday split plan, contract end dates, price history, mortgage
// readiness, and a summary to share with a mortgage broker.
import { state, saveSettings, ownerOf } from '../state.js';
import { esc, toast, shareFile } from './dom.js';
import { fmt } from '../lib/money.js';
import { catKind, catName } from '../lib/categories.js';
import { householdFor } from '../lib/income.js';
import { monthKey, monthLabel, prettyDate, daysBetween, nextDayOfMonth, addDays } from '../lib/dates.js';

const SUBS = new Set(['subscriptions', 'entertainment', 'fitness', 'personal_care']);
const ui = { off: {} }; // the "what if I cancel" simulator: keys switched off (not saved)
const live = () => {
  const flags = state.settings.billFlags || {}, hidden = state.settings.billHidden || {};
  return state.derived.recurring.filter((r) => r.active && r.direction === 'out' && (r.category !== 'transfer' || r.cardRepay) && !hidden[r.key] && flags[r.key] !== 'cancelled');
};
const income = () => householdFor(state.settings, monthKey(state.derived.today)).total || state.derived.budget.income || 0;

/** 1. What your fixed commitments take from your income, and what's left to live on. */
export function commitmentsCard() {
  const inc = income();
  if (!inc) return '';
  const items = live();
  const housing = items.filter((r) => r.category === 'housing').reduce((a, r) => a + r.amount, 0);
  const debt = items.filter((r) => r.category === 'debt' || r.cardRepay).reduce((a, r) => a + r.amount, 0);
  const bills = items.reduce((a, r) => a + r.amount, 0) - housing - debt;
  const total = housing + bills + debt;
  const left = inc - total;
  const pct = (v) => Math.round((v / inc) * 100);
  const tone = pct(total) <= 50 ? 'pos' : pct(total) <= 65 ? 'warn-text' : 'neg';
  const days = 30;
  return `<div class="card keep-open"><h3>Can our income carry our commitments?</h3>
    <div class="cm-split"><span class="h" style="flex:${housing}"></span><span class="b" style="flex:${bills}"></span><span class="d" style="flex:${debt || 0.0001}"></span><span class="l" style="flex:${Math.max(0, left)}"></span></div>
    <div class="cm-legend"><span><i class="h"></i>Rent/mortgage ${fmt(housing, { whole: true })} · ${pct(housing)}%</span><span><i class="b"></i>Bills ${fmt(bills, { whole: true })} · ${pct(bills)}%</span><span><i class="d"></i>Cards & loans ${fmt(debt, { whole: true })} · ${pct(debt)}%</span><span><i class="l"></i>Left ${fmt(left, { whole: true })}</span></div>
    <p class="sub"><b class="${tone}">Commitments take ${pct(total)}% of take-home (${fmt(inc, { whole: true })})</b>. That leaves <b class="${left < 0 ? 'neg' : ''}">${fmt(left, { whole: true })}</b> a month, about ${fmt(Math.max(0, left) / days, { whole: true })} a day, for food, travel and everything else. ${pct(total) > 65 ? 'Above 65% is very tight: one bill going up or a missed pay day tips the month over.' : pct(total) > 50 ? 'Over half: manageable, but keep a buffer.' : 'Under half: a healthy position.'}</p>
    <div class="act-links"><a class="act-link" href="#/bills">Bills ›</a><a class="act-link" href="#/plan">Rent vs mortgage ›</a></div></div>`;
}

/** 2. Fair share of joint bills, in proportion to each person's income. */
export function fairShareCard() {
  const people = state.settings.people;
  if (people.length < 2) return '';
  const byId = Object.fromEntries((state.allAccounts || state.accounts).map((a) => [a.id, a]));
  const joint = live().filter((r) => ownerOf(byId[r.accountId]) === 'joint');
  const total = joint.reduce((a, r) => a + r.amount, 0);
  if (!total) return '';
  const h = householdFor(state.settings, monthKey(state.derived.today));
  const per = people.map((p) => ({ p, inc: h.lines.filter((l) => l.who === p.id).reduce((a, l) => a + l.monthly, 0) }));
  const sum = per.reduce((a, x) => a + x.inc, 0) || 1;
  return `<div class="card"><h3>Who pays what into the joint account</h3>
    <p class="sub">Joint bills come to <b>${fmt(total, { whole: true })}</b> a month. Split by income, so each of you keeps a similar share of what you earn:</p>
    ${per.map((x) => `<div class="pt-row two"><span>${esc(x.p.name.split(' ')[0])} <small class="muted">${x.inc ? `earns ${fmt(x.inc, { whole: true })}` : 'income not set'}</small></span><b>${fmt(Math.round((total * x.inc) / sum / 100) * 100, { whole: true })}/mo</b></div>`).join('')}
    <p class="sub">Or half each: ${fmt(Math.round(total / 2 / 100) * 100, { whole: true })}. Set a standing order for the day after payday so the bills are always covered.</p>
    <a class="act-link" href="#/income">Check incomes ›</a></div>`;
}

/** 3 + 4. Subscription audit with a live "what if I cancel" total, and savings already made. */
export function subsAuditCard() {
  const subs = live().filter((r) => SUBS.has(r.category)).sort((a, b) => b.amount - a.amount);
  const flags = state.settings.billFlags || {};
  const cancelled = state.derived.recurring.filter((r) => flags[r.key] === 'cancelled');
  const savedMo = cancelled.reduce((a, r) => a + r.amount, 0);
  if (!subs.length && !savedMo) return '';
  const off = subs.filter((r) => ui.off[r.key]);
  const offSum = off.reduce((a, r) => a + r.amount, 0);
  const total = subs.reduce((a, r) => a + r.amount, 0);
  return `<div class="card"><h3>Subscription audit</h3>
    ${savedMo ? `<div class="cal-tip"><b class="pos">Saving ${fmt(savedMo, { whole: true })} a month (${fmt(savedMo * 12, { whole: true })} a year)</b><span>From ${cancelled.length} payment${cancelled.length > 1 ? 's' : ''} you've cancelled: ${esc(cancelled.map((r) => r.name).join(', '))}.</span></div>` : ''}
    ${subs.length ? `<p class="sub">${subs.length} subscriptions · ${fmt(total, { whole: true })} a month · <b>${fmt(total * 12, { whole: true })} a year</b>. Untick any you could live without to see the difference:</p>
    ${subs.map((r) => `<label class="check-row sub-row"><input type="checkbox" data-change="aud-toggle" data-key="${esc(r.key)}" ${ui.off[r.key] ? '' : 'checked'}><span class="grow">${esc(r.name)} <small class="muted">${esc(catName(r.category))}</small></span><b>${fmt(r.amount)}</b><small class="muted">${fmt(r.amount * 12, { whole: true })}/yr</small></label>`).join('')}
    ${off.length ? `<div class="cal-tip"><b>Cancelling ${off.length} would free ${fmt(offSum, { whole: true })} a month · ${fmt(offSum * 12, { whole: true })} a year</b><span>Your month-end and safe-to-spend would each improve by that much.</span><button class="chip sel" data-action="aud-commit">Add ${off.length} to my cancel list</button></div>` : ''}` : ''}
  </div>`;
}

/** 5. How many months savings would cover bills and essentials if income stopped. */
export function runwayCard() {
  const saved = state.accounts.filter((a) => a.type === 'savings' && !a.excluded).reduce((x, a) => x + Math.max(0, a.balance || 0), 0);
  const b = state.derived.budget;
  const need = b.lines.filter((l) => ['fixed', 'essential'].includes(catKind(l.category))).reduce((a, l) => a + l.budget, 0);
  if (!need) return '';
  const months = saved / need;
  return `<div class="card"><h3>Emergency fund</h3>
    <div class="stat-grid"><div><span class="label">In savings</span><b>${fmt(saved, { whole: true })}</b></div><div><span class="label">Covers bills & essentials for</span><b class="${months < 1 ? 'neg' : months < 3 ? 'warn-text' : 'pos'}">${months < 1 ? `${Math.round(months * 30)} days` : `${months.toFixed(1)} months`}</b></div></div>
    <p class="sub">The usual aim is 3 months of bills and essentials (${fmt(need * 3, { whole: true })}), kept in an easy-access account. ${months < 3 ? `About ${fmt(Math.max(0, need * 3 - saved), { whole: true })} to go: even £50 a month by standing order builds it.` : 'You\'re covered: keep it separate from spending.'}</p>
    <a class="act-link" href="#/goals">Make it a savings goal ›</a></div>`;
}

/** 6. On payday: how to split the pay so bills, savings and spending are each covered. */
export function paydaySplitCard() {
  const d = state.derived, inc = income();
  if (!inc || !d.payday) return '';
  const next = nextDayOfMonth(addDays(d.today, 1), d.payday);
  const bills = live().reduce((a, r) => a + r.amount, 0);
  const save = d.budget.savingsTarget || 0, pay = d.budget.cardPayoff || 0;
  const spend = Math.max(0, inc - bills - save - pay);
  const weekly = Math.round(spend / 4.3);
  return `<div class="card"><h3>Payday plan · ${esc(prettyDate(next))}</h3>
    <p class="sub">The day pay lands, move it straight away so each job has its own money:</p>
    <div class="pt-row two"><span>🏠 Bills account (rent, bills, cards)</span><b>${fmt(bills, { whole: true })}</b></div>
    ${save ? `<div class="pt-row two"><span>🐷 Savings</span><b>${fmt(save, { whole: true })}</b></div>` : ''}
    ${pay ? `<div class="pt-row two"><span>💳 Extra card payoff</span><b>${fmt(pay, { whole: true })}</b></div>` : ''}
    <div class="pt-row two total"><span>🛒 Spending (about ${fmt(weekly, { whole: true })} a week)</span><b class="${spend ? '' : 'neg'}">${fmt(spend, { whole: true })}</b></div>
    <p class="sub">${spend ? 'Standing orders on payday make this automatic.' : 'Bills and savings take everything: lower the savings goal for now or cut a bill first.'}</p></div>`;
}

/** 7. Contracts ending soon (dates you set on a bill), for the Bills tips and notifications. */
export function contractsEnding(days = 60) {
  const edits = state.settings.recurringEdits || {};
  const today = state.derived.today;
  return state.derived.recurring.filter((r) => edits[r.key]?.contractEnd).map((r) => ({ r, end: edits[r.key].contractEnd, left: daysBetween(today, edits[r.key].contractEnd) })).filter((x) => x.left <= days && x.left >= -30).sort((a, b) => a.left - b.left);
}

/** 9. How a bill's amount has changed over the payments seen. */
export function priceHistory(r) {
  const all = state.allTxs || state.txs;
  const rows = (r.txIds || []).map((id) => all.find((t) => t.id === id)).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length < 2) return '';
  const first = Math.abs(rows[0].amount), last = Math.abs(rows[rows.length - 1].amount);
  if (first === last) return `<div class="sub">Same amount since ${prettyDate(rows[0].date)} ${rows[0].date.slice(0, 4)}.</div>`;
  const pc = Math.round(((last - first) / first) * 100);
  return `<div class="sub ${pc > 0 ? 'warn-text' : 'pos'}">${pc > 0 ? 'Up' : 'Down'} ${Math.abs(pc)}% since ${prettyDate(rows[0].date)} ${rows[0].date.slice(0, 4)} (${fmt(first)} → ${fmt(last)}).</div>`;
}

/** 8. Mortgage readiness: what lenders look at, from your own data. */
export function readinessCard() {
  const d = state.derived, s = state.settings, m = s.mortgage || {};
  const inc = income();
  const owed = d.cards.totalOwed || 0;
  const limits = state.accounts.filter((a) => a.type === 'credit').reduce((x, a) => x + (a.limit ?? a.details?.limit ?? 0), 0);
  const use = limits ? owed / limits : null;
  const since = addDays(d.today, -92);
  const fees = state.txs.filter((t) => t.date >= since && t.amount < 0 && (t.category === 'fees' || /\b(LATE|RETURNED|UNPAID|OVERDRAFT)\b/i.test(t.description)));
  const gambling = state.txs.filter((t) => t.date >= since && /\b(BET365|BETFAIR|PADDY ?POWER|SKY ?BET|WILLIAM HILL|LADBROKES|CORAL|BETFRED|888|POKERSTARS|LOTTERY|GAMBL)\b/i.test(t.description));
  const slips = Object.values(s.payslipHistory || {}).reduce((a, l) => Math.max(a, l.length), 0);
  const deposit = m.price && m.deposit != null ? m.deposit / m.price : null;
  const borrow = m.principal || (m.price && m.deposit != null ? m.price - m.deposit : null);
  const checks = [
    [deposit != null ? deposit >= 0.1 : null, deposit != null ? `Deposit ${Math.round(deposit * 100)}% of the price${deposit < 0.1 ? ': most lenders want at least 10%, or 5% with fewer deals' : ''}` : 'Add the price and deposit in Future planning'],
    [borrow && inc ? borrow <= inc * 12 * 4.5 * 1.25 : null, borrow && inc ? `Borrowing ${fmt(borrow, { whole: true })}: lenders usually lend 4–4.5× gross income` : 'Add the mortgage amount to check'],
    [use != null ? use <= 0.3 : owed === 0 ? true : null, use != null ? `Cards ${Math.round(use * 100)}% of limits used (under 30% helps)` : owed ? 'Add your card limits to check how much is used' : 'No card balances ✓'],
    [fees.length === 0, fees.length ? `${fees.length} late, returned-payment or overdraft charges in the last 3 months: lenders read statements for these` : 'No late or overdraft charges in 3 months'],
    [gambling.length === 0, gambling.length ? `${gambling.length} gambling payments in 3 months: lenders often ask about these` : 'No gambling payments'],
    [slips >= 3, slips >= 3 ? '3 months of payslips imported' : `Import 3 recent payslips (you have ${slips})`],
  ];
  const done = checks.filter(([ok]) => ok === true).length;
  return `<div class="card"><h3>Mortgage readiness <small class="pill ${done >= 5 ? 'ok' : 'warn'}">${done}/${checks.length}</small></h3>
    ${checks.map(([ok, t]) => `<div class="check-line ${ok === true ? 'ok' : ok === false ? 'bad' : ''}">${ok === true ? '✓' : ok === false ? '✗' : '–'} ${esc(t)}</div>`).join('')}
    <p class="sub">Lenders usually ask for 3 months of payslips and bank statements, and check your credit file. Fix the ✗ items in the months before you apply.</p>
    <button class="btn ghost full" data-action="aff-broker">Share a summary with a mortgage broker</button></div>`;
}

/** 10. Plain summary of income and commitments for a mortgage broker or adviser. */
function brokerText() {
  const inc = income();
  const items = live();
  const sumC = (f) => items.filter(f).reduce((a, r) => a + r.amount, 0);
  const h = householdFor(state.settings, monthKey(state.derived.today));
  const m = state.settings.mortgage || {};
  return [
    `Household finances: ${monthLabel(monthKey(state.derived.today))}`, '',
    'Take-home income (monthly):', ...h.lines.filter((l) => l.monthly).map((l) => `• ${l.name}: ${fmt(l.monthly, { whole: true })}`), `Total: ${fmt(inc, { whole: true })}`, '',
    'Regular commitments (monthly):', `• Rent/mortgage: ${fmt(sumC((r) => r.category === 'housing'), { whole: true })}`, `• Bills and subscriptions: ${fmt(sumC((r) => !['housing', 'debt'].includes(r.category) && !r.cardRepay), { whole: true })}`, `• Credit cards and loans: ${fmt(sumC((r) => r.category === 'debt' || r.cardRepay), { whole: true })}`,
    `Credit card balances: ${fmt(state.derived.cards.totalOwed || 0, { whole: true })}`, '',
    m.price ? `Looking at: ${fmt(m.price, { whole: true })} property, ${fmt(m.deposit || 0, { whole: true })} deposit, ${m.termYears || 25}-year term` : '', 'From Pocket Ledger (statements and payslips).',
  ].filter((x) => x !== '').join('\n');
}

export const affordActions = {
  'aud-commit': async (_, rerender) => {
    const flags = { ...(state.settings.billFlags || {}) };
    for (const k of Object.keys(ui.off)) if (ui.off[k]) flags[k] = 'cancel';
    ui.off = {};
    await saveSettings({ billFlags: flags }); toast('Added to your cancel list'); rerender();
  },
  'aff-broker': async () => {
    const t = brokerText();
    if (navigator.share) { try { await navigator.share({ title: 'Household finances', text: t }); return; } catch (e) { if (e?.name === 'AbortError') return; } }
    await shareFile('household-finances.txt', t, 'text/plain'); toast('Summary ready');
  },
};
export const affordChanges = {
  'aud-toggle': (el, rerender) => { ui.off[el.dataset.key] = !el.checked; rerender(); },
};
