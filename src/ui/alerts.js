// Notifications: small icon badges with counts (like app badges) instead of big banners.
// The same list opens from the 🔔 in the top bar on every page.
import { state, saveSettings } from '../state.js';
import { esc, openSheet, closeSheet } from './dom.js';
import { fmt } from '../lib/money.js';
import { catName } from '../lib/categories.js';
import { monthKey, monthLabel, prettyDate, nextDayOfMonth, addDays } from '../lib/dates.js';
import { monthOutlook, budgetAlerts } from '../lib/forecast.js';
import { summarizeMonth } from '../lib/analysis.js';
import { balanceForecast, paidThisMonth } from '../lib/cashflow.js';
import { checkinStatus } from './views/checkin.js';

/** Everything that needs your attention, most urgent first. */
export function buildAlerts() {
  const d = state.derived;
  if (!d || !state.txs.length) return [];
  const out = [];
  const today = d.today, month = monthKey(today);
  // Bounce risk: a bill due before payday that the balance can't cover.
  const cur = state.accounts.filter((a) => a.type === 'current' && a.balance != null);
  if (cur.length && d.payday) {
    const flags = state.settings.billFlags || {}, hidden = state.settings.billHidden || {};
    const live = d.recurring.filter((r) => r.category !== 'transfer' && !hidden[r.key] && flags[r.key] !== 'cancelled');
    const start = d.balance ?? cur.reduce((a, x) => a + x.balance, 0);
    const fc = balanceForecast({ start, today, until: nextDayOfMonth(addDays(today, 1), d.payday), recurring: live, paidKeys: paidThisMonth(live, state.txs, month, state.settings.billPaid) });
    const bad = fc.rows.filter((r) => r.balance < 0 && r.outflow > 0);
    if (bad.length) out.push({ id: 'bounce', icon: '⚠️', label: 'Bounce risk', count: bad.length, tone: 'bad', title: `A bill could bounce on ${prettyDate(bad[0].date)}`, detail: `Your balance could drop to ${fmt(bad[0].balance, { whole: true })} when ${bad[0].items.filter((r) => r.direction === 'out').map((r) => r.name).join(', ')} leave${bad[0].items.length === 1 ? 's' : ''}. Top up the account or move the date.`, href: '#/bills', go: 'Open calendar', sig: bad[0].date + bad[0].balance });
  }
  const mo = monthOutlook({ txs: state.txs, today, budget: d.budget, recurring: d.recurring });
  const al = budgetAlerts({ txs: state.txs, today, budget: d.budget });
  const over = al.filter((a) => a.status === 'over'), heading = al.filter((a) => a.status === 'heading');
  if (over.length || heading.length || mo.status !== 'ok') out.push({ id: 'track', icon: '🎯', label: 'Budgets', count: over.length + heading.length || 1, tone: mo.status === 'short' || over.length ? 'bad' : 'warn', title: mo.status === 'short' ? 'Short this month at this pace' : over.length ? 'Over budget' : 'Watch your spending', detail: [mo.status !== 'ok' && `Heading for ${fmt(mo.left, { whole: true, sign: true })} at month end.`, over.length && `Over: ${over.map((a) => catName(a.category)).join(', ')}.`, heading.length && `Heading over: ${heading.map((a) => catName(a.category)).join(', ')}.`].filter(Boolean).join(' '), href: '#/track', go: 'On track', sig: `${mo.status}|${over.length}|${heading.length}` });
  const missing = d.coverage.missing;
  if (missing.length) out.push({ id: 'missing', icon: '📄', label: 'Statements', count: missing.length, tone: 'warn', title: `${missing.length} statement${missing.length > 1 ? 's' : ''} missing`, detail: `Totals are too low without them: ${missing.slice(0, 4).map((m) => `${m.accountName} ${monthLabel(m.month, { short: true })}`).join(', ')}${missing.length > 4 ? '…' : ''}.`, href: '#/accounts', go: 'Review accounts', sig: missing.map((m) => m.accountId + m.month).join(',') });
  if (d.duplicates.length) out.push({ id: 'dups', icon: '♊', label: 'Duplicates', count: d.duplicates.length, tone: 'warn', title: `${d.duplicates.length} duplicate transaction${d.duplicates.length > 1 ? 's' : ''}`, detail: 'Imported twice, so totals are inflated until you remove them.', href: '#/accounts', go: 'Fix', sig: d.duplicates.length });
  const s = summarizeMonth(state.txs, state.month || month), b = d.budget;
  if ((b.income > 0 && s.income > b.income * 1.8) || (b.avgSpend > 0 && s.spend > b.avgSpend * 1.8) || (s.spend > 0 && s.income > 0 && s.spend > s.income * 1.5)) out.push({ id: 'off', icon: '🔍', label: 'Check totals', count: 1, tone: 'warn', title: 'These totals look too high', detail: 'Usually money moving between your own accounts counted as spending and income, or an account imported twice.', href: '#/audit', go: 'Check my numbers', sig: Math.round(s.spend / 10000) + '|' + Math.round(s.income / 10000) });
  if (d.suspects.length) out.push({ id: 'cards', icon: '💳', label: 'Card?', count: d.suspects.length, tone: 'info', title: `${d.suspects.length} account${d.suspects.length > 1 ? 's' : ''} may be a credit card`, detail: 'Confirm so card spending and balances are counted correctly.', href: '#/cards', go: 'Confirm', sig: d.suspects.length });
  const ci = checkinStatus();
  if (!ci.complete && d.months.includes(ci.month)) out.push({ id: 'checkin', icon: '✅', label: 'Check-in', count: 4 - ci.done, tone: 'info', title: `${monthLabel(ci.month)} check-in: ${ci.done}/4 done`, detail: 'Import, tidy up, review, plan: about 10 minutes.', href: '#/checkin', go: 'Start', sig: ci.done });
  const rises = d.recurring.filter((r) => r.active && r.direction === 'out' && r.priceChange > 0);
  if (rises.length) out.push({ id: 'rises', icon: '📈', label: 'Price rises', count: rises.length, tone: 'info', title: `${rises.length} bill${rises.length > 1 ? 's' : ''} went up`, detail: rises.map((r) => `${r.name} +${fmt(r.priceChange)}`).join(', '), href: '#/bills', go: 'See bills', sig: rises.map((r) => r.key).join(',') });
  const hiddenB = state.settings.hiddenBanners || {};
  return out.filter((a) => hiddenB['alert:' + a.id] !== String(a.sig));
}

/** Row of small badges for the Overview. */
export function alertStrip(list = buildAlerts()) {
  if (!list.length) return '<div class="alert-strip ok"><span class="as-ok">✓ Nothing needs your attention</span></div>';
  return `<div class="alert-strip" role="list">${list.map((a) => `<button class="as-item ${a.tone}" role="listitem" data-action="alert-open" data-id="${a.id}" aria-label="${esc(a.title)}"><span class="as-ic">${a.icon}<b class="as-badge">${a.count > 99 ? '99+' : a.count}</b></span><small>${esc(a.label)}</small></button>`).join('')}</div>`;
}

/** Update the 🔔 count in the top bar. */
export function updateBell() {
  const el = document.getElementById('bell-count');
  if (!el) return;
  const n = buildAlerts().length;
  el.textContent = n > 9 ? '9+' : String(n);
  el.hidden = !n;
  document.getElementById('bell-btn')?.setAttribute('aria-label', n ? `${n} notification${n > 1 ? 's' : ''}` : 'No notifications');
}

function listSheet(focus) {
  const list = buildAlerts();
  openSheet(`<h2>Notifications</h2>
    ${list.length ? list.map((a) => `<div class="act-item alert-item ${a.tone} ${a.id === focus ? 'focus' : ''}" id="alert-${a.id}">
      <div class="row between"><span class="as-ic small">${a.icon}</span><b class="grow">${esc(a.title)}</b></div>
      <div class="sub">${esc(a.detail)}</div>
      <div class="row gap wrap"><a class="chip sel" href="${esc(a.href)}">${esc(a.go)} ›</a><button class="chip" data-action="alert-hide" data-id="${a.id}" data-sig="${esc(String(a.sig))}">Dismiss</button></div></div>`).join('')
    : '<p class="muted">✓ Nothing needs your attention right now.</p>'}
    <button class="btn ghost full" data-action="close-sheet">Done</button>`, { wide: true });
  if (focus) document.getElementById('alert-' + focus)?.scrollIntoView({ block: 'nearest' });
}

export const alertActions = {
  'alert-open': (el) => listSheet(el.dataset.id),
  'bell-open': () => listSheet(),
  'alert-hide': async (el, rerender) => {
    await saveSettings({ hiddenBanners: { ...(state.settings.hiddenBanners || {}), ['alert:' + el.dataset.id]: el.dataset.sig } });
    el.closest('.alert-item')?.remove();
    rerender();
    if (!document.querySelector('.alert-item')) closeSheet();
  },
};
