// "Due soon": what's coming out in the next few days. Built to be opened by a daily
// iPhone Shortcut automation (Shortcuts → Automation → Time of Day → Open URL …/#/due).
import { state, accountName } from '../../state.js';
import { esc, shareFile, toast } from '../dom.js';
import { fmt } from '../../lib/money.js';
import { addDays, prettyDate } from '../../lib/dates.js';
import { billsCalendar } from '../../lib/ics.js';
import { catChip } from '../common.js';

let days = 7;
export function applyParams(params) { days = Math.max(1, Math.min(31, +(params.get('days') || 7))); }

export function render() {
  const { recurring, today, balance } = state.derived;
  const until = addDays(today, days);
  const due = recurring.filter((r) => r.direction === 'out' && r.active && r.nextDue >= today && r.nextDue <= until).sort((a, b) => a.nextDue.localeCompare(b.nextDue));
  const tomorrow = addDays(today, 1);
  const soon = due.filter((r) => r.nextDue <= tomorrow);
  const total = due.reduce((a, r) => a + r.amount, 0);
  const label = (d) => (d === today ? 'Today' : d === tomorrow ? 'Tomorrow' : prettyDate(d));
  let lastDay = '';
  return `
  <h1 class="page-title">Due soon</h1>
  <div class="card hero feature">
    <div class="label">${soon.length ? 'Today & tomorrow' : `Next ${days} days`}</div>
    <div class="big">${fmt(soon.length ? soon.reduce((a, r) => a + r.amount, 0) : total)}</div>
    <div class="sub">${soon.length ? `${soon.length} payment${soon.length > 1 ? 's' : ''}: ${soon.map((r) => esc(r.name)).join(', ')}` : due.length ? 'Nothing due today or tomorrow' : 'Nothing due'}${balance != null ? ` · current accounts ${fmt(balance)}` : ''}</div>
    ${balance != null && total > balance ? `<div class="alert">Your current accounts (${fmt(balance)}) don't cover the ${fmt(total)} due in the next ${days} days.</div>` : ''}
  </div>
  <div class="seg">${[1, 7, 31].map((n) => `<button class="${days === n ? 'on' : ''}" data-action="due-days" data-n="${n}">${n === 1 ? 'Tomorrow' : n === 7 ? '7 days' : 'Month'}</button>`).join('')}</div>
  <div class="card">
    ${due.map((r) => { const head = r.nextDue !== lastDay ? `<div class="date-head">${label(r.nextDue)}</div>` : ''; lastDay = r.nextDue; return `${head}<div class="list-row">${catChip(r.category)}<div class="grow">${esc(r.name)}<div class="sub">${esc(r.type)} · ${esc(accountName(r.accountId))}</div></div><b>${fmt(r.amount)}</b></div>`; }).join('') || '<p class="muted">No regular payments due in this window.</p>'}
  </div>
  <button class="btn primary full" data-action="due-calendar">📅 Add all bills to Calendar (reminder the day before)</button>
  <p class="sub center">Calendar alerts work even when the app is closed. Re-add after big changes to your bills.</p>`;
}

export async function addBillsToCalendar() {
  const byId = Object.fromEntries((state.allAccounts || state.accounts).map((a) => [a.id, a]));
  const ics = billsCalendar(state.derived.recurring, byId);
  const n = (ics.match(/BEGIN:VEVENT/g) || []).length;
  if (!n) return toast('No regular payments found yet', { error: true });
  await shareFile('pocket-ledger-bills.ics', ics, 'text/calendar');
  toast(`${n} bills ready. Tap "Add All" in Calendar.`);
}

export const actions = {
  'due-days': (el, rerender) => { location.hash = `#/due?days=${el.dataset.n}`; void rerender; },
  'due-calendar': () => addBillsToCalendar(),
};
