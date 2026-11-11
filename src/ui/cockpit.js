// Overview hero: this month as one ring (bills paid, bills to come, spent, likely to come, left) with a
// "what if I spend £X more?" slider that moves the month end, safe-to-spend per day and the lowest
// balance before payday as you drag. Past months show what came in, went out and was left.
import { state } from '../state.js';
import { esc, openSheet, closeSheet } from './dom.js';
import { fmt } from '../lib/money.js';
import { monthKey, monthLabel, addDays, nextDayOfMonth, daysBetween } from '../lib/dates.js';
import { monthOutlook } from '../lib/forecast.js';
import { summarizeMonth } from '../lib/analysis.js';
import { balanceForecast, paidThisMonth } from '../lib/cashflow.js';
import { safeToSpend } from './overview-extras.js';

const COLORS = { paid: 'var(--ck-paid)', due: 'var(--ck-due)', spent: 'var(--ck-spent)', more: 'var(--ck-more)', left: 'var(--ck-left)', over: 'var(--bad)' };
const LABELS = { paid: 'Bills paid', due: 'Bills to come', spent: 'Everyday spending', more: 'Likely to come', left: 'Left', over: 'Over budget' };
const LINKS = { paid: '#/bills', due: '#/bills', spent: 'explain', more: '#/budget', left: '#/track', over: '#/track' };

/** The numbers the hero needs, for the current month. */
function base() {
  const d = state.derived;
  const mo = monthOutlook({ txs: state.txs, today: d.today, budget: d.budget, recurring: d.recurring });
  const safe = safeToSpend();
  // Lowest balance before payday (bills still to come), so the slider can warn before a bounce.
  let low = null;
  const cur = state.accounts.filter((a) => a.type === 'current' && a.balance != null);
  if (cur.length && d.payday) {
    const live = d.billsOut;
    const start = d.balance ?? cur.reduce((a, x) => a + x.balance, 0);
    const fc = balanceForecast({ start, today: d.today, until: addDays(nextDayOfMonth(addDays(d.today, 1), d.payday), -1), recurring: live, paidKeys: paidThisMonth(live, state.txs, monthKey(d.today), state.settings.billPaid) });
    low = fc.low;
  }
  return {
    income: mo.income, paid: mo.fixedSoFar, due: mo.billsToCome, spent: mo.variableSoFar, more: Math.max(0, mo.variableEnd - mo.variableSoFar),
    goals: d.budget.goalsMonthly || 0, left: mo.left, day: mo.day, days: mo.days,
    safeLeft: safe ? safe.left : null, safeDays: safe ? safe.days : null, nextPay: safe ? safe.nextPay : null,
    low: low ? low.balance : null, lowDate: low ? low.date : null,
  };
}

function segments(b, extra) {
  const more = b.more + extra;
  const used = b.paid + b.due + b.spent + more + b.goals;
  const left = b.income - used;
  const segs = [['paid', b.paid], ['due', b.due], ['spent', b.spent], ['more', more]];
  if (left >= 0) segs.push(['left', left]); else segs.push(['over', -left]);
  return { segs, left, total: Math.max(b.income, used) || 1 };
}

function ring(segs, total) {
  let acc = 0;
  const stops = segs.filter(([, v]) => v > 0).map(([k, v]) => { const a = (acc / total) * 100; acc += v; return `${COLORS[k]} ${a.toFixed(2)}% ${((acc / total) * 100).toFixed(2)}%`; });
  return `conic-gradient(${stops.join(', ') || 'var(--track) 0 100%'})`;
}

/** The parts that change with the slider. */
function live(b, extra) {
  const { segs, left, total } = segments(b, extra);
  const perDay = b.safeLeft != null ? Math.max(0, Math.floor((b.safeLeft - extra) / b.safeDays)) : null;
  const low = b.low != null ? b.low - extra : null;
  const tone = left < 0 ? 'neg' : left < b.income * 0.05 ? 'warn-text' : 'pos';
  return {
    ring: ring(segs, total),
    num: `<span class="${tone}">${fmt(left, { whole: true, sign: true })}</span>`,
    note: extra ? `if you spend ${fmt(extra, { whole: true })} more` : left < 0 ? 'short at this pace' : 'at this pace, after bills',
    stats: `${perDay != null ? `<button class="ck-stat" data-action="dash-open" data-id="safe"><span>Safe to spend</span><b class="${perDay ? '' : 'neg'}">${fmt(perDay, { whole: true })}<small> a day</small></b></button>` : ''}
      ${low != null ? `<button class="ck-stat" data-action="ck-go" data-to="#/bills"><span>Lowest before payday</span><b class="${low < 0 ? 'neg' : ''}">${fmt(low, { whole: true })}</b></button>` : ''}`,
    legend: segs.map(([k, v]) => `<button class="ck-leg" data-action="ck-go" data-to="${LINKS[k]}"><i style="background:${COLORS[k]}"></i><span>${LABELS[k]}</span><b>${fmt(v, { whole: true })}</b></button>`).join(''),
  };
}

export function cockpit() {
  const d = state.derived;
  const month = state.month;
  if (month !== monthKey(d.today)) return pastMonth(month);
  const b = base();
  const v = live(b, 0);
  const max = Math.max(20000, Math.ceil(Math.max(b.income * 0.3, 50000) / 5000) * 5000);
  const toPay = b.nextPay ? daysBetween(d.today, b.nextPay) : null;
  return `<section class="card ck keep-open" data-ck='${esc(JSON.stringify(b))}' aria-label="This month">
    <div class="ck-head">
      <div class="ck-answer"><span class="label">Left by the end of ${esc(monthLabel(month).split(' ')[0])}</span><div class="ck-num">${v.num}</div><span class="ck-note">${v.note}</span></div>
      <button class="ck-ring" data-action="ck-breakdown" style="background:${v.ring}" aria-label="Where this month's money goes: tap for the breakdown"><span class="ck-hole">${toPay != null ? `<b>${toPay}</b><small>day${toPay === 1 ? '' : 's'} to pay</small>` : ''}</span></button>
    </div>
    <div class="ck-stats">${v.stats}</div>
    <label class="ck-slide"><span>What if I spend <b id="ck-x">£0</b> more?</span>
      <input type="range" id="ck-range" min="0" max="${max}" step="500" value="0" aria-label="Extra spending this month"></label>
  </section>`;
}

function pastMonth(month) {
  const s = summarizeMonth(state.txs, month);
  const total = Math.max(s.income, s.spend + s.saved) || 1;
  const left = s.income - s.spend - s.saved;
  const segs = [['spent', s.spend], ['paid', s.saved], left >= 0 ? ['left', left] : ['over', -left]];
  return `<section class="card ck keep-open" aria-label="${esc(monthLabel(month))}">
    <div class="ck-head">
      <div class="ck-answer"><span class="label">Left over in ${esc(monthLabel(month))}</span><div class="ck-num"><span class="${left < 0 ? 'neg' : 'pos'}">${fmt(left, { whole: true, sign: true })}</span></div><span class="ck-note">${state.derived.incomplete?.has(month) ? 'a statement is missing for this month' : s.income ? `${Math.round((left / s.income) * 100)}% of what came in` : ''}</span></div>
      <span class="ck-ring" style="background:${ring(segs, total)}"><span class="ck-hole"></span></span>
    </div>
    <div class="ck-stats"><button class="ck-stat" data-action="explain" data-what="in"><span>Came in</span><b>${fmt(s.income, { whole: true })}</b></button><button class="ck-stat" data-action="explain" data-what="spent"><span>Spent</span><b>${fmt(s.spend, { whole: true })}</b></button></div>
  </section>`;
}

// The slider moves the numbers straight away (no re-render, so dragging stays smooth).
document.addEventListener('input', (e) => {
  if (e.target.id !== 'ck-range') return;
  const card = e.target.closest('.ck');
  const b = JSON.parse(card.dataset.ck);
  const extra = +e.target.value;
  const v = live(b, extra);
  card.querySelector('.ck-ring').style.background = v.ring;
  card.querySelector('.ck-num').innerHTML = v.num;
  card.querySelector('.ck-note').textContent = v.note;
  card.querySelector('.ck-stats').innerHTML = v.stats;
  card.querySelector('#ck-x').textContent = fmt(extra, { whole: true });
});

export const cockpitActions = {
  'ck-breakdown': () => {
    const b = base();
    const v = live(b, +(document.getElementById('ck-range')?.value || 0));
    openSheet(`<h2>This month</h2><p class="muted">${fmt(b.income, { whole: true })} coming in. Where it goes, at today's pace:</p>
      <div class="ck-ring big" style="background:${v.ring}"><span class="ck-hole"><b>${fmt(b.income, { whole: true })}</b><small>income</small></span></div>
      <div class="ck-legend">${v.legend}</div>
      <div class="row gap wrap"><button class="chip" data-action="dash-open" data-id="income">Income details</button><button class="chip" data-action="explain" data-what="spent">All spending</button><a class="chip" href="#/afford">Can I afford it?</a></div>`);
  },
  'ck-go': (el) => {
    closeSheet();
    if (el.dataset.to === 'explain') { location.hash = '#/spending'; return; }
    location.hash = el.dataset.to;
  },
};
