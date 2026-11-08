// Bills & subscriptions: everything that repeats, on a calendar, with a cancel list.
import { state, saveSettings } from '../../state.js';
import { esc } from '../dom.js';
import { fmt } from '../../lib/money.js';
import { catKind } from '../../lib/categories.js';
import { monthKey, monthLabel, daysInMonth, prettyDate } from '../../lib/dates.js';
import { catChip, emptyState } from '../common.js';

const FLAG_LABEL = { cancel: 'To cancel', cancelled: 'Cancelled' };

export function render() {
  const rec = state.derived.recurring.filter((r) => r.active);
  if (!rec.length) return emptyState({ title: 'Bills & subscriptions', body: 'Regular payments appear here once two months of statements are imported.' });
  const flags = state.settings.billFlags || {};
  const out = rec.filter((r) => r.direction === 'out');
  const bills = out.filter((r) => ['fixed', 'essential'].includes(catKind(r.category)));
  const subs = out.filter((r) => catKind(r.category) === 'personal');
  const saving = out.filter((r) => catKind(r.category) === 'savings');
  const income = rec.filter((r) => r.direction === 'in');
  const live = out.filter((r) => flags[r.key] !== 'cancelled');
  const monthly = live.reduce((a, r) => a + r.amount, 0);
  const subsMonthly = subs.filter((r) => flags[r.key] !== 'cancelled').reduce((a, r) => a + r.amount, 0);
  const toCancel = out.filter((r) => flags[r.key] === 'cancel');

  // Calendar for this month.
  const key = monthKey(state.derived.today);
  const [y, m] = key.split('-').map(Number);
  const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Monday first
  const dim = daysInMonth(key);
  const paidMerchants = new Set(state.txs.filter((t) => monthKey(t.date) === key && t.amount < 0).map((t) => t.merchant));
  const byDay = {};
  for (const r of live) { const d = Math.min(r.day, dim); (byDay[d] ||= []).push(r); }
  const today = +state.derived.today.slice(8);
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push('<span class="cal-cell cal-blank" aria-hidden="true"></span>');
  for (let d = 1; d <= dim; d++) {
    const items = byDay[d] || [];
    const sum = items.reduce((a, r) => a + r.amount, 0);
    const paid = items.length && items.every((r) => paidMerchants.has(r.name));
    cells.push(`<span class="cal-cell ${d === today ? 'today' : ''} ${items.length ? (paid ? 'paid' : 'due') : ''}" title="${esc(items.map((r) => r.name).join(', '))}">
      <i>${d}</i>${items.length ? `<small>£${sum >= 100000 ? (sum / 100000).toFixed(1).replace('.0', '') + 'k' : Math.round(sum / 100)}</small>` : ''}</span>`);
  }

  const row = (r) => {
    const f = flags[r.key];
    const paid = paidMerchants.has(r.name);
    return `<div class="list-row ${f === 'cancelled' ? 'struck' : ''}">${catChip(r.category)}
      <div class="grow"><div class="ellipsis">${esc(r.name)} ${r.priceChange > 0 ? `<small class="pill warn">+${fmt(r.priceChange)}</small>` : ''}</div>
      <div class="sub">${esc(r.type)} · ${r.direction === 'in' ? 'arrives' : paid ? 'paid this month' : 'next'} ${prettyDate(r.nextDue)} · ${fmt(r.amount * 12, { whole: true })}/yr</div></div>
      <div class="bill-right"><b>${fmt(r.amount)}</b>${r.direction === 'out' ? `<button class="flag ${f || ''}" data-action="bill-flag" data-key="${esc(r.key)}">${FLAG_LABEL[f] || 'Keep'}</button>` : ''}</div></div>`;
  };
  const section = (title, list) => (list.length ? `<div class="card"><h3>${title} <small class="muted">${fmt(list.reduce((a, r) => a + r.amount, 0), { whole: true })}/mo</small></h3>${list.map(row).join('')}</div>` : '');

  return `
  <h1 class="page-title">Bills &amp; subscriptions</h1>
  <div class="card">
    <div class="stat-grid">
      <div><span class="label">Going out monthly</span><b>${fmt(monthly, { whole: true })}</b></div>
      <div><span class="label">Subscriptions / year</span><b>${fmt(subsMonthly * 12, { whole: true })}</b></div>
    </div>
    ${toCancel.length ? `<div class="tip-box"><b>Cancel list:</b> ${toCancel.map((r) => esc(r.name)).join(', ')} saves <b>${fmt(toCancel.reduce((a, r) => a + r.amount, 0))}/month</b> (${fmt(toCancel.reduce((a, r) => a + r.amount, 0) * 12, { whole: true })}/yr). Tap "To cancel" again once it's done.</div>` : '<p class="sub">Tap "Keep" on anything you want to cancel, to build a cancel list.</p>'}
  </div>
  <div class="card"><h3>${esc(monthLabel(key))}</h3>
    <div class="cal"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span>${cells.join('')}</div>
    <div class="legend"><span><i class="sw due-sw"></i>Due</span><span><i class="sw paid-sw"></i>Paid</span></div>
  </div>
  <div class="row gap"><a class="btn ghost grow" href="#/due">Due soon</a><button class="btn primary grow" data-action="due-calendar">📅 Add to Calendar</button></div>
  ${section('Bills', bills)}${section('Subscriptions', subs)}${section('Saving', saving)}${section('Income', income)}`;
}

export const actions = {
  'bill-flag': async (el, rerender) => {
    const flags = { ...(state.settings.billFlags || {}) };
    const cur = flags[el.dataset.key];
    const next = !cur ? 'cancel' : cur === 'cancel' ? 'cancelled' : undefined;
    if (next) flags[el.dataset.key] = next; else delete flags[el.dataset.key];
    await saveSettings({ billFlags: flags });
    rerender();
  },
};
