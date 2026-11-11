// Overview hero: this month as one ring (bills paid, bills to come, spent, likely to come, left) with a
// "what if I spend £X more?" slider that moves the month end, safe-to-spend per day and the lowest
// balance before payday as you drag. Past months show what came in, went out and was left.
import { state } from '../state.js';
import { esc } from './dom.js';
import { fmt } from '../lib/money.js';
import { monthKey, monthLabel, prettyDate, addDays, nextDayOfMonth, daysBetween } from '../lib/dates.js';
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
    const live = d.recurring.filter((r) => (r.category !== 'transfer' || r.cardRepay) && r.direction === 'out');
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
    center: `<span class="ck-k">${extra ? 'Then month end' : 'Month end'}</span><b class="${tone}">${fmt(left, { whole: true, sign: true })}</b><span class="ck-s">${left < 0 ? 'short' : 'left over'}</span>`,
    legend: segs.map(([k, v]) => `<button class="ck-leg" data-action="ck-go" data-to="${LINKS[k]}"><i style="background:${COLORS[k]}"></i><span>${LABELS[k]}${k === 'more' && extra ? ` <small>+${fmt(extra, { whole: true })}</small>` : ''}</span><b>${fmt(v, { whole: true })}</b></button>`).join(''),
    stats: `${perDay != null ? `<div role="button" tabindex="0" data-action="dash-open" data-id="safe"><span>Safe to spend</span><b class="${perDay ? '' : 'neg'}">${fmt(perDay, { whole: true })}<small>/day</small></b><em>${b.safeDays} days to payday</em></div>` : ''}
      ${low != null ? `<div role="button" tabindex="0" data-action="ck-go" data-to="#/bills"><span>Lowest balance</span><b class="${low < 0 ? 'neg' : ''}">${fmt(low, { whole: true })}</b><em>${low < 0 ? 'a bill could bounce' : `on ${prettyDate(b.lowDate)}`}</em></div>` : ''}
      <div role="button" tabindex="0" data-action="dash-open" data-id="income"><span>Income</span><b>${fmt(b.income, { whole: true })}</b><em>${b.goals ? `${fmt(b.goals, { whole: true })} to goals` : 'this month'}</em></div>`,
  };
}

export function cockpit() {
  const d = state.derived;
  const month = state.month;
  if (month !== monthKey(d.today)) return pastMonth(month);
  const b = base();
  const v = live(b, 0);
  const max = Math.max(20000, Math.ceil(Math.max(b.income * 0.3, 50000) / 5000) * 5000);
  return `<div class="card ck keep-open" data-ck='${esc(JSON.stringify(b))}'>
    <div class="ck-top"><span>${esc(monthLabel(month))} · day ${b.day} of ${b.days}</span>${b.nextPay ? `<span class="ck-pay">💷 ${daysBetween(d.today, b.nextPay) === 0 ? 'Payday today' : `Payday in ${daysBetween(d.today, b.nextPay)} days`}</span>` : ''}</div>
    <div class="ck-main">
      <div class="ck-ring" style="background:${v.ring}" role="img" aria-label="Where this month's money goes"><div class="ck-center">${v.center}</div></div>
      <div class="ck-legend">${v.legend}</div>
    </div>
    <div class="ck-stats">${v.stats}</div>
    <label class="ck-slide"><span>What if I spend <b id="ck-x">£0</b> more?</span>
      <input type="range" id="ck-range" min="0" max="${max}" step="500" value="0" aria-label="Extra spending this month"></label>
    <div class="ck-ticks"><span>£0</span><span>${fmt(max / 2, { whole: true })}</span><span>${fmt(max, { whole: true })}</span></div>
    <div class="ck-quick"><a class="chip" href="#/afford">❓ Can I afford it?</a><button class="chip" data-action="explain" data-what="spent">See all spending ›</button><button class="chip" data-action="ov-share">Share ⇪</button></div>
  </div>`;
}

function pastMonth(month) {
  const s = summarizeMonth(state.txs, month);
  const total = Math.max(s.income, s.spend + s.saved) || 1;
  const left = s.income - s.spend - s.saved;
  const segs = [['spent', s.spend], ['paid', s.saved], left >= 0 ? ['left', left] : ['over', -left]];
  const lab = { spent: 'Spent', paid: 'To savings', left: 'Left over', over: 'Over' };
  return `<div class="card ck keep-open">
    <div class="ck-top"><span>${esc(monthLabel(month))}</span>${state.derived.incomplete?.has(month) ? '<span class="warn-text">statement missing</span>' : ''}</div>
    <div class="ck-main"><div class="ck-ring" style="background:${ring(segs, total)}"><div class="ck-center"><span class="ck-k">Left over</span><b class="${left < 0 ? 'neg' : 'pos'}">${fmt(left, { whole: true, sign: true })}</b><span class="ck-s">${s.income ? `${Math.round((left / s.income) * 100)}% of income` : ''}</span></div></div>
      <div class="ck-legend"><div class="ck-leg"><i style="background:var(--good)"></i><span>Came in</span><b>${fmt(s.income, { whole: true })}</b></div>${segs.map(([k, v]) => `<button class="ck-leg" data-action="explain" data-what="${k === 'spent' ? 'spent' : k === 'paid' ? 'saved' : 'left'}"><i style="background:${COLORS[k]}"></i><span>${lab[k]}</span><b>${fmt(v, { whole: true })}</b></button>`).join('')}</div></div>
    <div class="ck-quick"><a class="chip" href="#/history">Monthly record ›</a><button class="chip" data-action="ov-share">Share ⇪</button></div></div>`;
}

// The slider moves the numbers straight away (no re-render, so dragging stays smooth).
document.addEventListener('input', (e) => {
  if (e.target.id !== 'ck-range') return;
  const card = e.target.closest('.ck');
  const b = JSON.parse(card.dataset.ck);
  const extra = +e.target.value;
  const v = live(b, extra);
  card.querySelector('.ck-ring').style.background = v.ring;
  card.querySelector('.ck-center').innerHTML = v.center;
  card.querySelector('.ck-legend').innerHTML = v.legend;
  card.querySelector('.ck-stats').innerHTML = v.stats;
  card.querySelector('#ck-x').textContent = fmt(extra, { whole: true });
});

export const cockpitActions = {
  'ck-go': (el) => {
    if (el.dataset.to === 'explain') { document.querySelector('[data-action=explain][data-what=spent]')?.click(); return; }
    location.hash = el.dataset.to;
  },
};
