// Bills calendar: every regular payment and payday on a month grid, your balance day by day so a
// bounce shows up before it happens, tips for moving dates, reminders, and a cancel list.
import { state, saveSettings, accountName, recompute } from '../../state.js';
import { esc, openSheet, closeSheet, toast, shareFile } from '../dom.js';
import { fmt, parsePrice } from '../../lib/money.js';
import { catKind, catName, CAT } from '../../lib/categories.js';
import { monthKey, monthLabel, daysInMonth, prettyDate, addMonths, nextDayOfMonth } from '../../lib/dates.js';
import { helpFor } from '../../lib/directory.js';
import { billsCalendar } from '../../lib/ics.js';
import { monthItems, balanceForecast, paidThisMonth, weekTotals, dayIn } from '../../lib/cashflow.js';
import { likelyNewRegular } from '../../lib/analysis.js';
import { catChip, emptyState } from '../common.js';
import { addBillsToCalendar } from './due.js';
import { fairShareCard, subsAuditCard, contractsEnding, priceHistory } from '../afford-extras.js';
import { changesCard, overlapsCard, fundAccountsCard, billTrendCard, yearlyPotCard, billNoteHtml } from '../bills-extras.js';
import { ord } from '../../lib/util.js';

const SUBS = new Set(['subscriptions', 'entertainment', 'fitness', 'personal_care']);
const FLAG_LABEL = { cancel: 'To cancel', cancelled: 'Cancelled' };
const FILTERS = [['all', 'All'], ['bills', 'Bills'], ['subs', 'Subscriptions'], ['debt', 'Cards & loans'], ['in', 'Income']];
const ui = { month: null, filter: 'all', view: 'cal', per: 'mo' };
let ctx = null; // what the last render computed, for the sheets

const short = (p) => (Math.abs(p) >= 100000 ? `£${(p / 100000).toFixed(1).replace('.0', '')}k` : `£${Math.round(p / 100)}`);
const matches = (r, f) => f === 'all' ? true : f === 'in' ? r.direction === 'in' : r.direction === 'out' && (f === 'subs' ? SUBS.has(r.category) : f === 'debt' ? r.category === 'debt' || r.cardRepay : !SUBS.has(r.category) && r.category !== 'debt' && !r.cardRepay);

export function applyParams(params) {
  if (params.get('month')) ui.month = params.get('month');
}

/** Balance to forecast from: fresh current-account balances, else the latest ones we have. */
function startBalance() {
  const cur = state.accounts.filter((a) => a.type === 'current' && a.balance != null);
  if (!cur.length) return null;
  const today = state.derived.today;
  const fresh = cur.filter((a) => a.balanceDate && (Date.parse(today) - Date.parse(a.balanceDate)) / 86400000 <= 10);
  const use = fresh.length ? fresh : cur;
  return { amount: use.reduce((a, x) => a + x.balance, 0), stale: !fresh.length, accounts: use };
}

export function render() {
  const { recurring, today, payday } = state.derived;
  const all = recurring.filter((r) => (r.category !== 'transfer' || r.cardRepay));
  if (!all.length) return emptyState({ title: 'Bills & subscriptions', body: 'Regular payments appear here once two months of statements are imported. You can also add one yourself.' }) + '<button class="btn primary full" data-action="bill-add">＋ Add a regular payment</button>';
  const s = state.settings;
  const flags = s.billFlags || {};
  const hidden = s.billHidden || {};
  const thisMonth = monthKey(today);
  const month = ui.month || thisMonth;
  const live = all.filter((r) => !hidden[r.key] && flags[r.key] !== 'cancelled');
  const shown = live.filter((r) => matches(r, ui.filter));
  const paid = paidThisMonth(live, state.txs, month, s.billPaid);
  const byDay = monthItems({ month, recurring: shown, today, paidKeys: paid, accountEnd: state.derived.accountEnd });
  const allByDay = monthItems({ month, recurring: live, today, paidKeys: paid, accountEnd: state.derived.accountEnd });
  const out = live.filter((r) => r.direction === 'out' && r.active);
  const monthOut = [...allByDay.values()].flat().filter((x) => x.dir === 'out');
  const totalOut = monthOut.reduce((a, x) => a + x.r.amount, 0);
  const paidOut = monthOut.filter((x) => x.status === 'paid').reduce((a, x) => a + x.r.amount, 0);
  const nextPay = payday ? nextDayOfMonth(today, payday) : null;
  const beforePay = nextPay ? out.filter((r) => r.nextDue >= today && r.nextDue < nextPay && !paid.has(r.key)).reduce((a, r) => a + r.amount, 0) : null;

  // Balance forecast to the end of the month on screen (or next payday, whichever is later).
  const sb = startBalance();
  const endOfView = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
  const until = nextPay && nextPay > endOfView ? nextPay : endOfView;
  const fc = sb && month >= thisMonth ? balanceForecast({ start: sb.amount, today, until, recurring: live, paidKeys: paid }) : null;
  const balOn = new Map((fc?.rows || []).map((r) => [r.date, r.balance]));
  const danger = (fc?.rows || []).filter((r) => r.balance < 0 && r.outflow > 0);
  ctx = { month, byDay: allByDay, paid, balOn, live, sb, fc };

  // Calendar grid.
  const [y, m] = month.split('-').map(Number);
  const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push('<span class="cal-cell cal-blank" aria-hidden="true"></span>');
  for (let d = 1; d <= daysInMonth(month); d++) {
    const items = byDay.get(d) || [];
    const outs = items.filter((x) => x.dir === 'out');
    const ins = items.filter((x) => x.dir === 'in');
    const sum = outs.reduce((a, x) => a + x.r.amount, 0);
    const date = dayIn(month, d);
    const st = outs.length ? (outs.every((x) => x.status === 'paid') ? 'paid' : outs.some((x) => x.status === 'late' || x.status === 'missed') ? 'late' : month > thisMonth ? 'upcoming' : 'due') : '';
    const bal = balOn.get(date);
    const isDanger = bal != null && bal < 0 && outs.length;
    const cls = `cal-cell ${date === today ? 'today' : ''} ${st} ${isDanger ? 'danger' : ''} ${ins.length ? 'payday' : ''}`;
    const inner = `<i>${d}</i>${sum ? `<small>${short(sum)}</small>` : ''}${ins.length ? '<b class="cal-pay" aria-hidden="true"></b>' : ''}${isDanger ? '<b class="cal-warn" aria-hidden="true">!</b>' : ''}`;
    const label = `${d} ${monthLabel(month)}: ${items.map((x) => `${x.r.name} ${fmt(x.r.amount)}`).join(', ')}${isDanger ? '. Balance could go below zero' : ''}`;
    cells.push(items.length || bal != null ? `<button class="${cls}" data-action="cal-day" data-d="${d}" aria-label="${esc(label)}">${inner}</button>` : `<span class="${cls}">${inner}</span>`);
  }

  // Insights.
  const tips = [];
  if (danger.length) {
    const first = danger[0];
    const need = -Math.min(...danger.map((r) => r.balance));
    tips.push(`<div class="cal-tip bad"><b>⚠ ${prettyDate(first.date)}: your balance could go to ${fmt(first.balance, { whole: true })}</b><span>${esc(first.items.filter((r) => r.direction === 'out').map((r) => r.name).join(', '))} leave${first.items.length === 1 ? 's' : ''} before ${nextPay && nextPay > first.date ? `payday (${prettyDate(nextPay)})` : 'enough comes in'}. Move about <b>${fmt(Math.ceil(need / 1000) * 1000, { whole: true })}</b> into ${esc(sb.accounts.length === 1 ? sb.accounts[0].name : 'the paying account')} by ${prettyDate(first.date)}, or ask to move the date. A bounced Direct Debit costs a fee and can be reported as a missed payment.</span>
      <div class="row gap wrap"><button class="chip" data-action="cal-day" data-d="${+first.date.slice(8)}">See that day</button><a class="chip" href="#/movebills">Move bills guide</a></div></div>`);
  }
  if (payday) {
    const pre = out.filter((r) => r.category !== 'fees' && !/\b(LATE|FEE|CHARGE|INTEREST)\b/i.test(r.name) && ((r.day < payday && r.day >= payday - 7) || (payday <= 7 && r.day > 21 + payday)));
    const preSum = pre.reduce((a, r) => a + r.amount, 0);
    if (pre.length && preSum > 2000) tips.push(`<div class="cal-tip"><b>${fmt(preSum, { whole: true })} of bills leave in the week before payday</b><span>${esc(pre.sort((a, b) => b.amount - a.amount).slice(0, 3).map((r) => `${r.name} (${ord(r.day)})`).join(', '))}. Moving them to the ${ord(Math.min(payday + 2, 28))} means they're paid from fresh pay. Most companies let you change the date online; make sure the first payment on the new date doesn't land before your pay arrives.</span><button class="chip" data-action="bill-movetips">How to move a date</button></div>`);
  }
  const lateFees = out.filter((r) => r.category === 'fees' || /\b(LATE|OVERLIMIT|OVER LIMIT|RETURNED|UNPAID)\b.*\b(FEE|CHARGE)\b|\bLATE FEE\b/i.test(r.name));
  if (lateFees.length) tips.unshift(`<div class="cal-tip bad"><b>⚠ You're paying fees most months: ${fmt(lateFees.reduce((a, r) => a + r.amount, 0), { whole: true })} a month</b><span>${esc(lateFees.map((r) => `${r.name} (around the ${ord(r.day)})`).join(', '))}. Late and returned-payment fees are avoidable and are often reported as missed payments on your credit file. Set up a Direct Debit for at least the minimum on each card, make sure the paying account has the money on that day, and ask the card company to refund recent fees.</span><a class="chip" href="#/cards">Card payoff plan ›</a></div>`);
  const weeks = weekTotals(allByDay, month);
  const busiest = weeks.reduce((a, w) => (w.out > a.out ? w : a), weeks[0]);
  if (busiest?.count >= 2) tips.push(`<div class="cal-tip"><b>Busiest week: ${busiest.from === busiest.to ? busiest.from : `${busiest.from}–${busiest.to}`} ${esc(monthLabel(month, { short: true }).split(' ')[0])}</b><span>${fmt(busiest.out, { whole: true })} across ${busiest.count} payment${busiest.count > 1 ? 's' : ''}. Keep that much in the account the week before.</span></div>`);
  const rises = out.filter((r) => r.priceChange > 0);
  if (rises.length) tips.push(`<div class="cal-tip"><b>${rises.length} price rise${rises.length > 1 ? 's' : ''}</b><span>${esc(rises.map((r) => `${r.name} +${fmt(r.priceChange)}`).join(', '))}. Out of contract? Ask for a better price or switch.</span><a class="chip" href="#/insights">Ways to cut</a></div>`);
  const main = s.mainAccountId;
  const offMain = main ? out.filter((r) => r.accountId && r.accountId !== main).length : 0;
  if (offMain) tips.push(`<div class="cal-tip"><b>${offMain} bill${offMain > 1 ? 's' : ''} come from other accounts</b><span>One account for every bill means one balance to watch.</span><a class="chip" href="#/movebills">Move bills ›</a></div>`);
  for (const c of contractsEnding()) tips.unshift(`<div class="cal-tip ${c.left <= 14 ? 'bad' : ''}"><b>${esc(c.r.name)} contract ${c.left < 0 ? `ended ${-c.left} days ago` : `ends in ${c.left} days`}</b><span>Out of contract prices usually go up. Compare deals now and ask them to match: <a href="https://www.uswitch.com/" target="_blank" rel="noopener">Uswitch ↗</a></span><button class="chip" data-action="bill-open" data-key="${esc(c.r.key)}">Details</button></div>`);
  if (!sb) tips.push('<div class="cal-tip"><b>Want bounce warnings?</b><span>Import a recent current-account statement: the app reads the closing balance and forecasts it day by day.</span><a class="chip" href="#/import">Import</a></div>');

  // Forecast chart.
  const fcChart = fc && fc.rows.length > 1 ? (() => {
    const W = 320, H = 96, vals = fc.rows.map((r) => r.balance), lo = Math.min(0, ...vals), hi = Math.max(0, ...vals), span = hi - lo || 1;
    const x = (i) => 4 + (i / (fc.rows.length - 1)) * (W - 8), yv = (v) => H - 6 - ((v - lo) / span) * (H - 14);
    const d = fc.rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${yv(r.balance).toFixed(1)}`).join(' ');
    return `<svg class="fc-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Balance forecast">
      <line x1="0" x2="${W}" y1="${yv(0)}" y2="${yv(0)}" class="fc-zero"/><path d="${d}" class="fc-line"/>
      ${fc.rows.map((r, i) => (r.outflow || r.inflow ? `<circle cx="${x(i)}" cy="${yv(r.balance)}" r="4" class="${r.balance < 0 ? 'fc-neg' : r.inflow ? 'fc-in' : 'fc-out'}" data-action="cal-date" data-date="${r.date}" role="button" aria-label="${prettyDate(r.date)}: ${fmt(r.balance, { whole: true })}"/>` : '')).join('')}</svg>`;
  })() : '';

  // List view, week by week.
  const list = weeks.map((w) => {
    const items = [];
    for (let d = w.from; d <= w.to; d++) for (const it of byDay.get(d) || []) items.push({ ...it, d });
    if (!items.length) return '';
    return `<div class="wk"><div class="wk-head"><b>${w.from}–${w.to} ${esc(monthLabel(month, { short: true }).split(' ')[0])}</b><span class="muted">${fmt(items.filter((x) => x.dir === 'out').reduce((a, x) => a + x.r.amount, 0), { whole: true })} out</span></div>
      ${items.map((x) => `<button class="list-row tap" data-action="bill-open" data-key="${esc(x.r.key)}">${catChip(x.r.category)}<div class="grow"><div class="ellipsis">${esc(x.r.name)}</div><div class="sub">${ord(x.d)} · ${esc(x.r.type)} · <span class="st-${x.status}">${x.status === 'paid' ? '✓ paid' : x.status === 'late' ? 'not seen yet' : x.status}</span></div></div><b class="${x.dir === 'in' ? 'pos' : ''}">${x.dir === 'in' ? '+' : ''}${fmt(x.r.amount)}</b></button>`).join('')}</div>`;
  }).join('') || '<p class="sub">Nothing in this month for this filter.</p>';

  // Sections below.
  const bills = out.filter((r) => ['fixed', 'essential'].includes(catKind(r.category)) || r.category === 'debt' || r.cardRepay);
  const subs = out.filter((r) => SUBS.has(r.category));
  const other = out.filter((r) => !bills.includes(r) && !subs.includes(r));
  const toCancel = all.filter((r) => flags[r.key] === 'cancel');
  const yr = ui.per === 'yr';
  const row = (r) => {
    const f = flags[r.key];
    return `<div class="list-row ${f === 'cancelled' ? 'struck' : ''}">${catChip(r.category)}
      <button class="grow plain" data-action="bill-open" data-key="${esc(r.key)}"><div class="ellipsis">${esc(r.name)} ${r.priceChange > 0 ? `<small class="pill warn">+${fmt(r.priceChange)}</small>` : ''}${r.manual ? ' <small class="pill">added by you</small>' : ''}</div>
      <div class="sub">${esc(r.type)} · ${r.direction === 'in' ? 'arrives' : paid.has(r.key) && month === thisMonth ? 'paid this month' : 'next'} ${prettyDate(r.nextDue)} · ${yr ? `${fmt(r.amount)}/mo` : `${fmt(r.amount * 12, { whole: true })}/yr`}</div></button>
      <div class="bill-right"><b>${yr ? fmt(r.amount * 12, { whole: true }) : fmt(r.amount)}</b>${r.direction === 'out' ? `<button class="flag ${f || ''}" data-action="bill-flag" data-key="${esc(r.key)}">${FLAG_LABEL[f] || 'Keep'}</button>` : ''}</div></div>`;
  };
  const section = (title, l) => (l.length ? `<div class="card"><h3>${title} <small class="muted">${fmt(l.reduce((a, r) => a + r.amount, 0) * (yr ? 12 : 1), { whole: true })}${yr ? '/yr' : '/mo'}</small></h3>${l.map(row).join('')}</div>` : '');
  const hiddenList = all.filter((r) => hidden[r.key]);

  return `
  <h1 class="page-title">Bills</h1>
  ${(() => { const d = all.filter((r) => r.dupIds?.length); return d.length ? `<div class="card banner bad"><b>${d.length} regular payment${d.length > 1 ? 's were' : ' was'} counted twice</b><span class="sub">${d.map((r) => `${esc(r.name)} (${(r.dupIds || []).length} cop${r.dupIds.length > 1 ? 'ies' : 'y'})`).join(', ')}: the same payment saved from two imports or accounts. They're counted once now; tap one to remove the copies.</span><div class="row gap wrap">${d.slice(0, 4).map((r) => `<button class="chip" data-action="bill-open" data-key="${esc(r.key)}">${esc(r.name)} ›</button>`).join('')}</div></div>` : ''; })()}
  <div class="card cal-card" data-tab="Calendar">
    <div class="cal-nav"><button class="icon-btn small" data-action="cal-month" data-step="-1" aria-label="Previous month">‹</button>
      <div class="grow"><b>${esc(monthLabel(month))}</b>${month !== thisMonth ? ' <button class="chip" data-action="cal-month" data-step="0">Today</button>' : ''}</div>
      <button class="icon-btn small" data-action="cal-month" data-step="1" aria-label="Next month">›</button></div>
    <div class="cal-stats">
      <div><span class="label">Going out</span><b>${fmt(totalOut, { whole: true })}</b></div>
      <div><span class="label">${month < thisMonth ? 'Paid' : 'Paid so far'}</span><b class="pos">${fmt(paidOut, { whole: true })}</b></div>
      <div><span class="label">${month === thisMonth && nextPay ? 'To payday' : 'Still to come'}</span><b>${fmt(month === thisMonth && beforePay != null ? beforePay : totalOut - paidOut, { whole: true })}</b></div>
    </div>
    <div class="cal-filters" role="radiogroup" aria-label="Show">${FILTERS.map(([v, l]) => `<button class="chip ${ui.filter === v ? 'sel' : ''}" role="radio" aria-checked="${ui.filter === v}" data-action="cal-filter" data-f="${v}">${l}</button>`).join('')}</div>
    <div class="seg cal-view" role="radiogroup" aria-label="View"><button class="${ui.view === 'cal' ? 'sel' : ''}" data-action="cal-view" data-v="cal">Calendar</button><button class="${ui.view === 'list' ? 'sel' : ''}" data-action="cal-view" data-v="list">List by week</button></div>
    ${ui.view === 'cal' ? `<div class="cal"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span>${cells.join('')}</div>
    <div class="legend"><span><i class="sw due-sw"></i>Due</span><span><i class="sw paid-sw"></i>Paid</span><span><i class="sw late-sw"></i>Not seen</span><span><i class="sw pay-sw"></i>Payday</span>${fc ? '<span><i class="sw danger-sw"></i>Could bounce</span>' : ''}</div>` : `<div class="cal-list">${list}</div>`}
    <p class="sub">Tap a day or payment for details, reminders and what to do.</p>
    <div class="row gap cal-actions"><button class="btn ghost grow" data-action="bill-add">＋ Add payment</button><button class="btn primary grow" data-action="due-calendar">📅 All to Calendar</button></div>
  </div>
  ${suggestions()}
  ${changesCard()}
  ${fc ? `<div class="card"><h3>Balance forecast</h3>
    <p class="sub">What's likely to be in your current account${sb.accounts.length > 1 ? 's' : ''} each day until ${prettyDate(until)}: today's balance, minus each regular bill on its day, plus pay when it lands. It warns you before a payment could bounce.</p>
    <div class="stat-grid"><div><span class="label">Starting balance</span><b>${fmt(sb.amount, { whole: true })}</b></div><div><span class="label">Lowest · ${prettyDate(fc.low.date)}</span><b class="${fc.low.balance < 0 ? 'neg' : ''}">${fmt(fc.low.balance, { whole: true })}</b></div></div>
    ${fcChart}
    <details class="checks"><summary>Where the starting balance comes from</summary>
      ${sb.accounts.map((a) => `<div class="pt-row two"><span>${esc(a.name)} <small class="muted">${a.balanceDate ? `statement ${prettyDate(a.balanceDate)}` : 'date unknown'}</small></span><b>${fmt(a.balance, { whole: true })}</b></div>`).join('')}
      <p class="sub">${sb.stale ? '⚠ These balances are from your last imported statements, not today. Import recent statements (or type today\'s balance in Accounts) for a true picture.' : 'From statements in the last 10 days.'} Card spending, shopping and anything not regular aren't included, so keep a buffer.</p></details>
    <p class="sub">Tap a dot to see that day.</p></div>` : ''}
  ${tips.length ? `<div class="card"><h3>What to do</h3>${tips.join('')}</div>` : ''}
  ${subsAuditCard()}
  ${overlapsCard()}
  ${fairShareCard()}
  ${fundAccountsCard()}
  ${toCancel.length ? `<div class="card tip-box"><b>Cancel list:</b> ${toCancel.map((r) => esc(r.name)).join(', ')} saves <b>${fmt(toCancel.reduce((a, r) => a + r.amount, 0))}/month</b> (${fmt(toCancel.reduce((a, r) => a + r.amount, 0) * 12, { whole: true })}/yr). Tap "To cancel" again once it's done.</div>` : ''}
  <div class="card bill-tools" data-tab="All payments"><div class="seg" role="radiogroup" aria-label="Amounts"><button role="radio" aria-checked="${!yr}" class="${yr ? '' : 'sel'}" data-action="bill-per" data-v="mo">Per month</button><button role="radio" aria-checked="${yr}" class="${yr ? 'sel' : ''}" data-action="bill-per" data-v="yr">Per year</button></div><button class="chip" data-action="bills-csv">Export list</button></div>
  ${section('Bills', bills)}${section('Subscriptions', subs)}${section('Other regular payments', other)}${section('Income', live.filter((r) => r.direction === 'in' && r.active))}
  ${yearlyPotCard()}
  ${billTrendCard()}
  ${hiddenList.length ? `<div class="card"><h3>Hidden <small class="muted">${hiddenList.length}</small></h3>${hiddenList.map((r) => `<div class="list-row"><span class="grow">${esc(r.name)} <small class="muted">${fmt(r.amount)}</small></span><button class="chip" data-action="bill-unhide" data-key="${esc(r.key)}">Show again</button></div>`).join('')}</div>` : ''}
`;
}

/** Payments seen once that are probably regular (Direct Debits, standing orders, subscriptions, loans). */
function suggestions() {
  const s = state.settings;
  const list = likelyNewRegular(state.txs, state.derived.recurring, { today: state.derived.today, dismissed: s.suggestDismissed || {}, manual: s.manualBills || [] });
  if (!list.length) return '';
  return `<div class="card"><h3>New regular payments? <small class="muted">${list.length}</small></h3><p class="sub">Seen once so far, but they look regular. Add them now so budgets and forecasts include them; once the next statement shows them they're tracked automatically under the name you give.</p>
    ${list.map((x) => `<div class="list-row"><div class="grow"><b>${esc(x.name)}</b><div class="sub">${esc(x.why)} · ${fmt(x.amount)} on ${prettyDate(x.date)} · ${esc(accountName(x.accountId))}</div></div>
      <div class="row gap"><button class="chip sel" data-action="bill-sugg-add" data-name="${esc(x.name)}" data-amount="${x.amount}" data-day="${+x.date.slice(8)}" data-acc="${esc(x.accountId || '')}" data-cat="${esc(x.category)}" data-type="${esc(x.why === 'Standing order' ? 'Standing Order' : x.why === 'Subscription' ? 'Card / Subscription' : 'Direct Debit')}">＋ Add</button><button class="chip" data-action="bill-sugg-no" data-k="${esc(x.key)}">Not regular</button></div></div>`).join('')}</div>`;
}

// ---------- Sheets ----------
const find = (key) => state.derived.recurring.find((r) => r.key === key);

function daySheet(date) {
  const d = +date.slice(8);
  const items = ctx.byDay.get(d) || [];
  const bal = ctx.balOn.get(date);
  const out = items.filter((x) => x.dir === 'out').reduce((a, x) => a + x.r.amount, 0);
  openSheet(`<h2>${esc(prettyDate(date))} ${esc(date.slice(0, 4))}</h2>
    <p class="muted">${items.length ? `${items.length} item${items.length > 1 ? 's' : ''}${out ? ` · ${fmt(out)} out` : ''}` : 'No regular payments'}${bal != null ? ` · balance after: <b class="${bal < 0 ? 'neg' : ''}">${fmt(bal, { whole: true })}</b>` : ''}</p>
    ${bal != null && bal < 0 ? `<div class="cal-tip bad"><b>⚠ This could bounce</b><span>Move at least ${fmt(-bal, { whole: true })} into the account before this day, or ask the company to take it after payday.</span></div>` : ''}
    ${items.map((x) => itemCard(x.r, x.status)).join('')}
    <button class="btn ghost full" data-action="bill-add" data-day="${d}">＋ Add a payment on the ${ord(d)}</button>
    <button class="btn ghost full" data-action="close-sheet">Done</button>`, { wide: true });
}

function itemCard(r, status) {
  const flags = state.settings.billFlags || {};
  const h = helpFor(r.name);
  const last = state.txs.filter((t) => (t.merchant || '').toUpperCase() === r.name.toUpperCase() && (r.direction === 'out' ? t.amount < 0 : t.amount > 0)).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const main = state.settings.mainAccountId;
  const isIn = r.direction === 'in';
  const stLabel = isIn ? { paid: '<span class="pos">✓ Received</span>', due: 'Expected', late: '<span class="warn-text">Not in your statements yet</span>', missed: '<span class="neg">Not seen that month</span>', upcoming: 'Expected' }[status] || '' : { paid: '<span class="pos">✓ Paid</span>', due: '<span class="warn-text">Due</span>', late: '<span class="neg">Not in your statements yet</span>', missed: '<span class="neg">Not seen that month</span>', upcoming: 'Upcoming' }[status] || '';
  return `<div class="act-item">
    <div class="row between">${catChip(r.category)}<b class="grow">${esc(r.name)}</b><b class="${r.direction === 'in' ? 'pos' : ''}">${fmt(r.amount)}</b></div>
    <div class="sub">${stLabel}${stLabel ? ' · ' : ''}${isIn ? (r.name.match(/SALARY|PAY|WAGES|FROM/i) ? 'Pay' : 'Money in') : esc(r.type)} · ${esc(catName(r.category))}${r.accountId ? ` · ${esc(accountName(r.accountId))}` : ''}</div>
    <div class="sub">${last ? `Last ${prettyDate(last.date)} (${fmt(Math.abs(last.amount))}) · ` : ''}next ${prettyDate(r.nextDue)} · ${fmt(r.amount * 12, { whole: true })} a year${r.priceChange > 0 ? ` · <span class="warn-text">up ${fmt(r.priceChange)}</span>` : ''}</div>
    ${h ? `<div class="sub">${esc(h.how)}</div><a class="act-link" href="${esc(h.url)}" target="_blank" rel="noopener">Manage ${esc(h.label)} ↗</a>` : ''}
    <div class="row gap wrap item-actions">
      ${isIn ? '' : `<button class="chip" data-action="bill-remind" data-key="${esc(r.key)}">⏰ Remind me</button>`}
      ${status === 'due' || status === 'late' ? `<button class="chip" data-action="bill-markpaid" data-key="${esc(r.key)}">✓ Mark ${isIn ? 'received' : 'paid'}</button>` : ''}
      ${r.direction === 'out' ? `<button class="chip" data-action="bill-movetips" data-key="${esc(r.key)}">📆 Move the date</button>
      <button class="chip ${flags[r.key] === 'cancel' ? 'sel' : ''}" data-action="act-flag" data-key="${esc(r.key)}">${flags[r.key] === 'cancel' ? '✓ On cancel list' : '＋ Cancel list'}</button>
      <button class="chip" data-action="bill-cancelhow" data-key="${esc(r.key)}">🚫 How to cancel</button>` : ''}
      <button class="chip" data-action="bn-open" data-key="${esc(r.key)}">📝 Note</button>
      ${main && r.accountId && r.accountId !== main && r.direction === 'out' ? '<a class="chip" href="#/movebills">Move to main account ›</a>' : ''}
      <a class="chip" href="#/transactions?cat=${esc(r.category)}">Transactions ›</a>
      ${r.manual ? `<button class="chip" data-action="bill-add" data-id="${esc(r.id)}">✎ Edit</button><button class="chip" data-action="bill-delete" data-id="${esc(r.id)}">Delete</button>` : `<button class="chip" data-action="bill-edit" data-key="${esc(r.key)}">✎ Correct it</button><button class="chip" data-action="bill-hide" data-key="${esc(r.key)}">${isIn ? 'Not regular income' : 'Not a regular bill'}</button>`}
    </div>${billNoteHtml(r)}${paymentsSeen(r)}</div>`;
}

/** The actual payments behind a regular payment, with any copies counted twice flagged. */
function paymentsSeen(r) {
  if (r.manual || !r.txIds) return '';
  const all = state.allTxs || state.txs;
  const byId = new Map(all.map((t) => [t.id, t]));
  const rows = [...(r.txIds || []).map((id) => [byId.get(id), false]), ...(r.dupIds || []).map((id) => [byId.get(id), true])].filter(([t]) => t).sort((a, b) => b[0].date.localeCompare(a[0].date));
  const dups = (r.dupIds || []).length;
  return `${priceHistory(r)}${(state.settings.recurringEdits || {})[r.key]?.contractEnd ? `<div class="sub">Contract ends ${prettyDate(state.settings.recurringEdits[r.key].contractEnd)} ${state.settings.recurringEdits[r.key].contractEnd.slice(0, 4)}</div>` : ''}<details class="seen" ${dups ? 'open' : ''}><summary>Payments seen (${rows.length})${dups ? ` · <span class="neg">${dups} counted twice</span>` : ''}${r.edited ? ' · ✎ corrected by you' : ''}</summary>
    ${dups ? `<div class="cal-tip bad"><b>${dups} payment${dups > 1 ? 's look' : ' looks'} like ${dups > 1 ? 'copies' : 'a copy'} of another</b><span>Same amount, same days, from another import or account, so this bill was showing more than you pay. They're only counted once now.</span>
      <div class="row gap wrap"><button class="chip sel" data-action="bill-dups-remove" data-key="${esc(r.key)}">Remove the ${dups} cop${dups > 1 ? 'ies' : 'y'}</button><button class="chip" data-action="bill-notdup" data-key="${esc(r.key)}">They're separate payments</button></div></div>` : ''}
    ${rows.map(([t, dup]) => `<div class="pv-row ${dup ? 'dup' : ''}"><span>${prettyDate(t.date)} ${t.date.slice(2, 4)}</span><span class="ellipsis grow">${esc(accountName(t.accountId))}${dup ? ' · copy' : ''}</span><b>${fmt(Math.abs(t.amount))}</b></div>`).join('')}</details>`;
}

function editSheet(key) {
  const r = find(key);
  if (!r) return;
  const cats = ['housing', 'bills', 'insurance', 'debt', 'subscriptions', 'entertainment', 'fitness', 'gifts', 'childcare', 'transport', 'other'].filter((c) => CAT[c]);
  openSheet(`<h2>Correct ${esc(r.name)}</h2>
    <p class="muted">If the app has this bill wrong (amount, day or category), set it here. It's used everywhere: calendar, budgets, forecasts.</p>
    <label class="field"><span>Name</span><input id="be-name" value="${esc(r.name)}"></label>
    <div class="plan-grid"><label class="field"><span>Amount £ a month</span><input id="be-amt" inputmode="decimal" value="${(r.amount / 100).toFixed(2)}"></label>
      <label class="field"><span>Day of month</span><input id="be-day" inputmode="numeric" value="${r.day}"></label></div>
    <label class="field"><span>Contract ends (optional)</span><input id="be-end" type="date" value="${esc((state.settings.recurringEdits || {})[key]?.contractEnd || '')}"></label>
    <label class="field select"><span>Category</span><select id="be-cat">${cats.map((c) => `<option value="${c}" ${r.category === c ? 'selected' : ''}>${esc(catName(c))}</option>`).join('')}</select></label>
    <button class="btn primary full" data-action="bill-edit-save" data-key="${esc(key)}">Save</button>
    ${r.edited ? `<button class="btn ghost full" data-action="bill-edit-reset" data-key="${esc(key)}">Undo my correction</button>` : ''}
    <button class="btn ghost full" data-action="close-sheet">Cancel</button>`);
}

function billSheet(key) {
  const r = find(key);
  if (!r) return;
  const status = ctx?.paid.has(key) ? 'paid' : r.nextDue < state.derived.today && (state.derived.accountEnd[r.accountId] || '') >= r.nextDue ? 'late' : 'due';
  openSheet(`<h2>${esc(r.name)}</h2>${itemCard(r, status)}<button class="btn ghost full" data-action="close-sheet">Done</button>`, { wide: true });
}

function moveTips(key) {
  const r = key ? find(key) : null;
  const pd = state.derived.payday;
  const target = pd ? Math.min(pd + 2, 28) : null;
  const h = r ? helpFor(r.name) : null;
  openSheet(`<h2>Move a payment date${r ? `: ${esc(r.name)}` : ''}</h2>
    ${target ? `<p class="muted">Your pay usually arrives on the ${ord(pd)}. Ask for the <b>${ord(target)}</b>, so the money is there.</p>` : '<p class="muted">Pick a date just after your pay arrives.</p>'}
    <ol class="act-steps">
      <li>${r?.type?.startsWith('Standing') ? 'Standing order: change the date yourself in your banking app.' : 'Direct Debit: the company changes it, not your bank. Most let you do it in their app or account page; otherwise call or use web chat.'}</li>
      <li>Ask: "Please move my payment date to the ${target ? ord(target) : '…'} of each month."</li>
      <li>Check when the first payment on the new date is taken. It can come sooner than you expect, so make sure your pay is in by then.</li>
      <li>Card payments and subscriptions: changing the card to your main debit card is usually easier than changing the date.</li>
      <li>If a payment has already bounced: pay it straight away and ask the bank to refund the fee and the company not to report it.</li>
    </ol>
    ${h ? `<a class="act-link" href="${esc(h.url)}" target="_blank" rel="noopener">${esc(h.label)} account ↗</a>` : ''}
    <div class="act-links"><a class="act-link" href="https://www.moneyhelper.org.uk/en/everyday-money/budgeting/how-to-prioritise-bills" target="_blank" rel="noopener">MoneyHelper: which bills to pay first ↗</a></div>
    <button class="btn ghost full" data-action="close-sheet">Done</button>`, { wide: true });
}

function addSheet({ day = null, id = null } = {}) {
  const b = id ? (state.settings.manualBills || []).find((x) => x.id === id) : null;
  const accounts = (state.allAccounts || state.accounts).filter((a) => a.type !== 'investment');
  const cats = ['housing', 'bills', 'insurance', 'debt', 'subscriptions', 'childcare', 'transport', 'other'].filter((c) => CAT[c]);
  openSheet(`<h2>${b ? 'Edit' : 'Add'} a regular payment</h2>
    <p class="muted">For a payment the app hasn't picked up yet, e.g. rent paid from an account you haven't imported. If it later appears in your statements, the app uses that instead.</p>
    <label class="field"><span>Name</span><input id="mb-name" value="${esc(b?.name || '')}" placeholder="e.g. Rent"></label>
    <div class="plan-grid"><label class="field"><span>Amount £</span><input id="mb-amt" inputmode="decimal" value="${b ? (b.amount / 100).toFixed(2) : ''}" placeholder="0.00"></label>
      <label class="field"><span>Day of month</span><input id="mb-day" inputmode="numeric" value="${b?.day || day || ''}" placeholder="15"></label></div>
    <div class="plan-grid"><label class="field select"><span>Category</span><select id="mb-cat">${cats.map((c) => `<option value="${c}" ${(b?.category || 'housing') === c ? 'selected' : ''}>${esc(catName(c))}</option>`).join('')}</select></label>
      <label class="field select"><span>Type</span><select id="mb-type">${['Direct Debit', 'Standing Order', 'Card / Subscription', 'Bank transfer'].map((t) => `<option ${(b?.type || 'Standing Order') === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>
    <label class="field"><span>Name on your statement (optional)</span><input id="mb-match" value="${esc(b?.match || '')}" placeholder="e.g. Black Horse"></label>
    <p class="sub">Once the statements show it, the app tracks the real payments under your name instead, so it's never counted twice.</p>
    <label class="field select"><span>Paid from</span><select id="mb-acc"><option value="">Not sure</option>${accounts.map((a) => `<option value="${esc(a.id)}" ${b?.accountId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
    <button class="btn primary full" data-action="bill-save" data-id="${esc(id || '')}">Save</button>
    <button class="btn ghost full" data-action="close-sheet">Cancel</button>`);
}

async function save(patch, msg) { await saveSettings(patch); recompute(); if (msg) toast(msg); }

export const actions = {
  'cal-day': (el) => daySheet(dayIn(ctx.month, +el.dataset.d)),
  'cal-date': (el) => daySheet(el.dataset.date),
  'cal-month': (el, rerender) => {
    const step = +el.dataset.step;
    ui.month = step === 0 ? null : addMonths(ui.month || monthKey(state.derived.today), step);
    rerender();
  },
  'cal-filter': (el, rerender) => { ui.filter = el.dataset.f; rerender(); },
  'cal-view': (el, rerender) => { ui.view = el.dataset.v; rerender(); },
  'bill-open': (el) => billSheet(el.dataset.key),
  'bill-movetips': (el) => moveTips(el.dataset.key),
  'bill-remind': async (el) => {
    const r = find(el.dataset.key);
    const byId = Object.fromEntries((state.allAccounts || state.accounts).map((a) => [a.id, a]));
    await shareFile(`${r.name.replace(/[^A-Za-z0-9]+/g, '-').slice(0, 30)}-reminder.ics`, billsCalendar([{ ...r, direction: 'out', active: true }], byId), 'text/calendar');
    toast('Reminder ready: tap Add in Calendar (the day before, every month)');
  },
  'bill-markpaid': async (el, rerender) => {
    const m = ctx.month;
    const marked = { ...(state.settings.billPaid || {}) };
    marked[m] = { ...(marked[m] || {}), [el.dataset.key]: true };
    await save({ billPaid: marked }, 'Marked as paid'); closeSheet(); rerender();
  },
  'bill-edit': (el) => editSheet(el.dataset.key),
  'bill-edit-save': async (el, rerender) => {
    const v = (id) => document.getElementById(id).value.trim();
    const amount = parsePrice(v('be-amt')), day = parseInt(v('be-day'), 10);
    if (!amount) return toast('Enter the amount', { error: true });
    if (!(day >= 1 && day <= 31)) return toast('Day should be 1–31', { error: true });
    await save({ recurringEdits: { ...(state.settings.recurringEdits || {}), [el.dataset.key]: { name: v('be-name'), amount, day, category: v('be-cat'), ...(v('be-end') ? { contractEnd: v('be-end') } : {}) } } }, 'Corrected');
    closeSheet(); rerender();
  },
  'bill-edit-reset': async (el, rerender) => { const e = { ...(state.settings.recurringEdits || {}) }; delete e[el.dataset.key]; await save({ recurringEdits: e }, 'Back to what the statements say'); closeSheet(); rerender(); },
  'bill-dups-remove': async (el, rerender) => {
    const r = find(el.dataset.key);
    if (!r?.dupIds?.length) return;
    const { db } = await import('../../lib/db.js');
    for (const id of r.dupIds) await db.del('tx', id);
    const gone = new Set(r.dupIds);
    state.txs = state.txs.filter((t) => !gone.has(t.id));
    if (state.allTxs) state.allTxs = state.allTxs.filter((t) => !gone.has(t.id));
    recompute(); toast(`Removed ${gone.size} duplicate payment${gone.size > 1 ? 's' : ''}`); closeSheet(); rerender();
  },
  'bill-notdup': async (el, rerender) => { await save({ recurringNotDup: { ...(state.settings.recurringNotDup || {}), [el.dataset.key]: true } }, 'Kept as separate payments'); closeSheet(); rerender(); },
  'bill-hide': async (el, rerender) => { await save({ billHidden: { ...(state.settings.billHidden || {}), [el.dataset.key]: true } }, 'Hidden from the calendar'); closeSheet(); rerender(); },
  'bill-unhide': async (el, rerender) => { const h = { ...(state.settings.billHidden || {}) }; delete h[el.dataset.key]; await save({ billHidden: h }); rerender(); },
  'bill-add': (el) => addSheet({ day: el.dataset.day ? +el.dataset.day : null, id: el.dataset.id || null }),
  'bill-save': async (el, rerender) => {
    const v = (id) => document.getElementById(id).value.trim();
    const amount = parsePrice(v('mb-amt'));
    const day = parseInt(v('mb-day'), 10);
    if (!v('mb-name')) return toast('Give it a name', { error: true });
    if (!amount || amount <= 0) return toast('Enter the amount', { error: true });
    if (!(day >= 1 && day <= 31)) return toast('Day should be 1–31', { error: true });
    const list = [...(state.settings.manualBills || [])];
    const id = el.dataset.id || `b${Date.now().toString(36)}`;
    const b = { id, name: v('mb-name'), match: v('mb-match') || null, amount, day, category: v('mb-cat'), type: v('mb-type'), accountId: v('mb-acc') || null };
    const i = list.findIndex((x) => x.id === id);
    if (i >= 0) list[i] = b; else list.push(b);
    await save({ manualBills: list }, `${b.name} added on the ${ord(day)}`); closeSheet(); rerender();
  },
  'bill-delete': async (el, rerender) => { await save({ manualBills: (state.settings.manualBills || []).filter((x) => x.id !== el.dataset.id) }, 'Deleted'); closeSheet(); rerender(); },
  'bill-flag': async (el, rerender) => {
    const flags = { ...(state.settings.billFlags || {}) };
    const cur = flags[el.dataset.key];
    const next = !cur ? 'cancel' : cur === 'cancel' ? 'cancelled' : undefined;
    if (next) flags[el.dataset.key] = next; else delete flags[el.dataset.key];
    await saveSettings({ billFlags: flags });
    rerender();
  },
  'due-calendar': () => addBillsToCalendar(),
  'bill-per': (el, rerender) => { ui.per = el.dataset.v; rerender(); },
  'bill-sugg-add': (el) => {
    addSheet({ day: +el.dataset.day });
    const set = (id, v) => { const i = document.getElementById(id); if (i) i.value = v; };
    set('mb-name', el.dataset.name); set('mb-match', el.dataset.name); set('mb-amt', (+el.dataset.amount / 100).toFixed(2)); set('mb-cat', ['entertainment', 'fitness'].includes(el.dataset.cat) ? 'subscriptions' : el.dataset.cat || 'debt'); set('mb-type', el.dataset.type || 'Direct Debit'); set('mb-acc', el.dataset.acc);
  },
  'bill-sugg-no': async (el, rerender) => { await save({ suggestDismissed: { ...(state.settings.suggestDismissed || {}), [el.dataset.k]: true } }); rerender(); },
};
