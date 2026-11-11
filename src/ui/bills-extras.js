// Regular payments, round three: yearly bills pot, what changed this month, cost creep over a year,
// overlapping subscriptions, funding each paying account, notes and how-to-cancel per bill, a
// housing ceiling from income, a stress test, and a CSV of every regular payment.
import { state, saveSettings, recompute, accountName } from '../state.js';
import { esc, openSheet, closeSheet, toast, shareFile } from './dom.js';
import { fmt, parsePrice } from '../lib/money.js';
import { catName } from '../lib/categories.js';
import { monthKey, monthLabel, prettyDate, addDays, addMonths, nextDayOfMonth } from '../lib/dates.js';
import { live, income } from './afford-extras.js';
import { sum } from '../lib/util.js';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const allTx = () => state.allTxs || state.txs;
const outRegular = () => {
  const hidden = state.settings.billHidden || {};
  return state.derived.recurring.filter((r) => r.direction === 'out' && (r.category !== 'transfer' || r.cardRepay) && !hidden[r.key]);
};
const firstSeen = (r, byId) => (r.txIds || []).map((id) => byId.get(id)?.date).filter(Boolean).sort()[0] || r.lastDate;

// ---------- 1. Yearly bills pot ----------
const YEARLY_HINT = /\b(TV ?LICEN[CS]E|DVLA|VEHICLE TAX|MOT\b|INSURANCE|INSURE|ADMIRAL|AVIVA|DIRECT LINE|LV=|CHURCHILL|HASTINGS|AA\b|RAC\b|GREEN FLAG|BREAKDOWN|ANNUAL|YEARLY|PRIME|COSTCO|NATIONAL TRUST|ENGLISH HERITAGE|DOMAIN|RAILCARD)\b/i;
function yearlySuggestions() {
  const today = state.derived.today;
  const since = addDays(today, -395);
  const known = new Set([...outRegular().map((r) => r.name.toUpperCase()), ...(state.settings.yearlyBills || []).map((b) => b.name.toUpperCase())]);
  const by = {};
  for (const t of state.txs) {
    if (t.date < since || t.amount > -3000 || t.category === 'transfer' || t.category === 'housing') continue;
    const k = (t.merchant || t.description).toUpperCase();
    (by[k] ||= []).push(t);
  }
  return Object.entries(by)
    .filter(([k, ts]) => !known.has(k) && ts.length <= 2 && (YEARLY_HINT.test(k + ' ' + ts[0].description) || ['insurance'].includes(ts[0].category)) && (ts.length === 1 || Math.abs(new Date(ts[0].date) - new Date(ts[1].date)) > 300 * 864e5))
    .map(([k, ts]) => { const t = ts.sort((a, b) => b.date.localeCompare(a.date))[0]; return { name: t.merchant || k, amount: -t.amount, month: +t.date.slice(5, 7) }; })
    .sort((a, b) => b.amount - a.amount).slice(0, 5);
}
export function yearlyPotCard() {
  const list = state.settings.yearlyBills || [];
  const sugg = yearlySuggestions();
  const curM = +state.derived.today.slice(5, 7);
  const total = sum(list);
  const monthly = Math.ceil(total / 12 / 100) * 100;
  const shouldHave = list.reduce((a, b) => a + Math.round((b.amount * ((curM - b.month + 12) % 12)) / 12), 0);
  const next = [...list].map((b) => ({ ...b, inM: (b.month - curM + 12) % 12 })).sort((x, y) => x.inM - y.inM);
  return `<div class="card"><h3>Yearly bills pot ${total ? `<small class="muted">${fmt(monthly, { whole: true })}/mo</small>` : ''}</h3>
    <p class="sub">Car insurance, TV licence, MOT, breakdown cover, annual subscriptions: paid once a year, so they never show as regular bills and land as a shock. ${total ? `Put <b>${fmt(monthly, { whole: true })} a month</b> into a separate pot and they're always covered.` : 'Add them here to see what to put aside each month.'}</p>
    ${next.map((b) => `<div class="pt-row two"><span>${esc(b.name)} <small class="muted">${MON[b.month - 1]}${b.inM === 0 ? ' · this month' : b.inM === 1 ? ' · next month' : ` · in ${b.inM} months`}</small></span><span class="row gap"><b>${fmt(b.amount, { whole: true })}</b><button class="chip" data-action="yb-del" data-id="${esc(b.id)}" aria-label="Remove ${esc(b.name)}">✕</button></span></div>`).join('')}
    ${total ? `<div class="stat-grid"><div><span class="label">A year</span><b>${fmt(total, { whole: true })}</b></div><div><span class="label">Should be in the pot now</span><b>${fmt(shouldHave, { whole: true })}</b></div></div>` : ''}
    ${sugg.length ? `<p class="sub">Looks yearly in your statements:</p><div class="row gap wrap">${sugg.map((s) => `<button class="chip" data-action="yb-add-sugg" data-name="${esc(s.name)}" data-amount="${s.amount}" data-month="${s.month}">＋ ${esc(s.name)} ${fmt(s.amount, { whole: true })} (${MON[s.month - 1]})</button>`).join('')}</div>` : ''}
    <button class="btn ghost full" data-action="yb-sheet">＋ Add a yearly bill</button></div>`;
}
function yearlySheet() {
  openSheet(`<h2>Add a yearly bill</h2>
    <label class="field"><span>Name</span><input id="yb-name" placeholder="e.g. Car insurance"></label>
    <div class="plan-grid"><label class="field"><span>Amount £ a year</span><input id="yb-amt" inputmode="decimal" placeholder="0.00"></label>
      <label class="field select"><span>Month it's paid</span><select id="yb-month">${MON.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('')}</select></label></div>
    <button class="btn primary full" data-action="yb-save">Save</button><button class="btn ghost full" data-action="close-sheet">Cancel</button>`);
}

// ---------- 2. What changed this month ----------
export function changesCard() {
  const today = state.derived.today;
  const byId = new Map(allTx().map((t) => [t.id, t]));
  const flags = state.settings.billFlags || {};
  const all = outRegular();
  // New only if that account's statements go back further: otherwise it's just where your records start.
  const accStart = state.derived.accountStart;
  const fresh = all.filter((r) => r.active && !r.manual && r.months <= 2 && firstSeen(r, byId) >= addDays(today, -62) && firstSeen(r, byId) > addDays(accStart[r.accountId] || today, 35));
  const stopped = all.filter((r) => !r.active && !r.manual && r.lastDate >= addDays(today, -120));
  const changed = all.filter((r) => r.active && r.priceChange);
  if (!fresh.length && !stopped.length && !changed.length) return '';
  const net = sum(fresh) + sum(changed, (r) => r.priceChange) - sum(stopped);
  const line = (r, right, note) => `<button class="list-row tap" data-action="bill-open" data-key="${esc(r.key)}"><div class="grow"><div class="ellipsis">${esc(r.name)}</div><div class="sub">${note}</div></div><b>${right}</b></button>`;
  return `<div class="card"><h3>What changed <small class="${net > 0 ? 'neg' : 'pos'}">${fmt(net, { whole: true, sign: true })}/mo</small></h3>
    ${fresh.length ? `<div class="label">New</div>${fresh.map((r) => line(r, `+${fmt(r.amount)}`, `Started ${prettyDate(firstSeen(r, byId))}${['subscriptions', 'entertainment', 'fitness'].includes(r.category) ? ': meant to sign up? Free trials turn into payments like this.' : '.'}`)).join('')}` : ''}
    ${changed.length ? `<div class="label">Price changed</div>${changed.map((r) => line(r, `${r.priceChange > 0 ? '+' : ''}${fmt(r.priceChange)}`, `Now ${fmt(r.amount)} a month${r.priceChange > 0 ? ': ask for a better price or switch' : ''}`)).join('')}` : ''}
    ${stopped.length ? `<div class="label">Stopped</div>${stopped.map((r) => line(r, `−${fmt(r.amount)}`, flags[r.key] === 'cancelled' || flags[r.key] === 'cancel' ? '✓ Cancelled: no payment since ' + prettyDate(r.lastDate) : `Last paid ${prettyDate(r.lastDate)}. Didn't cancel it? Check it hasn't failed, or that the statement is imported.`)).join('')}` : ''}
  </div>`;
}

// ---------- 3. Cost creep: regular payments month by month ----------
export function billTrendCard() {
  const d = state.derived;
  const byId = new Map(allTx().map((t) => [t.id, t]));
  const cur = monthKey(d.today);
  const per = {};
  for (const r of outRegular()) for (const id of r.txIds || []) { const t = byId.get(id); if (t) per[monthKey(t.date)] = (per[monthKey(t.date)] || 0) - t.amount; }
  const months = Object.keys(per).filter((m) => m < cur && m >= addMonths(cur, -12) && !d.incomplete?.has(m)).sort();
  if (months.length < 3) return '';
  const vals = months.map((m) => per[m]);
  const hi = Math.max(...vals);
  const avg = (l) => sum(l, (x) => x) / l.length;
  const a = avg(vals.slice(0, 3)), b = avg(vals.slice(-3));
  const diff = b - a, pc = a ? Math.round((diff / a) * 100) : 0;
  return `<div class="card"><h3>Regular payments over the year</h3>
    <div class="trend-bars" role="img" aria-label="Regular payments per month">${months.map((m, i) => `<span style="height:${Math.max(4, Math.round((vals[i] / hi) * 100))}%" title="${esc(monthLabel(m))}: ${fmt(vals[i], { whole: true })}"><i>${esc(monthLabel(m, { short: true }).slice(0, 3))}</i></span>`).join('')}</div>
    <p class="sub">${Math.abs(pc) < 3 ? `Steady at about ${fmt(b, { whole: true })} a month: no creep.` : `<b class="${diff > 0 ? 'neg' : 'pos'}">${diff > 0 ? 'Up' : 'Down'} ${fmt(Math.abs(diff), { whole: true })} a month (${Math.abs(pc)}%)</b> from ${fmt(a, { whole: true })} to ${fmt(b, { whole: true })}${diff > 0 ? `: ${fmt(diff * 12, { whole: true })} more a year. New subscriptions and price rises add up quietly; "What changed" shows which.` : '.'}`}</p></div>`;
}

// ---------- 4. Overlapping subscriptions ----------
const FAMILIES = [
  ['Video streaming', /NETFLIX|DISNEY|PRIME VIDEO|AMAZON PRIME|NOW ?TV|NOWTV|PARAMOUNT|APPLE TV|BRITBOX|DAZN|DISCOVERY|ITVX|SKY (Q|TV|GLASS)|TNT SPORT/i],
  ['Music', /SPOTIFY|APPLE MUSIC|YOUTUBE (MUSIC|PREMIUM)|AMAZON MUSIC|DEEZER|TIDAL/i],
  ['Cloud storage', /ICLOUD|APPLE\.COM\/BILL|GOOGLE (ONE|STORAGE)|DROPBOX|ONEDRIVE|MICROSOFT ?365|MSFT/i],
  ['AI tools', /OPENAI|CHATGPT|ANTHROPIC|CLAUDE\.AI|MIDJOURNEY|PERPLEXITY|COPILOT/i],
  ['Gym & fitness', /GYM|PURE ?GYM|THE GYM|DAVID LLOYD|NUFFIELD|BANNATYNE|STRAVA|PELOTON|FITBIT/i],
  ['Food boxes', /HELLO ?FRESH|GOUSTO|MINDFUL CHEF|GREEN CHEF|DELIVEROO PLUS|UBER ONE|JUST EAT\+/i],
];
export function overlapsCard() {
  const flags = state.settings.billFlags || {};
  const subs = live();
  const groups = FAMILIES.map(([label, re]) => [label, subs.filter((r) => re.test(r.name + ' ' + (r.description || '')))]).filter(([, l]) => l.length >= 2);
  if (!groups.length) return '';
  return `<div class="card"><h3>Paying twice for the same thing?</h3>
    ${groups.map(([label, l]) => { const cheapest = [...l].sort((a, b) => a.amount - b.amount)[0]; return `<div class="cal-tip"><b>${l.length} ${esc(label.toLowerCase())} · ${fmt(sum(l))}/mo</b><span>${esc(l.map((r) => `${r.name} ${fmt(r.amount)}`).join(', '))}. Keep one and rotate: cancel the rest and switch month to month. Keeping just the cheapest (${esc(cheapest.name)}) saves ${fmt((sum(l) - cheapest.amount) * 12, { whole: true })} a year.</span>
      <div class="row gap wrap">${l.filter((r) => r !== cheapest).map((r) => `<button class="chip ${flags[r.key] === 'cancel' ? 'sel' : ''}" data-action="act-flag" data-key="${esc(r.key)}">${flags[r.key] === 'cancel' ? '✓' : '＋'} Cancel ${esc(r.name)}</button>`).join('')}</div></div>`; }).join('')}
  </div>`;
}

// ---------- 5. Fund each paying account ----------
export function fundAccountsCard() {
  const d = state.derived;
  const items = live();
  const byAcc = {};
  for (const r of items) (byAcc[r.accountId || ''] ||= []).push(r);
  const ids = Object.keys(byAcc);
  if (ids.length < 2) return '';
  const nextPay = d.payday ? nextDayOfMonth(addDays(d.today, 1), d.payday) : null;
  const accs = state.allAccounts || state.accounts;
  return `<div class="card"><h3>What each account needs</h3>
    <p class="sub">Your regular payments leave from ${ids.length} accounts. Each needs its share in it by the first date, or a payment can bounce.</p>
    ${ids.sort((a, b) => sum(byAcc[b]) - sum(byAcc[a])).map((id) => {
      const l = byAcc[id];
      const a = accs.find((x) => x.id === id);
      const first = l.map((r) => r.nextDue).sort()[0];
      const before = nextPay ? sum(l.filter((r) => r.nextDue < nextPay)) : 0;
      const short = a?.balance != null && before > a.balance ? before - a.balance : 0;
      return `<div class="pt-row two"><span>${esc(id ? accountName(id) : 'Account not known')} <small class="muted">${l.length} payment${l.length > 1 ? 's' : ''} · first ${prettyDate(first)}${short ? ` · <span class="neg">short ${fmt(short, { whole: true })} before payday</span>` : ''}</small></span><b>${fmt(sum(l), { whole: true })}/mo</b></div>`;
    }).join('')}
    <a class="act-link" href="#/movebills">Fewer accounts to watch: move bills ›</a></div>`;
}

// ---------- 6. Notes and how to cancel, per bill ----------
export function billNoteHtml(r) {
  const n = (state.settings.billNotes || {})[r.key];
  if (!n?.note && !n?.link) return '';
  return `<div class="bill-note">${n.note ? `📝 ${esc(n.note)}` : ''}${n.link ? ` <a href="${esc(/^https?:/i.test(n.link) ? n.link : 'https://' + n.link)}" target="_blank" rel="noopener">Account page ↗</a>` : ''}</div>`;
}
function noteSheet(key) {
  const r = state.derived.recurring.find((x) => x.key === key);
  if (!r) return;
  const n = (state.settings.billNotes || {})[key] || {};
  openSheet(`<h2>Notes: ${esc(r.name)}</h2>
    <p class="muted">Customer number, notice period, what's included, when you last asked for a better price. Stays on this phone.</p>
    <label class="field"><span>Note</span><textarea id="bn-note" rows="4" placeholder="e.g. 30 days' notice. Asked for retention deal Mar.">${esc(n.note || '')}</textarea></label>
    <label class="field"><span>Website for your account (optional)</span><input id="bn-link" inputmode="url" value="${esc(n.link || '')}" placeholder="e.g. example.com/account"></label>
    <button class="btn primary full" data-action="bn-save" data-key="${esc(key)}">Save</button><button class="btn ghost full" data-action="close-sheet">Cancel</button>`);
}
function cancelSheet(key) {
  const r = state.derived.recurring.find((x) => x.key === key);
  if (!r) return;
  const t = r.type || '';
  const steps = /Direct Debit/i.test(t)
    ? ['Cancel the contract or service with the company first: stopping the Direct Debit alone doesn\'t end the contract and can leave you owing.', 'Then cancel the Direct Debit in your banking app (Direct Debits list). It takes effect at once.', 'If a payment is taken after you cancelled, the Direct Debit Guarantee means your bank must refund it straight away.']
    : /Standing/i.test(t)
      ? ['Standing orders are set up by you: cancel it in your banking app (Standing orders / Payments). It stops at once.', 'If it pays for a contract (rent, a loan), tell them first, or it can count as a missed payment.']
      : ['Card or app subscription: cancel in the app or on the website (iPhone subscriptions: Settings › your name › Subscriptions).', 'Cancel before the renewal date. Most let you use it until the end of the paid period.', 'If they keep charging after you cancelled, ask your bank to stop future payments to that company and dispute the charge: card payments can be stopped by the bank, and the money refunded via a chargeback.'];
  openSheet(`<h2>How to cancel ${esc(r.name)}</h2>
    <p class="muted">${esc(t)} · ${fmt(r.amount)} a month · ${fmt(r.amount * 12, { whole: true })} a year · next ${prettyDate(r.nextDue)}</p>
    <ol class="act-steps">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}<li>${esc('In a contract (phone, broadband, gym)? Check the notice period and any exit fees. Out of contract, many will cut the price if you say you\'re leaving.')}</li></ol>
    <div class="row gap wrap"><button class="chip sel" data-action="act-flag" data-key="${esc(key)}">＋ Cancel list</button><button class="chip" data-action="bn-open" data-key="${esc(key)}">📝 Add a note</button></div>
    <button class="btn ghost full" data-action="close-sheet">Done</button>`, { wide: true });
}

// ---------- 7. Housing ceiling from income ----------
const loanFor = (pmt, ratePc, years) => { const r = ratePc / 100 / 12, n = years * 12; return r ? (pmt * (1 - (1 + r) ** -n)) / r : pmt * n; };
export function housingCard() {
  const inc = income();
  if (!inc) return '';
  const m = state.settings.mortgage || {};
  const rate = m.rate || 4.5, years = m.termYears || 30;
  const housing = sum(live().filter((r) => r.category === 'housing'));
  const pct = housing ? Math.round((housing / inc) * 100) : 0;
  const need = housing ? Math.ceil(housing / 0.35 / 10000) * 10000 : 0;
  return `<div class="card"><h3>How much rent or mortgage can we carry?</h3>
    <p class="sub">On take-home of <b>${fmt(inc, { whole: true })}</b> a month:</p>
    ${[[30, 'Comfortable'], [35, 'Stretch: usual upper limit'], [40, 'Tight: little room for anything going wrong']].map(([p, l]) => `<div class="pt-row two"><span>${p}% · ${l}</span><b>${fmt(Math.floor((inc * p) / 100 / 1000) * 1000, { whole: true })}/mo</b></div>`).join('')}
    ${housing ? `<div class="cal-tip ${pct > 40 ? 'bad' : ''}"><b>You pay ${fmt(housing, { whole: true })} · ${pct}% of take-home</b><span>${pct <= 35 ? 'Within the usual limit.' : `To be at 35% you'd need about <b>${fmt(need, { whole: true })} a month take-home</b>, or housing of ${fmt(Math.floor((inc * 0.35) / 1000) * 1000, { whole: true })}.`} As a mortgage at ${rate}% over ${years} years, ${fmt(housing, { whole: true })} a month repays about <b>${fmt(Math.round(loanFor(housing, rate, years) / 100000) * 100000, { whole: true })}</b>.</span></div>` : '<p class="sub">No rent or mortgage found in your regular payments: add it in Bills so this works.</p>'}
    <div class="act-links"><a class="act-link" href="#/plan">Mortgage planner ›</a><a class="act-link" href="#/bills">Bills ›</a></div></div>`;
}

// ---------- 8. Stress test ----------
const stress = { inc: 0, house: 0, bills: 0 };
function stressOut() {
  const inc0 = income(), items = live();
  const housing = sum(items.filter((r) => r.category === 'housing'));
  const other = sum(items) - housing;
  const inc = inc0 * (1 - stress.inc / 100);
  const commit = Math.max(0, housing + stress.house * 100) + other * (1 + stress.bills / 100);
  const left = inc - commit;
  const pct = inc ? Math.round((commit / inc) * 100) : 100;
  const base = inc0 - housing - other;
  return `<div class="stat-grid"><div><span class="label">Commitments, of income</span><b class="${pct > 65 ? 'neg' : pct > 50 ? 'warn-text' : 'pos'}">${pct}%</b></div><div><span class="label">Left after regular payments</span><b class="${left < 0 ? 'neg' : ''}">${fmt(left, { whole: true })}</b></div></div>
    <p class="sub">${left < 0 ? `<b class="neg">You'd be ${fmt(-left, { whole: true })} short every month.</b> That needs savings to cover it, or a bill cut first.` : `About ${fmt(left / 30, { whole: true })} a day for food, travel and everything else${base > left ? `, down ${fmt(base - left, { whole: true })} a month from today` : ''}.`}</p>`;
}
export function stressCard() {
  if (!income()) return '';
  const sl = (k, label, min, max, step, unit) => `<label class="field st-range"><span>${label} <b id="st-v-${k}">${unit === '£' ? fmt(stress[k] * 100, { whole: true, sign: true }) : stress[k] + '%'}</b></span><input type="range" min="${min}" max="${max}" step="${step}" value="${stress[k]}" data-input="st-in" data-id="${k}" aria-label="${esc(label)}"></label>`;
  const people = state.settings.people || [];
  return `<div class="card"><h3>Stress test</h3>
    <p class="sub">What if something changes? Slide to see whether the month still works.</p>
    <div class="row gap wrap"><button class="chip" data-action="st-preset" data-v="35,0,0">Maternity pay</button>${people.length > 1 ? '<button class="chip" data-action="st-preset" data-v="45,0,0">One of us stops earning</button>' : ''}<button class="chip" data-action="st-preset" data-v="0,150,0">Rent up £150</button><button class="chip" data-action="st-preset" data-v="0,0,10">Bills +10%</button><button class="chip" data-action="st-preset" data-v="0,0,0">Reset</button></div>
    ${sl('inc', 'Income drops by', 0, 60, 5, '%')}${sl('house', 'Rent/mortgage changes by', -1000, 1000, 50, '£')}${sl('bills', 'Other bills rise by', 0, 30, 5, '%')}
    <div id="st-out">${stressOut()}</div></div>`;
}

// ---------- 9. Export every regular payment ----------
function csv() {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const notes = state.settings.billNotes || {}, edits = state.settings.recurringEdits || {}, flags = state.settings.billFlags || {};
  const rows = state.derived.recurring.filter((r) => r.category !== 'transfer' || r.cardRepay).map((r) => [r.name, r.direction === 'in' ? 'In' : 'Out', catName(r.category), r.type, (r.amount / 100).toFixed(2), ((r.amount * 12) / 100).toFixed(2), r.day, r.nextDue, r.accountId ? accountName(r.accountId) : '', r.active ? 'Active' : 'Stopped', flags[r.key] || '', edits[r.key]?.contractEnd || '', notes[r.key]?.note || '']);
  for (const b of state.settings.yearlyBills || []) rows.push([b.name, 'Out', 'Yearly bill', 'Yearly', (b.amount / 1200).toFixed(2), (b.amount / 100).toFixed(2), '', MON[b.month - 1], '', 'Active', '', '', '']);
  return [['Name', 'Direction', 'Category', 'Type', 'Monthly £', 'Yearly £', 'Day', 'Next due', 'Account', 'Status', 'Flag', 'Contract ends', 'Note'], ...rows].map((r) => r.map(q).join(',')).join('\n');
}

export const billsExtraActions = {
  'yb-sheet': () => yearlySheet(),
  'yb-save': async (_, rerender) => {
    const name = document.getElementById('yb-name').value.trim(), amount = parsePrice(document.getElementById('yb-amt').value), month = +document.getElementById('yb-month').value;
    if (!name || !amount) return toast('Enter a name and amount', { error: true });
    await saveSettings({ yearlyBills: [...(state.settings.yearlyBills || []), { id: 'yb' + Date.now().toString(36), name, amount, month }] });
    closeSheet(); toast('Added to your yearly pot'); rerender();
  },
  'yb-add-sugg': async (el, rerender) => {
    await saveSettings({ yearlyBills: [...(state.settings.yearlyBills || []), { id: 'yb' + Date.now().toString(36), name: el.dataset.name, amount: +el.dataset.amount, month: +el.dataset.month }] });
    toast('Added to your yearly pot'); rerender();
  },
  'yb-del': async (el, rerender) => { await saveSettings({ yearlyBills: (state.settings.yearlyBills || []).filter((b) => b.id !== el.dataset.id) }); rerender(); },
  'bn-open': (el) => noteSheet(el.dataset.key),
  'bn-save': async (el, rerender) => {
    const note = document.getElementById('bn-note').value.trim(), link = document.getElementById('bn-link').value.trim();
    const all = { ...(state.settings.billNotes || {}) };
    if (note || link) all[el.dataset.key] = { note, link }; else delete all[el.dataset.key];
    await saveSettings({ billNotes: all }); recompute(); closeSheet(); toast('Note saved'); rerender();
  },
  'bill-cancelhow': (el) => cancelSheet(el.dataset.key),
  'st-preset': (el) => {
    [stress.inc, stress.house, stress.bills] = el.dataset.v.split(',').map(Number);
    for (const k of Object.keys(stress)) { const i = document.querySelector(`[data-input=st-in][data-id=${k}]`); if (i) i.value = stress[k]; }
    stressRefresh();
  },
  'bills-csv': async () => { await shareFile('regular-payments.csv', csv(), 'text/csv'); toast('Regular payments exported'); },
};
function stressRefresh() {
  for (const k of Object.keys(stress)) { const v = document.getElementById('st-v-' + k); if (v) v.textContent = k === 'house' ? fmt(stress[k] * 100, { whole: true, sign: true }) : stress[k] + '%'; }
  const o = document.getElementById('st-out'); if (o) o.innerHTML = stressOut();
}
export const billsExtraInputs = {
  'st-in': (el) => { stress[el.dataset.id] = +el.value; stressRefresh(); },
};
