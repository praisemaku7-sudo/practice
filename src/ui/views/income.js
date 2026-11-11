// Income: each person's take-home and where it comes from (payslip first), temporary income such as
// maternity pay with its end date, household extras like Child Benefit, what's arrived this month,
// and how income changes over the next 12 months.
import { state, saveSettings, recompute, personName, estimatedIncome, txOwner } from '../../state.js';
import { esc, toast, openSheet, closeSheet } from '../dom.js';
import { fmt, parsePrice } from '../../lib/money.js';
import { monthKey, monthLabel, prettyDate, addMonths, daysBetween } from '../../lib/dates.js';
import { FREQ, toMonthly, personFor, tempFor, otherFor, householdFor, incomeTimeline } from '../../lib/income.js';

const KIND_PILL = { payslip: ['Payslip', 'ok'], sa302: ['SA302', 'ok'], typed: ['Typed in', ''], estimate: ['Estimated', 'warn'], none: ['Not set', 'warn'], temp: ['Temporary', ''] };
const PRESETS = [
  { label: 'Child Benefit (first child)', amount: 2605, freq: 'week', note: '2025/26 rate: check gov.uk for the current one' },
  { label: 'Child Benefit (each extra child)', amount: 1725, freq: 'week', note: '2025/26 rate' },
  { label: 'Universal Credit', amount: null, freq: 'month' },
  { label: 'Rental income', amount: null, freq: 'month' },
];

/** Income that has arrived this month, per person (money in categorised as income). */
function arrived(month) {
  const byId = Object.fromEntries((state.allAccounts || []).map((a) => [a.id, a]));
  const out = {};
  for (const t of state.allTxs || []) {
    if (t.category !== 'income' || monthKey(t.date) !== month || !byId[t.accountId]) continue;
    const who = txOwner(t, byId) || 'joint';
    out[who] = (out[who] || 0) + t.amount;
  }
  return out;
}

export function render() {
  const s = state.settings;
  const today = state.derived.today, month = monthKey(today);
  const now = householdFor(s, month, { estimate: estimatedIncome });
  const got = arrived(month);
  const gotTotal = Object.values(got).reduce((a, v) => a + v, 0);
  const tl = incomeTimeline(s, month, 12, { estimate: estimatedIncome, addMonths });
  const max = Math.max(1, ...tl.months.map((m) => m.total));
  const payday = state.derived.payday;

  const person = (p) => {
    const cur = personFor(s, p.id, month, estimatedIncome);
    const usual = personFor({ ...s, tempIncome: {} }, p.id, month, estimatedIncome);
    const temp = s.tempIncome?.[p.id];
    const slip = s.payslips?.[p.id];
    const sa = s.sa302s?.[p.id]?.[s.sa302s[p.id].length - 1];
    const [pill, pcls] = KIND_PILL[usual.kind];
    const stale = slip?.payDate && daysBetween(slip.payDate, today) > 45;
    return `<div class="card income-card">
      <div class="row between"><b class="grow">${esc(p.name)}</b><span class="inc-now">${fmt(cur.monthly, { whole: true })}<small>/month</small></span></div>
      <div class="inc-row"><div class="grow"><div>${cur.kind === 'temp' ? 'Usual take-home <span class="muted">(paused)</span>' : 'Take-home pay'}</div>
        <div class="sub">${usual.kind === 'payslip' && slip ? `${slip.count > 1 ? `Average of your last ${slip.usedDates?.length || 1} normal payslips` : `From payslip${slip.payDate ? ` paid ${prettyDate(slip.payDate)}` : ''}`}${slip.employer ? ` · ${esc(slip.employer)}` : ''}${slip.frequency && slip.frequency !== 'monthly' ? ` · paid ${esc(slip.frequency)}` : ''}`
          : usual.kind === 'sa302' && sa ? `From SA302 ${esc(sa.taxYear || '')}: ${fmt(sa.net || 0, { whole: true })} a year after tax`
          : usual.kind === 'estimate' ? 'Average of what arrived in their accounts over the last 3 months. Import a payslip for the exact figure.'
          : usual.kind === 'typed' ? 'Typed in' : 'Import a payslip, or type it in.'}</div>
        ${stale ? '<div class="sub warn-text">Latest payslip is over 6 weeks old: import the newest one.</div>' : ''}</div>
        <div class="inc-amt"><b>${fmt(usual.monthly, { whole: true })}</b><span class="pill ${pcls}">${pill}</span></div></div>
      ${(s.payslipHistory?.[p.id] || []).length ? `<details class="slip-hist"><summary class="sub">${s.payslipHistory[p.id].length} payslip${s.payslipHistory[p.id].length === 1 ? '' : 's'} · see each month</summary>
        ${s.payslipHistory[p.id].map((x) => `<div class="slip-row ${slip?.oneOffs?.includes(x.payDate) ? 'oneoff' : ''}"><span>${x.payDate ? `${prettyDate(x.payDate)} ${x.payDate.slice(0, 4)}` : esc(x.file || 'Payslip')}</span><span class="muted">${x.gross ? `gross ${fmt(x.gross, { whole: true })}` : ''}</span><b>${fmt(x.net)}</b>${slip?.oneOffs?.includes(x.payDate) ? '<small class="pill warn">one-off, not used</small>' : slip?.usedDates?.includes(x.payDate) ? '<small class="pill ok">used</small>' : '<small class="pill">older</small>'}</div>`).join('')}
      </details>` : ''}
      ${temp ? `<div class="inc-row ${cur.kind === 'temp' ? 'active' : 'muted'}"><div class="grow"><div>${esc(temp.label)}</div>
        <div class="sub">${temp.weekly ? `${fmt(temp.weekly)} a week · ` : ''}${temp.from ? `from ${esc(monthLabel(temp.from))} ` : ''}${temp.until ? `until ${esc(monthLabel(temp.until))}` : 'no end date set'}${cur.kind === 'temp' ? ' · replaces usual pay now' : temp.until && temp.until < month ? ' · ended' : ''}</div></div>
        <div class="inc-amt"><b>${fmt(temp.monthly, { whole: true })}</b></div></div>` : ''}
      ${temp?.until && (usual.kind === 'none' || usual.kind === 'estimate') ? `<div class="sub warn-text">After ${esc(monthLabel(temp.until))} there's no usual pay set${usual.kind === 'estimate' ? ' (only an estimate)' : ''}: add ${esc(p.name.split(' ')[0])}'s take-home (payslip, SA302 or typed) so the forecast knows what comes back.</div>` : ''}
      <div class="sub">Arrived this month: <b>${fmt(got[p.id] || 0, { whole: true })}</b>${cur.monthly ? ` of ${fmt(cur.monthly, { whole: true })}` : ''}</div>
      <div class="chip-grid">
        <button class="chip" data-action="import">📄 Import payslip</button>
        <button class="chip" data-action="inc-usual" data-id="${esc(p.id)}">✎ Take-home</button>
        <button class="chip" data-action="inc-temp" data-id="${esc(p.id)}">${temp ? '✎' : '＋'} Maternity / temporary</button>
      </div>
    </div>`;
  };

  const others = s.otherIncome || [];
  return `<h1 class="page-title">Income</h1>
  ${s.income != null ? `<div class="urgent soft"><b>Your budget uses ${fmt(s.income, { whole: true })} a month that you typed in Budget</b><span>Not the ${fmt(now.total, { whole: true })} worked out below. Every page uses the typed figure until you clear it.</span><button class="chip sel" data-action="inc-use-calc">Use ${fmt(now.total, { whole: true })} instead</button></div>` : ""}
  <div class="card hero">
    <div class="label">Household take-home · ${esc(monthLabel(month))}</div>
    <div class="big">${fmt(now.total, { whole: true })}<small>/month</small></div>
    <div class="cat-bar"><span style="width:${Math.min(100, (gotTotal / Math.max(now.total, 1)) * 100).toFixed(1)}%"></span></div>
    <div class="sub">${fmt(gotTotal, { whole: true })} arrived so far${payday ? ` · payday usually the ${payday}${['th', 'st', 'nd', 'rd'][payday % 10 > 3 || [11, 12, 13].includes(payday) ? 0 : payday % 10]}` : ''}</div>
    ${s.income != null && s.people.length > 1 ? `<div class="sub warn-text">A household total is typed in Budget (${fmt(s.income, { whole: true })}) and overrides everyone's pay. <button class="link" data-action="inc-clear-household">Use each person's pay instead</button></div>` : ''}
  </div>

  ${s.people.map(person).join('')}

  <div class="card">
    <h3>Household income</h3>
    <p class="sub">Child Benefit and anything else that isn't someone's pay.</p>
    ${others.map((x, i) => `<div class="inc-row"><div class="grow"><div>${esc(x.label)}</div><div class="sub">${fmt(x.amount)} ${esc(FREQ[x.freq])}${x.from ? ` · from ${esc(monthLabel(x.from))}` : ''}${x.until ? ` · until ${esc(monthLabel(x.until))}` : ''}${x.owner ? ` · ${esc(personName(x.owner))}` : ''}</div></div>
      <div class="inc-amt"><b>${fmt(toMonthly(x.amount, x.freq), { whole: true })}</b><span class="sub">/month</span></div><button class="link" data-action="inc-other" data-i="${i}">Edit</button></div>`).join('') || '<p class="muted">None yet.</p>'}
    <div class="chip-grid">${PRESETS.map((p, i) => (others.some((x) => x.label === p.label) ? '' : `<button class="chip" data-action="inc-other" data-preset="${i}">＋ ${esc(p.label)}</button>`)).join('')}<button class="chip" data-action="inc-other">＋ Other</button></div>
  </div>

  <div class="card">
    <h3>Next 12 months</h3>
    <div class="inc-tl">${tl.months.map((m) => `<div class="inc-tl-col" title="${esc(monthLabel(m.month))}: ${fmt(m.total, { whole: true })}"><span style="height:${Math.max(4, (m.total / max) * 100).toFixed(1)}%"></span><small>${esc(monthLabel(m.month, { short: true }).slice(0, 1))}</small></div>`).join('')}</div>
    ${tl.changes.length ? tl.changes.map((c) => `<div class="inc-row"><div class="grow"><div>${esc(monthLabel(c.month))}: ${esc(c.name)} · ${esc(c.why)}</div></div><b class="${c.to < c.from ? 'neg' : 'pos'}">${c.to < c.from ? '−' : '+'}${fmt(Math.abs(c.to - c.from), { whole: true })}</b></div>`).join('') : '<p class="sub">No changes coming up. Add an end date to maternity pay so the forecast knows when it stops.</p>'}
    <p class="sub">The On track forecast uses these month-by-month figures.</p>
  </div>`;
}

function personSheet(pid, rerender) {
  const cur = state.settings.scoped?.[pid]?.income ?? null;
  openSheet(`<h2>${esc(personName(pid))}'s take-home pay</h2>
    <p class="muted">What actually lands in the bank each month, after tax, pension and student loan: the "net pay" on the payslip. Importing a payslip fills this in for you.</p>
    <label class="field"><span>£ a month</span><input id="iu-amt" inputmode="decimal" value="${cur != null ? (cur / 100).toFixed(2) : ''}" placeholder="from your payslip"></label>
    <div class="row gap"><button class="btn ghost grow" id="iu-clear">Estimate from statements</button><button class="btn primary grow" id="iu-save">Save</button></div>`, {
    onMount(p) {
      const save = async (v) => {
        const scoped = { ...(state.settings.scoped || {}) };
        scoped[pid] = { ...(scoped[pid] || {}), income: v };
        const payslips = { ...(state.settings.payslips || {}) };
        // A typed amount that isn't the payslip's replaces it as the source.
        if (v == null || payslips[pid]?.monthlyNet !== v) delete payslips[pid];
        await saveSettings({ scoped, payslips });
        recompute(); closeSheet(); rerender(); toast('Income updated');
      };
      p.querySelector('#iu-save').onclick = () => { const v = parsePrice(p.querySelector('#iu-amt').value); if (v == null) return toast('Enter an amount', { error: true }); save(v); };
      p.querySelector('#iu-clear').onclick = () => save(null);
    },
  });
}

function tempSheet(pid, rerender) {
  const t = state.settings.tempIncome?.[pid] || { label: 'Maternity Allowance', monthly: null, weekly: null, from: null, until: null };
  openSheet(`<h2>Temporary income · ${esc(personName(pid))}</h2>
    <p class="muted">While it lasts it replaces their usual pay in every budget and forecast; their usual pay comes back after the end month.</p>
    <div class="chip-grid">${['Maternity Allowance', 'Statutory Maternity Pay', 'Paternity pay', 'Sick pay'].map((x) => `<button class="chip" data-preset="${esc(x)}">${esc(x)}</button>`).join('')}</div>
    <label class="field"><span>What</span><input id="tt-label" value="${esc(t.label)}"></label>
    <div class="plan-grid"><label class="field"><span>£ a week</span><input id="tt-week" inputmode="decimal" value="${t.weekly ? (t.weekly / 100).toFixed(2) : ''}" placeholder="optional"></label>
      <label class="field"><span>£ a month</span><input id="tt-month" inputmode="decimal" value="${t.monthly ? (t.monthly / 100).toFixed(2) : ''}"></label></div>
    <div class="plan-grid"><label class="field"><span>From</span><input id="tt-from" type="month" value="${esc(t.from || '')}"></label>
      <label class="field"><span>Until</span><input id="tt-until" type="month" value="${esc(t.until || '')}"></label></div>
    <div class="plan-grid"><label class="field"><span>Weeks</span><input id="tt-weeks" inputmode="numeric" placeholder="39"></label><button class="btn ghost" id="tt-calc">Work out end month</button></div>
    <p class="sub">Weekly amounts are turned into monthly as × 52 ÷ 12. Maternity Allowance and Statutory Maternity Pay last up to 39 weeks.</p>
    <div class="row gap">${state.settings.tempIncome?.[pid] ? '<button class="btn danger grow" id="tt-del">Remove</button>' : ''}<button class="btn primary grow" id="tt-save">Save</button></div>`, {
    onMount(p) {
      const $ = (id) => p.querySelector(id);
      p.querySelectorAll('[data-preset]').forEach((b) => { b.onclick = () => { $('#tt-label').value = b.dataset.preset; }; });
      $('#tt-week').oninput = () => { const w = parsePrice($('#tt-week').value); if (w) $('#tt-month').value = (toMonthly(w, 'week') / 100).toFixed(2); };
      $('#tt-calc').onclick = () => {
        const weeks = parseInt($('#tt-weeks').value, 10), from = $('#tt-from').value;
        if (!weeks || !from) return toast('Enter the start month and number of weeks', { error: true });
        $('#tt-until').value = addMonths(from, Math.max(0, Math.ceil((weeks * 7) / 30.44) - 1));
      };
      $('#tt-save').onclick = async () => {
        const monthly = parsePrice($('#tt-month').value);
        if (!monthly) return toast('Enter the amount', { error: true });
        const entry = { label: $('#tt-label').value.trim() || 'Temporary income', monthly, weekly: parsePrice($('#tt-week').value) || null, from: $('#tt-from').value || null, until: $('#tt-until').value || null };
        await saveSettings({ tempIncome: { ...(state.settings.tempIncome || {}), [pid]: entry } });
        recompute(); closeSheet(); rerender(); toast('Saved: budgets and forecasts use it');
      };
      const del = $('#tt-del');
      if (del) del.onclick = async () => { const ti = { ...(state.settings.tempIncome || {}) }; delete ti[pid]; await saveSettings({ tempIncome: ti }); recompute(); closeSheet(); rerender(); };
    },
  });
}

function otherSheet(index, preset, rerender) {
  const list = state.settings.otherIncome || [];
  const x = index != null ? list[index] : preset ? { ...preset } : { label: '', amount: null, freq: 'month' };
  openSheet(`<h2>${index != null ? 'Edit' : 'Add'} household income</h2>
    ${x.note ? `<p class="sub">${esc(x.note)}</p>` : ''}
    <label class="field"><span>What</span><input id="io-label" value="${esc(x.label)}" placeholder="e.g. Child Benefit"></label>
    <div class="plan-grid"><label class="field"><span>£</span><input id="io-amt" inputmode="decimal" value="${x.amount ? (x.amount / 100).toFixed(2) : ''}"></label>
      <label class="field select"><select id="io-freq">${Object.entries(FREQ).map(([k, v]) => `<option value="${k}" ${x.freq === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label></div>
    <div class="plan-grid"><label class="field"><span>From</span><input id="io-from" type="month" value="${esc(x.from || '')}"></label><label class="field"><span>Until</span><input id="io-until" type="month" value="${esc(x.until || '')}"></label></div>
    ${state.settings.people.length > 1 ? `<label class="field select"><span>Paid to</span><select id="io-owner"><option value="">Household</option>${state.settings.people.map((pp) => `<option value="${pp.id}" ${x.owner === pp.id ? 'selected' : ''}>${esc(pp.name)}</option>`).join('')}</select></label>` : ''}
    <div class="row gap">${index != null ? '<button class="btn danger grow" id="io-del">Remove</button>' : ''}<button class="btn primary grow" id="io-save">Save</button></div>`, {
    onMount(p) {
      const $ = (id) => p.querySelector(id);
      $('#io-save').onclick = async () => {
        const amount = parsePrice($('#io-amt').value);
        if (!amount || !$('#io-label').value.trim()) return toast('Enter what it is and the amount', { error: true });
        const entry = { label: $('#io-label').value.trim(), amount, freq: $('#io-freq').value, from: $('#io-from').value || null, until: $('#io-until').value || null, owner: $('#io-owner')?.value || null };
        const next = [...list]; if (index != null) next[index] = entry; else next.push(entry);
        await saveSettings({ otherIncome: next }); recompute(); closeSheet(); rerender(); toast('Saved');
      };
      const del = $('#io-del');
      if (del) del.onclick = async () => { await saveSettings({ otherIncome: list.filter((_, i) => i !== index) }); recompute(); closeSheet(); rerender(); };
    },
  });
}

export const actions = {
  'inc-use-calc': async (_, rerender) => { await saveSettings({ income: null }); toast('Using your payslips and statements'); rerender(); },
  'inc-usual': (el, rerender) => personSheet(el.dataset.id, rerender),
  'inc-temp': (el, rerender) => tempSheet(el.dataset.id, rerender),
  'inc-other': (el, rerender) => otherSheet(el.dataset.i != null ? +el.dataset.i : null, el.dataset.preset != null ? PRESETS[+el.dataset.preset] : null, rerender),
  'inc-clear-household': async (_, rerender) => { await saveSettings({ income: null }); recompute(); rerender(); toast('Using each person\'s pay'); },
};

void tempFor; void otherFor;
