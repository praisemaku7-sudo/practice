// Bills & subscriptions: everything that repeats, on a calendar, with a cancel list.
import { state, saveSettings, accountName } from '../../state.js';
import { esc, openSheet } from '../dom.js';
import { catName } from '../../lib/categories.js';
import { helpFor } from '../../lib/directory.js';
import { fmt } from '../../lib/money.js';
import { catKind } from '../../lib/categories.js';
import { monthKey, monthLabel, daysInMonth, prettyDate } from '../../lib/dates.js';
import { catChip, emptyState } from '../common.js';

const SUBS = new Set(['subscriptions', 'entertainment', 'fitness', 'personal_care']);
let calDays = {}, calKey = '', calPaid = new Set();

const FLAG_LABEL = { cancel: 'To cancel', cancelled: 'Cancelled' };

export function render() {
  const rec = state.derived.recurring.filter((r) => r.active);
  if (!rec.length) return emptyState({ title: 'Bills & subscriptions', body: 'Regular payments appear here once two months of statements are imported.' });
  const flags = state.settings.billFlags || {};
  const out = rec.filter((r) => r.direction === 'out' && r.category !== 'transfer');
  const bills = out.filter((r) => ['fixed', 'essential'].includes(catKind(r.category)));
  const subs = out.filter((r) => SUBS.has(r.category));
  const otherRegular = out.filter((r) => catKind(r.category) === 'personal' && !SUBS.has(r.category));
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
  calDays = byDay; calKey = key; calPaid = paidMerchants;
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push('<span class="cal-cell cal-blank" aria-hidden="true"></span>');
  for (let d = 1; d <= dim; d++) {
    const items = byDay[d] || [];
    const sum = items.reduce((a, r) => a + r.amount, 0);
    const paid = items.length && items.every((r) => paidMerchants.has(r.name));
    const cls = `cal-cell ${d === today ? 'today' : ''} ${items.length ? (paid ? 'paid' : 'due') : ''}`;
    const inner = `<i>${d}</i>${items.length ? `<small>£${sum >= 100000 ? (sum / 100000).toFixed(1).replace('.0', '') + 'k' : Math.round(sum / 100)}</small>` : ''}`;
    cells.push(items.length ? `<button class="${cls}" data-action="cal-day" data-d="${d}" aria-label="${d}: ${esc(items.map((r) => r.name).join(', '))}">${inner}</button>` : `<span class="${cls}">${inner}</span>`);
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
    <div class="legend"><span><i class="sw due-sw"></i>Due</span><span><i class="sw paid-sw"></i>Paid</span><span class="muted">Tap a day for details</span></div>
  </div>
  <div class="row gap"><a class="btn ghost grow" href="#/due">Due soon</a><button class="btn primary grow" data-action="due-calendar">📅 Add to Calendar</button></div>
  ${section('Bills', bills)}${section('Subscriptions', subs)}${section('Other regular payments', otherRegular)}${section('Saving', saving)}${section('Income', income)}`;
}

function daySheet(d) {
  const items = calDays[d] || [];
  if (!items.length) return;
  const flags = state.settings.billFlags || {};
  const main = state.settings.mainAccountId;
  const total = items.reduce((a, r) => a + r.amount, 0);
  openSheet(`<h2>${d} ${esc(monthLabel(calKey))}</h2>
    <p class="muted">${items.length} payment${items.length > 1 ? 's' : ''} · ${fmt(total)}</p>
    ${items.map((r) => {
      const h = helpFor(r.name);
      const paid = calPaid.has(r.name);
      const last = state.txs.filter((t) => t.merchant === r.name && t.amount < 0).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
      return `<div class="act-item">
        <div class="row between">${catChip(r.category)}<b class="grow">${esc(r.name)}</b><b>${fmt(r.amount)}</b></div>
        <div class="sub">${paid ? '<span class="pos">✓ Paid this month</span>' : '<span class="warn-text">Due</span>'} · ${esc(r.type)} · ${esc(catName(r.category))}</div>
        <div class="sub">From ${esc(accountName(r.accountId))}${last ? ` · last paid ${prettyDate(last.date)} (${fmt(-last.amount)})` : ''} · next ${prettyDate(r.nextDue)}</div>
        <div class="sub">${fmt(r.amount * 12, { whole: true })} a year${r.priceChange > 0 ? ` · <span class="warn-text">up ${fmt(r.priceChange)} recently</span>` : ''}</div>
        ${h ? `<div class="sub">${esc(h.how)}</div><a class="act-link" href="${esc(h.url)}" target="_blank" rel="noopener">Manage ${esc(h.label)} ↗</a>` : ''}
        <div class="row gap wrap">
          <button class="chip ${flags[r.key] === 'cancel' ? 'sel' : ''}" data-action="act-flag" data-key="${esc(r.key)}">${flags[r.key] === 'cancel' ? '✓ On my cancel list' : '＋ Add to cancel list'}</button>
          ${main && r.accountId !== main ? '<a class="chip" href="#/movebills" data-action="close-sheet-go" data-to="movebills">Move to main account ›</a>' : ''}
        </div>
      </div>`;
    }).join('')}
    <button class="btn ghost full" data-action="close-sheet">Done</button>`, { wide: true });
}

export const actions = {
  'cal-day': (el) => daySheet(+el.dataset.d),
  'bill-flag': async (el, rerender) => {
    const flags = { ...(state.settings.billFlags || {}) };
    const cur = flags[el.dataset.key];
    const next = !cur ? 'cancel' : cur === 'cancel' ? 'cancelled' : undefined;
    if (next) flags[el.dataset.key] = next; else delete flags[el.dataset.key];
    await saveSettings({ billFlags: flags });
    rerender();
  },
};
