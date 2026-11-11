// The move, in one place: who's earning (plan on one income or both), your month now vs when the
// mortgage starts vs when the fix ends, the levers ranked by £ a month, one-income help, and a
// mortgage summary with the dates that matter.
import { state, saveSettings } from '../state.js';
import { esc, toast } from './dom.js';
import { fmt } from '../lib/money.js';
import { catKind, isSpendCategory } from '../lib/categories.js';
import { householdFor } from '../lib/income.js';
import { monthKey, monthLabel, prettyDate, addDays, addMonths, daysBetween } from '../lib/dates.js';
import { schedule } from '../lib/mortgage.js';
import { live, income, personIncome } from './afford-extras.js';

const first = (n) => esc(String(n || '').split(' ')[0]);
const sum = (l, f = (x) => x.amount) => l.reduce((a, x) => a + (f(x) || 0), 0);
const d = (x) => (x ? `${prettyDate(x)} ${x.slice(0, 4)}` : '');

/** Who's earning in the plan: everyone (null) or a list of people. */
export const earners = () => state.settings.earners || null;
export const isOneIncome = () => { const e = earners(); return !!e && e.length < state.settings.people.length; };

export function scenarioBar() {
  const people = state.settings.people;
  if (people.length < 2) return '';
  const e = earners();
  const opts = [['all', 'Both incomes'], ...people.map((p) => [p.id, `${first(p.name)} only`])];
  const cur = !e ? 'all' : e.length === 1 ? e[0] : 'all';
  const h = householdFor(state.settings, monthKey(state.derived.today));
  const both = h.total || people.reduce((a, p) => a + personIncome(p.id, h), 0) || state.derived.budget.income || 0;
  return `<div class="card scen keep-open"><div class="label">Plan on</div><div class="seg ${opts.length === 3 ? 'three' : 'scroll'}" role="radiogroup" aria-label="Whose income to plan on">${opts.map(([v, l]) => `<button role="radio" aria-checked="${cur === v}" class="${cur === v ? 'sel' : ''}" data-action="earners-set" data-v="${esc(v)}">${l}</button>`).join('')}</div>
    <div class="sub">${cur === 'all' ? `Both take-home incomes: ${fmt(both, { whole: true })} a month.` : `${income() ? `Only ${first(people.find((p) => p.id === cur)?.name)}'s income: <b>${fmt(income(), { whole: true })}</b> a month (both: ${fmt(both, { whole: true })}). Used across On track and Future planning.` : `<span class="warn-text">No income found for ${first(people.find((p) => p.id === cur)?.name)}.</span> Add their pay in <a href="#/income">Income</a>, or mark which accounts are theirs in <a href="#/accounts">Accounts</a>.`}`}</div></div>`;
}

/** Mortgage figures: from the illustration when there is one, else the plan. */
function mortgageNow() {
  const m = state.settings.mortgage || {};
  const e = state.settings.esis;
  const principal = m.principal ?? (m.price && m.deposit != null ? m.price - m.deposit : null);
  if (!principal || !m.rate) return null;
  const sc = schedule({ principal, rate: m.rate, termYears: m.termYears || 25, fixedYears: m.fixedYears, followRate: m.followRate, interestOnly: m.interestOnly, startMonth: m.startMonth });
  const fixEnd = e?.fixedUntil || (m.fixedYears && m.startMonth ? `${addMonths(m.startMonth, Math.round(m.fixedYears * 12))}-01` : null);
  return { m, e, principal, pay: e?.payFixed ?? sc.payment, after: e?.payAfter ?? sc.afterFix?.payment ?? null, fixEnd, start: m.startMonth, sc };
}

/**
 * Everyday spending as it really is: a typical month (the middle of the last three complete months)
 * of everything that isn't a regular payment, split into essentials and everything else.
 * Falls back to your budgets when there's no full month yet.
 */
function everyday() {
  const d = state.derived;
  const cur = monthKey(d.today);
  const regular = new Set(d.recurring.flatMap((r) => [...(r.txIds || []), ...(r.dupIds || [])]));
  const past = (d.months || []).filter((m) => m < cur);
  const complete = past.filter((m) => !d.incomplete?.has(m)).slice(-3);
  const use = complete.length ? complete : past.slice(-3);
  if (!use.length) {
    const lines = d.budget?.lines || [];
    return { ess: sum(lines.filter((l) => catKind(l.category) === 'essential'), (l) => l.budget), other: sum(lines.filter((l) => !['fixed', 'essential'].includes(catKind(l.category)) && !['transfer', 'savings', 'debt', 'income'].includes(l.category)), (l) => l.budget), months: [], budget: true };
  }
  const per = use.map((m) => {
    let ess = 0, other = 0;
    for (const t of state.txs) {
      if (!t.date.startsWith(m) || t.amount >= 0 || regular.has(t.id) || t.cardRepay || !isSpendCategory(t.category)) continue;
      if (catKind(t.category) === 'essential') ess -= t.amount; else other -= t.amount;
    }
    return { ess, other };
  });
  const mid = (k) => { const v = per.map((x) => x[k]).sort((a, b) => a - b); return v[(v.length - 1) >> 1]; };
  return { ess: mid('ess'), other: mid('other'), months: use, complete: complete.length > 0 };
}

export function moveCard() {
  const mo = mortgageNow();
  const inc = income();
  if (!inc) return '';
  const items = live();
  const rent = sum(items.filter((r) => r.category === 'housing'));
  const debtSt = sum(items.filter((r) => r.category === 'debt' || r.cardRepay));
  const app = state.settings.mortgageApp;
  const declared = app ? sum(app.applicants.flatMap((a) => a.debts).filter((x) => !/student/i.test(x.type)), (x) => x.monthly) : 0;
  const debt = Math.max(debtSt, declared);
  const bills = sum(items) - rent - debtSt;
  const ev = everyday();
  const { ess, other } = ev;
  const cols = [['Now', 'renting', rent]];
  if (mo) cols.push([mo.start ? monthLabel(mo.start, { short: true }) : 'Mortgage', 'mortgage starts', mo.pay]);
  if (mo?.after) cols.push([mo.fixEnd ? monthLabel(mo.fixEnd.slice(0, 7), { short: true }) : 'After fix', 'fix ends, if no new deal', mo.after]);
  const left = (h) => inc - h - bills - debt - ess - other;
  const tone = (v) => (v < 0 ? 'neg' : v < inc * 0.1 ? 'warn-text' : 'pos');
  const word = (v) => (v < 0 ? 'Short' : v < inc * 0.1 ? 'Tight' : 'Works');
  const cell = (v, cls = '') => `<span class="${cls}">${fmt(v, { whole: true })}</span>`;
  const row = (label, vals, cls = '') => `<div class="mv-row ${cls}"><span>${label}</span>${vals.join('')}</div>`;
  const main = cols[cols.length > 1 ? 1 : 0];
  const lv = left(main[2]);
  const housePct = Math.round((main[2] / inc) * 100);
  return `<div class="card mv-card keep-open">
    <h3>Can we afford the move?</h3>
    <div class="mv-verdict ${tone(lv)}"><b>${word(lv)}</b><span>${mo ? `With the mortgage, about <b>${fmt(lv, { whole: true, sign: true })}</b> a month is left after everything${isOneIncome() ? ' on one income' : ''}. The mortgage takes ${housePct}% of take-home.` : `Today, about <b>${fmt(lv, { whole: true, sign: true })}</b> a month is left after everything${isOneIncome() ? ' on one income' : ''}; rent takes ${housePct}% of take-home. Add your mortgage in <a href="#/plan">Future planning</a> (or upload the illustration) to see the month after the move.`}</span></div>
    <div class="mv-grid" style="--cols:${cols.length}">
      ${row('', cols.map(([h, s]) => `<span class="mv-h"><b>${esc(h)}</b><small>${esc(s)}</small></span>`), 'head')}
      ${row('Take-home', cols.map(() => cell(inc, 'pos')))}
      ${row('Rent / mortgage', cols.map(([, , h]) => cell(-h)))}
      ${row('Bills & regular payments', cols.map(() => cell(-bills)))}
      ${row(`Cards & loans${declared > debtSt ? ' <small>as declared</small>' : ''}`, cols.map(() => cell(-debt)))}
      ${row('Food, travel, essentials <small>typical month</small>', cols.map(() => cell(-ess)))}
      ${row('Everything else <small>typical month</small>', cols.map(() => cell(-other)))}
      ${row('Left each month', cols.map(([, , h]) => `<span class="${tone(left(h))}"><b>${fmt(left(h), { whole: true, sign: true })}</b></span>`), 'total')}
      <div class="mv-row bars"><span></span>${cols.map(([, , h]) => { const v = left(h); return `<span><i class="mv-bar ${tone(v)}" style="width:${Math.max(4, Math.min(100, Math.abs(v / inc) * 300)).toFixed(0)}%"></i></span>`; }).join('')}</div>
    </div>
    <p class="sub">${ev.budget ? 'Everyday spending from your <a href="#/budget">budgets</a> until a full month is imported.' : `Everyday spending is your typical month (${ev.months.map((m) => monthLabel(m, { short: true }).split(' ')[0]).join(', ')}), not your <a href="#/budget">budget</a>.`}</p></div>`;
}

/** What moves the number most, ranked by £ a month, each with where to act. */
export function leversCard() {
  const items = live();
  const s = state.settings, d0 = state.derived;
  const inc = income();
  const flags = s.billFlags || {};
  const out = [];
  const mo = mortgageNow();
  const rent = sum(items.filter((r) => r.category === 'housing'));
  if (mo && rent && mo.pay < rent) out.push({ v: rent - mo.pay, good: true, t: `The mortgage replaces rent: ${fmt(rent - mo.pay, { whole: true })} a month better`, s: `${fmt(mo.pay, { whole: true })} instead of ${fmt(rent, { whole: true })}. Keep that difference as a buffer for the first months rather than spending it.` });
  const cancel = state.derived.recurring.filter((r) => flags[r.key] === 'cancel');
  if (cancel.length) out.push({ v: sum(cancel), t: `Finish your cancel list: ${fmt(sum(cancel), { whole: true })} a month`, s: cancel.map((r) => r.name).slice(0, 4).join(', '), href: '#/bills', go: 'Cancel list' });
  const subs = items.filter((r) => ['subscriptions', 'entertainment', 'fitness', 'personal_care'].includes(r.category) && flags[r.key] !== 'cancel');
  if (subs.length >= 3) out.push({ v: Math.round(sum(subs) * 0.4), t: `Subscriptions: ${fmt(sum(subs), { whole: true })} a month across ${subs.length}`, s: 'Most households can drop a third or more. Untick what you\'d not miss in the audit.', href: '#/bills', go: 'Audit' });
  const debts = items.filter((r) => r.category === 'debt' || r.cardRepay).sort((a, b) => b.amount - a.amount);
  if (debts[0] && debts[0].amount >= 15000) out.push({ v: debts[0].amount, t: `Biggest commitment: ${debts[0].name} ${fmt(debts[0].amount, { whole: true })} a month`, s: 'Ask for a settlement figure. Clearing or reducing it is usually the largest single monthly saving, and lenders count it against what you can borrow.', href: '#/cards', go: 'Debts' });
  if ((d0.cards?.totalOwed || 0) > 0) out.push({ v: Math.round(d0.cards.totalOwed * 0.03), t: `Clear ${fmt(d0.cards.totalOwed, { whole: true })} on cards before you complete`, s: 'Lower balances help the mortgage offer and free the minimum payments. Pay the highest rate first.', href: '#/cards', go: 'Payoff plan' });
  if (mo?.after && mo.fixEnd) out.push({ v: mo.after - mo.pay, t: `Book your next deal from ${d(addDays(mo.fixEnd, -182))}`, s: `Or pay ${fmt(mo.after - mo.pay, { whole: true })} a month more from ${d(mo.fixEnd)} on the standard rate. Put a reminder in your calendar now.` });
  // Emergency fund on the income you're planning on.
  const need = sum(items) + everyday().ess;  // bills plus typical essentials
  const saved = state.accounts.filter((a) => a.type === 'savings' && !a.excluded).reduce((x, a) => x + Math.max(0, a.balance || 0), 0);
  if (need && saved < need * 3) out.push({ v: Math.round((need * 3 - saved) / 12), t: `Emergency fund: ${saved ? `${(saved / need).toFixed(1)} months` : 'none yet'}, aim for 3`, s: `${fmt(need * 3, { whole: true })} covers 3 months of bills and essentials${isOneIncome() ? ': with one income this matters more' : ''}. ${fmt(Math.round((need * 3 - saved) / 12), { whole: true })} a month gets you there in a year.`, href: '#/goals', go: 'Make it a goal' });
  if (!out.length) return '';
  out.sort((a, b) => (b.good ? 1 : 0) - (a.good ? 1 : 0) || b.v - a.v);
  return `<div class="card"><h3>What moves the number most</h3>
    ${out.slice(0, 7).map((x, i) => `<div class="lever ${x.good ? 'good' : ''}"><span class="lv-n">${x.good ? '✓' : i + (out[0].good ? 0 : 1)}</span><div class="grow"><b>${esc(x.t)}</b><div class="sub">${esc(x.s)}</div></div>${x.href ? `<a class="chip" href="${x.href}">${esc(x.go)} ›</a>` : ''}</div>`).join('')}
    ${inc ? `<p class="sub">Ranked by £ a month. Each £100 a month is ${Math.round((10000 / inc) * 100)}% of take-home.</p>` : ''}</div>`;
}

/** Living on one income: what to claim, protect and tell the lender. */
export function oneIncomeCard() {
  if (!isOneIncome()) return '';
  const app = state.settings.mortgageApp;
  const earning = app ? app.applicants.filter((a) => (a.gross || a.seLatest || 0) > 0).length : 0;
  const tips = [];
  if (app && earning > 1) tips.push(['bad', 'Tell your broker before you exchange', 'Your application counts both incomes. If one of you won\'t go back to work, the lender has to reassess on one income: finding out later can cancel the offer, and the form asks you to declare expected changes.']);
  tips.push(['', 'Claim Child Benefit in the name of the parent at home', 'It gives them National Insurance credits towards their State Pension while not working. Claim even if the earner\'s income means the payment is taxed back: you can opt out of the payment and keep the credits.']);
  tips.push(['', 'Child Benefit tax above £60,000', 'If the earner\'s adjusted net income is over £60,000, Child Benefit is taxed back gradually (all of it at £80,000). Pension contributions lower adjusted net income, so paying more into a pension can keep more of it.']);
  tips.push(['', 'Marriage Allowance (basic-rate earners only)', 'If the earner pays only basic-rate tax, the partner at home can transfer £1,260 of their Personal Allowance: up to £252 a year. Not available if the earner pays 40% tax.']);
  tips.push(['', 'Protect the one income', 'Life cover for the mortgage, and income protection for the earner: with one income, illness or redundancy hits everything. Check what the employer already provides first.']);
  tips.push(['', 'The pension of the partner at home', 'Contributions stop with no earnings. Up to £2,880 a year can still go into a personal pension for them, topped up by the government to £3,600.']);
  return `<div class="card"><h3>Living on one income</h3>
    ${tips.map(([cls, t, s]) => `<div class="cal-tip ${cls}"><b>${esc(t)}</b><span>${esc(s)}</span></div>`).join('')}
    <div class="act-links"><a class="act-link" href="https://www.gov.uk/child-benefit" target="_blank" rel="noopener">Child Benefit ↗</a><a class="act-link" href="https://www.gov.uk/marriage-allowance" target="_blank" rel="noopener">Marriage Allowance ↗</a><a class="act-link" href="#/income">Income ›</a></div></div>`;
}

/** Future planning: the mortgage at a glance, with the dates that matter. */
export function mortgageHero() {
  const mo = mortgageNow();
  if (!mo) return '';
  const today = state.derived.today;
  const inc = income();
  const e = mo.e;
  const endMonth = mo.start ? addMonths(mo.start, Math.round((mo.m.termYears || 25) * 12)) : null;
  const dates = [
    mo.start && [`${mo.start}-01`, 'Mortgage starts', 'Rent stops; first full payment the month after'],
    ...(e?.ercs || []).slice(-1).map((x) => [x.to, 'Early repayment charges end', 'Free to remortgage or repay without charges after this']),
    mo.fixEnd && [addDays(mo.fixEnd, -182), 'Choose your next deal', 'Lenders usually let you lock in a rate about 6 months ahead'],
    mo.fixEnd && [mo.fixEnd, 'Fixed rate ends', mo.after ? `${fmt(mo.after, { whole: true })} a month on the standard rate if you do nothing` : 'Payment changes'],
    endMonth && [`${endMonth}-01`, 'Mortgage-free', `${mo.m.termYears} years from the start${mo.m.overpay ? ', sooner with your overpayments' : ''}`],
  ].filter(Boolean).sort((a, b) => a[0].localeCompare(b[0]));
  const left = mo.fixEnd ? daysBetween(today, mo.fixEnd) : null;
  return `<div class="card mh-card keep-open">
    <div class="mh-top"><div><span class="label">${esc(e?.lender || 'Your mortgage')}</span><div class="mh-pay">${fmt(mo.pay, { whole: true })}<small>/month</small></div>
      <div class="sub">${mo.m.rate}% ${mo.fixEnd ? `fixed until ${esc(d(mo.fixEnd))}` : ''} · ${fmt(mo.principal, { whole: true })} over ${mo.m.termYears} years</div></div>
      ${inc ? `<div class="mh-ring" style="--p:${Math.min(100, Math.round((mo.pay / inc) * 100))}"><b>${Math.round((mo.pay / inc) * 100)}%</b><small>of take-home${isOneIncome() ? ' (one income)' : ''}</small></div>` : ''}</div>
    ${left != null && left > 0 ? `<div class="sub">${Math.floor(left / 30.4)} months of fixed payments ahead${e ? '' : ' (from your plan)'}.</div>` : ''}
    <div class="mh-dates">${dates.map(([dt, t, s]) => `<div class="mh-date ${dt < today ? 'past' : ''}"><i></i><div><b>${esc(t)}</b><span>${esc(d(dt))} · ${esc(s)}</span></div></div>`).join('')}</div>
    <div class="act-links"><a class="act-link" href="#/track">Can we afford it? ›</a>${e ? '' : '<label for="esis-file" class="act-link">Upload illustration for exact figures</label>'}</div></div>`;
}

export const movePlanActions = {
  'earners-set': async (el, rerender) => {
    const v = el.dataset.v;
    await saveSettings({ earners: v === 'all' ? null : [v] });
    toast(v === 'all' ? 'Planning on both incomes' : 'Planning on one income'); rerender();
  },
};
