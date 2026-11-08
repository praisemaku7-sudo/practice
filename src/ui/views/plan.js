// Future planning: your mortgage (amount, rate, term, fixed period) and what your months look like once it starts.
import { state, saveSettings } from '../../state.js';
import { esc, toast } from '../dom.js';
import { fmt, parsePrice } from '../../lib/money.js';
import { monthKey, monthLabel, addMonths } from '../../lib/dates.js';
import { schedule, projection, byYear } from '../../lib/mortgage.js';

const DEFAULTS = { startMonth: '2027-01', principal: null, price: null, deposit: null, rate: 4.5, termYears: 25, fixedYears: 5, followRate: 7.5, interestOnly: false, overpay: 0, extraCosts: 0, rent: null };

function current() { return { ...DEFAULTS, ...(state.settings.mortgage || {}) }; }

/** Today's rent: what the budget sees going to Rent & Mortgage each month. */
function detectedRent() {
  const line = state.derived.budget.lines.find((l) => l.category === 'housing');
  return line?.hist || 0;
}

export function render() {
  const m = current();
  const b = state.derived.budget;
  const rent = m.rent ?? detectedRent();
  const principal = m.principal ?? (m.price && m.deposit != null ? m.price - m.deposit : null);
  const everyday = Math.max(0, (b.avgSpend || 0) - detectedRent());
  const savings = b.goalsMonthly || 0;
  const pounds = (v) => (v == null ? '' : (v / 100).toFixed(0));
  const field = (id, label, value, extra = '') => `<label class="field slim"><span>${label}</span><input id="${id}" inputmode="decimal" value="${esc(value ?? '')}" ${extra}></label>`;

  let results = '<div class="card"><p class="muted">Enter the mortgage amount (or the price and your deposit) and the rate to see your monthly payment and how your months will look.</p></div>';
  if (principal > 0 && m.rate > 0) {
    const mort = { principal, rate: m.rate, termYears: m.termYears, fixedYears: m.fixedYears, followRate: m.followRate, interestOnly: m.interestOnly, overpay: m.overpay, startMonth: m.startMonth, extraCosts: m.extraCosts };
    const s = schedule(mort);
    const base = m.overpay ? schedule({ ...mort, overpay: 0 }) : null;
    const pay = s.payment + (m.overpay || 0);
    const newHousing = pay + (m.extraCosts || 0);
    const diff = newHousing - rent;
    const from = monthKey(state.derived.today);
    const proj = projection({ fromMonth: from, months: 18, income: b.income, everydaySpend: everyday, rent, savings, mortgage: mort });
    const after = proj.find((r) => r.mortgage);
    const ltv = m.price ? Math.round((principal / m.price) * 100) : null;
    const years = byYear(s.rows);
    results = `
    <div class="card hero">
      <div class="label">Mortgage from ${esc(monthLabel(m.startMonth))}</div>
      <div class="big">${fmt(pay)}<small>/month</small></div>
      <div class="sub">${m.interestOnly ? 'Interest only' : 'Repayment'} · ${fmt(principal, { whole: true })} at ${m.rate}% over ${m.termYears} years${ltv ? ` · ${ltv}% loan-to-value` : ''}</div>
      <div class="sub">${rent ? `${diff > 0 ? `<span class="neg">${fmt(diff, { whole: true })} more</span>` : `<span class="pos">${fmt(-diff, { whole: true })} less</span>`} a month than your rent (${fmt(rent, { whole: true })})${m.extraCosts ? `, including ${fmt(m.extraCosts, { whole: true })} other costs` : ''}` : 'No rent found to compare with: enter it below.'}</div>
    </div>
    <div class="card ${after && after.left < 0 ? 'nospend-bad' : ''}">
      <h3>Can we afford it?</h3>
      ${after ? `<div class="stat-grid"><div><span class="label">Income</span><b>${fmt(b.income, { whole: true })}</b></div><div><span class="label">Everyday spending</span><b>${fmt(everyday, { whole: true })}</b></div>
        <div><span class="label">Mortgage &amp; costs</span><b>${fmt(after.housing, { whole: true })}</b></div><div><span class="label">Left each month</span><b class="${after.left < 0 ? 'neg' : 'pos'}">${fmt(after.left, { whole: true })}</b></div></div>
        <p class="sub">${after.left < 0 ? `Short by ${fmt(-after.left, { whole: true })} a month on today's spending. Cut spending, lengthen the term or borrow less.` : after.left < b.income * 0.1 ? 'Tight: under 10% of income left over. Keep an emergency fund.' : 'Comfortable on today\'s income and spending.'} Based on ${b.incomeIsEstimate ? 'estimated' : 'your'} household income and your average spending (rent excluded)${savings ? `, after ${fmt(savings, { whole: true })} for savings goals` : ''}.</p>` : '<p class="sub">The mortgage starts after the next 18 months.</p>'}
    </div>
    ${s.afterFix ? `<div class="card"><h3>When the ${m.fixedYears}-year fix ends (${esc(monthLabel(addMonths(m.startMonth, Math.round(m.fixedYears * 12))))})</h3>
      <div class="stat-grid"><div><span class="label">Still owed</span><b>${fmt(s.afterFix.balance, { whole: true })}</b></div><div><span class="label">At ${m.followRate}% the payment becomes</span><b>${fmt(s.afterFix.payment || 0, { whole: true })}</b></div></div>
      <p class="sub">Remortgage before the fix ends to avoid the lender's variable rate.</p></div>` : ''}
    <div class="card"><h3>Total cost</h3>
      <div class="stat-grid"><div><span class="label">Interest over the term</span><b>${fmt(s.totalInterest, { whole: true })}</b></div><div><span class="label">Paid off</span><b>${esc(monthLabel(s.rows.at(-1).month))}</b></div></div>
      ${base ? `<p class="sub pos">Overpaying ${fmt(m.overpay, { whole: true })}/month saves ${fmt(base.totalInterest - s.totalInterest, { whole: true })} interest and clears it ${Math.floor((base.months - s.months) / 12)} years ${(base.months - s.months) % 12} months sooner.</p>` : '<p class="sub">Try an overpayment below to see what it saves (most lenders allow 10% a year).</p>'}
    </div>
    <div class="card"><h3>Month by month</h3>
      <div class="plan-table"><div class="pt-row head"><span>Month</span><span>Housing</span><span>Left over</span><span>Running total</span></div>
      ${proj.map((r) => `<div class="pt-row ${r.month === m.startMonth ? 'start' : ''}"><span>${esc(monthLabel(r.month, { short: true }))}${r.month === m.startMonth ? ' 🏠' : ''}</span><span>${fmt(r.housing, { whole: true })}</span><span class="${r.left < 0 ? 'neg' : ''}">${fmt(r.left, { whole: true })}</span><span class="${r.cumulative < 0 ? 'neg' : ''}">${fmt(r.cumulative, { whole: true })}</span></div>`).join('')}</div>
      <p class="sub">Income and everyday spending held at today's averages. Rent until the mortgage starts.</p></div>
    <div class="card"><h3>Year by year</h3>
      <div class="plan-table"><div class="pt-row head"><span>Year</span><span>Interest</span><span>Paid</span><span>Still owed</span></div>
      ${years.slice(0, 10).map((y) => `<div class="pt-row"><span>${y.year} <small class="muted">${esc(y.end.slice(0, 4))}</small></span><span>${fmt(y.interest, { whole: true })}</span><span>${fmt(y.paid, { whole: true })}</span><span>${fmt(y.balance, { whole: true })}</span></div>`).join('')}</div></div>`;
  }

  return `<h1 class="page-title">Future planning</h1>
  <div class="card">
    <h3>Your mortgage</h3>
    <div class="plan-grid"><label class="field slim"><span>Starts</span><input id="pl-start" type="month" value="${esc(m.startMonth)}"></label>
      <label class="field select slim"><span>Type</span><select id="pl-type"><option value="rep" ${m.interestOnly ? '' : 'selected'}>Repayment</option><option value="io" ${m.interestOnly ? 'selected' : ''}>Interest only</option></select></label></div>
    <div class="plan-grid">${field('pl-price', 'Property price £', pounds(m.price), 'placeholder="optional"')}${field('pl-deposit', 'Deposit £', pounds(m.deposit), 'placeholder="optional"')}</div>
    ${field('pl-principal', 'Mortgage amount £', pounds(m.principal ?? (m.price && m.deposit != null ? m.price - m.deposit : null)), 'placeholder="or price minus deposit"')}
    <div class="plan-grid">${field('pl-rate', 'Interest rate %', m.rate)}${field('pl-term', 'Term (years)', m.termYears)}</div>
    <div class="plan-grid">${field('pl-fixed', 'Fixed for (years)', m.fixedYears)}${field('pl-follow', 'Rate after the fix %', m.followRate)}</div>
    <div class="plan-grid">${field('pl-over', 'Overpay £/month', pounds(m.overpay) || '0')}${field('pl-extra', 'Other new costs £/month', pounds(m.extraCosts) || '0', 'placeholder="insurance, service charge"')}</div>
    ${field('pl-rent', 'Rent today £/month', pounds(m.rent ?? detectedRent()), `placeholder="${detectedRent() ? 'found ' + fmt(detectedRent(), { whole: true }) : 'e.g. 1200'}"`)}
    <p class="sub">${m.rent == null && detectedRent() ? `Rent found in your statements: ${fmt(detectedRent(), { whole: true })}/month.` : ''} Your deposit pot isn't counted in your spending; enter it here instead.</p>
    <button class="btn primary full" data-action="pl-save">Work it out</button>
  </div>
  ${results}`;
}

export const actions = {
  'pl-save': async (_, rerender) => {
    const v = (id) => document.getElementById(id).value.trim();
    const money = (id) => (v(id) === '' ? null : parsePrice(v(id)));
    const num = (id, d) => (v(id) === '' || Number.isNaN(parseFloat(v(id))) ? d : parseFloat(v(id)));
    const price = money('pl-price'), deposit = money('pl-deposit');
    let principal = money('pl-principal');
    // If the price or deposit changed, the amount follows them.
    const old = current();
    if (price && deposit != null && (price !== old.price || deposit !== old.deposit)) principal = price - deposit;
    const mortgage = {
      startMonth: v('pl-start') || DEFAULTS.startMonth, interestOnly: v('pl-type') === 'io',
      price, deposit, principal,
      rate: num('pl-rate', DEFAULTS.rate), termYears: num('pl-term', 25), fixedYears: num('pl-fixed', 0), followRate: num('pl-follow', null),
      overpay: money('pl-over') || 0, extraCosts: money('pl-extra') || 0, rent: money('pl-rent'),
    };
    if (mortgage.termYears <= 0 || mortgage.termYears > 40) return toast('Term should be between 1 and 40 years', { error: true });
    if (mortgage.rate < 0 || mortgage.rate > 20) return toast('Check the interest rate', { error: true });
    await saveSettings({ mortgage });
    rerender(); toast('Plan updated');
  },
};
