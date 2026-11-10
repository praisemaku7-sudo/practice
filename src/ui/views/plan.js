// Future planning: your mortgage (amount, rate, term, fixed period) and what your months look like once it starts.
import { state, saveSettings } from '../../state.js';
import { esc, toast } from '../dom.js';
import { mipCard, biSection, biActions, biChanges } from '../plan-bi.js';
import { readinessCard } from '../afford-extras.js';
import { mortgageHero, scenarioBar } from '../move-plan.js';
import { fmt, parsePrice } from '../../lib/money.js';
import { monthKey, monthLabel, addMonths } from '../../lib/dates.js';
import { schedule, projection, byYear, monthlyPayment, propertyTax, borrowingRange, ltvBands, savingTimeline } from '../../lib/mortgage.js';

const DEFAULTS = { startMonth: '2027-01', principal: null, price: null, deposit: null, rate: 4.5, termYears: 25, fixedYears: 5, followRate: 7.5, interestOnly: false, overpay: 0, extraCosts: 0, rent: null, region: 'england', firstTime: true, buyCosts: null, saved: null, savingMonthly: null, grossIncome: null };
const SUGGESTED_COSTS = 350000; // solicitor ~£1,500, survey ~£500, lender fee ~£1,000, moving ~£500

function current() { return { ...DEFAULTS, ...(state.settings.mortgage || {}) }; }

/** Today's rent: what the budget sees going to Rent & Mortgage each month. */
function detectedRent() {
  const line = state.derived.budget.lines.find((l) => l.category === 'housing');
  return line?.hist || 0;
}

/** Gross yearly pay from payslips: the highest recent gross per person (maternity months pay less). */
function grossFromPayslips() {
  let total = 0, people = 0;
  for (const list of Object.values(state.settings.payslipHistory || {})) {
    const best = list.filter((x) => x.gross > 0).sort((a, b) => b.gross - a.gross)[0];
    if (!best) continue;
    const f = String(best.frequency || 'month');
    const per = /4.?week/.test(f) ? 13 : /2.?week|fortnight/.test(f) ? 26 : /week/.test(f) ? 52 : 12;
    total += best.gross * per; people++;
  }
  return people ? total : null;
}

/** Buying: cash needed, deposit bands, borrowing limit, rate and term what-ifs, remortgage date. */
function buyingCards(m, principal, rent) {
  const out = [];
  const from = monthKey(state.derived.today);
  if (m.price > 0) {
    const deposit = m.deposit ?? (principal ? m.price - principal : 0);
    const tax = propertyTax(m.price, { region: m.region, firstTime: m.firstTime });
    const costs = m.buyCosts ?? SUGGESTED_COSTS;
    const need = deposit + tax.tax + costs;
    const tl = savingTimeline({ need, saved: m.saved || 0, monthly: m.savingMonthly || 0, fromMonth: from });
    const monthsToStart = Math.max(1, (+m.startMonth.slice(0, 4) - +from.slice(0, 4)) * 12 + (+m.startMonth.slice(5) - +from.slice(5)));
    const perMonthNeeded = tl.gap ? Math.ceil(tl.gap / monthsToStart / 100) * 100 : 0;
    const late = tl.month && tl.month > m.startMonth;
    out.push(`<div class="card ${late || (tl.gap && !tl.months) ? 'nospend-bad' : ''}"><h3>Cash you need to buy</h3>
      <div class="plan-table">
        <div class="pt-row two"><span>Deposit</span><b>${fmt(deposit, { whole: true })}</b></div>
        <div class="pt-row two"><span>${esc(tax.name)}${tax.relief ? ' <small class="pill ok">first-time buyer relief</small>' : ''}</span><b>${fmt(tax.tax, { whole: true })}</b></div>
        <div class="pt-row two"><span>Solicitor, survey, fees, moving${m.buyCosts == null ? ' <small class="muted">(estimate)</small>' : ''}</span><b>${fmt(costs, { whole: true })}</b></div>
        <div class="pt-row two total"><span>Total</span><b>${fmt(need, { whole: true })}</b></div>
        ${m.saved ? `<div class="pt-row two"><span>Saved so far</span><b class="pos">−${fmt(m.saved, { whole: true })}</b></div><div class="pt-row two total"><span>Still to save</span><b>${fmt(tl.gap, { whole: true })}</b></div>` : ''}
      </div>
      ${tl.gap === 0 ? '<p class="sub pos">✓ You have enough saved to buy.</p>'
        : tl.months ? `<p class="sub">At ${fmt(m.savingMonthly, { whole: true })}/month you'll have it in <b>${tl.months} month${tl.months > 1 ? 's' : ''}</b> (${esc(monthLabel(tl.month))})${late ? `: <span class="neg">after your planned start in ${esc(monthLabel(m.startMonth))}</span>. To be ready in time, save <b>${fmt(perMonthNeeded, { whole: true })}/month</b>, or push the start back.` : ', in time for your planned start.'}</p>`
        : `<p class="sub">Enter what you've saved and can save each month below to see when you'll be ready. To buy in ${esc(monthLabel(m.startMonth))} you'd need about <b>${fmt(perMonthNeeded, { whole: true })}/month</b>.</p>`}
      ${m.firstTime ? '<p class="sub">A Lifetime ISA adds a 25% government bonus on up to £4,000 a year towards a first home up to £450,000 (open it at 18–39, at least 12 months before you buy).</p>' : ''}
      <div class="act-links"><a class="act-link" href="${m.region === 'scotland' ? 'https://revenue.scot/calculate-tax/calculate-property-transactions' : m.region === 'wales' ? 'https://www.gov.wales/land-transaction-tax-calculator' : 'https://www.tax.service.gov.uk/calculate-stamp-duty-land-tax/'}" target="_blank" rel="noopener">Official ${esc(tax.name)} calculator ↗</a><a class="act-link" href="https://www.gov.uk/lifetime-isa" target="_blank" rel="noopener">Lifetime ISA on GOV.UK ↗</a></div>
    </div>`);
    const bands = ltvBands(m.price, deposit + Math.max(0, (m.saved || 0) - tax.tax - costs - deposit));
    const curLtv = principal ? Math.round((principal / m.price) * 100) : null;
    out.push(`<div class="card"><h3>Deposit bands</h3>
      <p class="sub">Mortgage rates usually drop at each step. You're borrowing ${curLtv != null ? `<b>${curLtv}%</b> of the price` : 'a share of the price'}.</p>
      <div class="plan-table"><div class="pt-row head three"><span>Borrow</span><span>Deposit</span><span></span></div>
      ${bands.map((b) => `<div class="pt-row three ${curLtv != null && curLtv <= b.ltv && (curLtv > b.ltv - 5 || b.ltv === 60) ? 'start' : ''}"><span>${b.ltv}%</span><span>${fmt(b.deposit, { whole: true })}</span><span class="${b.reached ? 'pos' : 'muted'}">${b.reached ? '✓ reached' : `${fmt(b.short, { whole: true })} more`}</span></div>`).join('')}</div>
    </div>`);
  }
  if (principal > 0) {
    const gross = m.grossIncome ?? grossFromPayslips();
    if (gross) {
      const r = borrowingRange(gross);
      const ok = principal <= r.high;
      out.push(`<div class="card ${ok ? '' : 'nospend-bad'}"><h3>Can you borrow it?</h3>
        <div class="stat-grid"><div><span class="label">Gross household pay</span><b>${fmt(gross, { whole: true })}/yr</b></div><div><span class="label">Lenders usually lend</span><b>${fmt(r.low, { whole: true })}–${fmt(r.high, { whole: true })}</b></div></div>
        <p class="sub ${ok ? '' : 'neg'}">${ok ? `${fmt(principal, { whole: true })} is within the usual 4–4.5× income.` : `${fmt(principal, { whole: true })} is more than 4.5× income: you'd need a bigger deposit, a cheaper home or a specialist lender.`} Lenders also check your spending, debts and credit file: clearing card balances and not missing payments helps.${m.grossIncome == null ? ' Gross pay is estimated from your payslips (highest recent month); enter it below if that\'s wrong.' : ''} On maternity leave, lenders usually use your return-to-work salary with a letter from your employer.</p>
        <a class="act-link" href="https://www.moneyhelper.org.uk/en/homes/buying-a-home/mortgage-affordability-calculator" target="_blank" rel="noopener">MoneyHelper affordability calculator ↗</a>
      </div>`);
    }
    const n = Math.round(m.termYears * 12);
    const rates = [m.rate - 1, m.rate, m.rate + 1, m.rate + 2].filter((x) => x > 0);
    const terms = [...new Set([25, 30, 35, m.termYears])].filter((t) => t > 0 && t <= 40).sort((a, b) => a - b);
    out.push(`<div class="card"><h3>What if…</h3>
      <p class="sub">If rates change when you fix (same amount and term):</p>
      <div class="plan-table"><div class="pt-row head three"><span>Rate</span><span>Payment</span><span>vs rent</span></div>
      ${rates.map((x) => { const p = monthlyPayment(principal, x, n, { interestOnly: m.interestOnly }) + (m.overpay || 0) + (m.extraCosts || 0); return `<div class="pt-row three ${x === m.rate ? 'start' : ''}"><span>${x.toFixed(2).replace(/\.?0+$/, '')}%</span><span>${fmt(p, { whole: true })}</span><span class="${rent && p > rent ? 'neg' : 'pos'}">${rent ? fmt(p - rent, { whole: true, sign: true }) : '–'}</span></div>`; }).join('')}</div>
      <p class="sub">Longer terms lower the payment but cost more interest${m.fixedYears && m.followRate != null ? ` (totals assume ${m.followRate}% after the fix: remortgaging keeps it lower)` : ""}:</p>
      <div class="plan-table"><div class="pt-row head three"><span>Term</span><span>Payment</span><span>Total interest</span></div>
      ${terms.map((t) => { const sc = schedule({ principal, rate: m.rate, termYears: t, fixedYears: m.fixedYears, followRate: m.followRate, interestOnly: m.interestOnly }); return `<div class="pt-row three ${t === m.termYears ? 'start' : ''}"><span>${t} years</span><span>${fmt(sc.payment, { whole: true })}</span><span>${fmt(sc.totalInterest, { whole: true })}</span></div>`; }).join('')}</div>
    </div>`);
  }
  return out.join('');
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
    <!--buying-->
    ${s.afterFix ? `<div class="card"><h3>When the ${m.fixedYears}-year fix ends (${esc(monthLabel(addMonths(m.startMonth, Math.round(m.fixedYears * 12))))})</h3>
      <div class="stat-grid"><div><span class="label">Still owed</span><b>${fmt(s.afterFix.balance, { whole: true })}</b></div><div><span class="label">At ${m.followRate}% the payment becomes</span><b>${fmt(s.afterFix.payment || 0, { whole: true })}</b></div></div>
      <p class="sub">Start comparing deals from <b>${esc(monthLabel(addMonths(m.startMonth, Math.round(m.fixedYears * 12) - 6)))}</b>: most lenders let you lock a new rate up to 6 months before the fix ends, so you never drop onto the variable rate.</p></div>` : ''}
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

  const buying = buyingCards(m, principal, rent);
  if (!(principal > 0 && m.rate > 0) && buying) results = buying;
  else results = results.replace('<!--buying-->', buying);
  return `<h1 class="page-title">Future planning</h1>
  ${mortgageHero()}
  ${scenarioBar()}
  ${mipCard()}
  ${readinessCard()}
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
  <div class="card">
    <h3>Buying and your deposit</h3>
    <div class="plan-grid"><label class="field select slim"><span>Where</span><select id="pl-region"><option value="england" ${m.region === 'england' ? 'selected' : ''}>England / NI</option><option value="scotland" ${m.region === 'scotland' ? 'selected' : ''}>Scotland</option><option value="wales" ${m.region === 'wales' ? 'selected' : ''}>Wales</option></select></label>
      <label class="field select slim"><span>First home?</span><select id="pl-first"><option value="1" ${m.firstTime ? 'selected' : ''}>First-time buyers</option><option value="0" ${m.firstTime ? '' : 'selected'}>Not first home</option></select></label></div>
    <div class="plan-grid">${field('pl-saved', 'Saved so far £', pounds(m.saved), 'placeholder="0"')}${field('pl-saving', 'Can save £/month', pounds(m.savingMonthly), 'placeholder="e.g. 300"')}</div>
    <div class="plan-grid">${field('pl-costs', 'Buying costs £', pounds(m.buyCosts), `placeholder="about ${fmt(SUGGESTED_COSTS, { whole: true })}"`)}${field('pl-gross', 'Gross pay £/year', pounds(m.grossIncome), `placeholder="${grossFromPayslips() ? 'payslips: ' + fmt(grossFromPayslips(), { whole: true }) : 'both of you'}"`)}</div>
    <p class="sub">Add the property price above to see the cash you need, ${'stamp duty'} and when you'll be ready.</p>
    <button class="btn primary full" data-action="pl-save">Work it out</button>
  </div>
  ${results}
  ${principal > 0 && m.rate > 0 ? biSection(m, principal, rent, b) : ''}`;
}

export const changes = { ...biChanges };

export const actions = {
  ...biActions,
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
      region: v('pl-region') || 'england', firstTime: v('pl-first') !== '0',
      saved: money('pl-saved'), savingMonthly: money('pl-saving'), buyCosts: money('pl-costs'), grossIncome: money('pl-gross'),
    };
    if (mortgage.termYears <= 0 || mortgage.termYears > 40) return toast('Term should be between 1 and 40 years', { error: true });
    if (mortgage.rate < 0 || mortgage.rate > 20) return toast('Check the interest rate', { error: true });
    await saveSettings({ mortgage });
    rerender(); toast('Plan updated');
  },
};
