// Future planning extras: read a mortgage in principle from a file, and interactive charts
// (balance and equity, where each payment goes, overpayments, rates, rent vs buy, affordability).
import { state, saveSettings } from '../state.js';
import { esc, toast, openSheet, closeSheet } from './dom.js';
import { fmt } from '../lib/money.js';
import { daysBetween, prettyDate, monthLabel } from '../lib/dates.js';
import { schedule, byYear, monthlyPayment, propertyTax } from '../lib/mortgage.js';
import { isMIP, parseMIP } from '../lib/mip.js';

const ui = { over: null };
const charts = {};
const k = (p) => (Math.abs(p) >= 100000000 ? `£${(p / 100000000).toFixed(1)}m` : Math.abs(p) >= 100000 ? `£${Math.round(p / 100000)}k` : `£${Math.round(p / 100)}`);

// ---------- Mortgage in principle ----------
export function mipCard() {
  const mip = state.settings.mip;
  const input = '<input type="file" id="mip-file" accept="application/pdf,image/*" data-change="mip-file" hidden>';
  if (!mip) {
    return `<div class="card mip-card"><div class="mip-row"><span class="mip-ic">📄</span><div class="grow"><b>Got a mortgage in principle?</b><div class="sub">Upload the PDF (or a photo) and the lender, amount, term, rate and expiry fill in for you.</div></div></div>
      <label for="mip-file" class="btn primary full">Upload mortgage in principle</label>${input}
      <p class="sub">PDFs are read on your phone. Photos and scans need your Claude key in Settings. Only the figures are kept, never the file.</p></div>`;
  }
  const today = state.derived.today;
  const left = mip.expires ? daysBetween(today, mip.expires) : null;
  const total = mip.issued && mip.expires ? Math.max(1, daysBetween(mip.issued, mip.expires)) : 90;
  const plan = current().principal ?? null;
  return `<div class="card mip-card"><div class="mip-row"><span class="mip-ic">🏦</span><div class="grow"><b>${esc(mip.lender || 'Mortgage in principle')}</b><div class="sub">Up to <b>${mip.amount ? fmt(mip.amount, { whole: true }) : '?'}</b>${mip.termYears ? ` · ${mip.termYears} years` : ''}${mip.ltv ? ` · ${mip.ltv}% LTV` : ''}${mip.applicants > 1 ? ' · joint' : ''}</div></div>
    <label for="mip-file" class="chip">Replace</label>${input}</div>
    ${left != null ? `<div class="mip-exp ${left < 0 ? 'neg' : left <= 14 ? 'warn-text' : ''}">${left < 0 ? `Expired ${prettyDate(mip.expires)}: ask the lender to re-run it before you make an offer.` : `Valid for <b>${left} more day${left === 1 ? '' : 's'}</b> (until ${prettyDate(mip.expires)} ${mip.expires.slice(0, 4)})`}</div>
      <div class="cat-bar ${left <= 14 ? 'warn' : ''}"><span style="width:${Math.max(0, Math.min(100, (left / total) * 100)).toFixed(1)}%"></span></div>` : ''}
    ${mip.amount && plan ? `<div class="sub">Your plan borrows ${fmt(plan, { whole: true })}: ${plan === mip.amount ? '<span class="warn-text">exactly the most they\'d lend</span>' : plan < mip.amount ? `<span class="pos">${fmt(mip.amount - plan, { whole: true })} under the limit</span>` : `<span class="neg">${fmt(plan - mip.amount, { whole: true })} over what they'd lend</span>`}.</div>` : ''}
    <p class="sub">A mortgage in principle isn't a guaranteed offer: the full application checks your credit file, income and the property. Avoid new credit and missed payments until you complete.</p></div>`;
}

const current = () => ({ ...(state.settings.mortgage || {}) });

async function readFile(file) {
  const key = state.settings.apiKey;
  const isPdf = /pdf/i.test(file.type) || /\.pdf$/i.test(file.name);
  let text = '', found = null, how = 'on your phone';
  if (isPdf) {
    const { extractPdfLines, renderPageImages } = await import('../lib/parse/pdf.js');
    const buf = await file.arrayBuffer();
    const res = await extractPdfLines(buf);
    text = res.lines.map((l) => l.items.map((i) => i.str).join(' ')).join('\n');
    if (res.hasText) found = parseMIP(text);
    if ((!found || !found.amount) && key) {
      const { aiReadMIP } = await import('../lib/ai.js');
      found = await aiReadMIP({ apiKey: key, model: state.settings.model, text: res.hasText ? text : null, images: res.hasText ? [] : await renderPageImages(buf) });
      how = 'with Claude';
    }
  } else if (key) {
    const data = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = bad; r.readAsDataURL(file); });
    const { aiReadMIP } = await import('../lib/ai.js');
    found = await aiReadMIP({ apiKey: key, model: state.settings.model, images: [data], mediaType: file.type || 'image/jpeg' });
    how = 'with Claude';
  } else {
    throw new Error('Photos need your Claude key (Settings). Or upload the PDF the lender emailed you.');
  }
  return { found, how, looksRight: isMIP(text, file.name) || !!found?.amount };
}

function reviewSheet(f, how) {
  const row = (label, v) => (v == null || v === '' ? '' : `<div class="pt-row two"><span>${label}</span><b>${v}</b></div>`);
  openSheet(`<h2>Found in your document</h2>
    <p class="muted">Read ${esc(how)}. Check these, then use them for your plan. You can change any figure afterwards.</p>
    <div class="plan-table">
      ${row('Lender', esc(f.lender || ''))}${row('Could borrow', f.amount ? fmt(f.amount, { whole: true }) : null)}${row('Property price', f.price ? fmt(f.price, { whole: true }) : null)}
      ${row('Deposit', f.deposit ? fmt(f.deposit, { whole: true }) : null)}${row('Term', f.termYears ? `${f.termYears} years` : null)}${row('Rate', f.rate ? `${f.rate}%` : null)}
      ${row('Fixed for', f.fixedYears ? `${f.fixedYears} years` : null)}${row('Loan to value', f.ltv ? `${f.ltv}%` : null)}${row('Type', f.interestOnly ? 'Interest only' : 'Repayment')}
      ${row('Applicants', f.applicants)}${row('Issued', f.issued ? prettyDate(f.issued) + ' ' + f.issued.slice(0, 4) : null)}${row('Expires', f.expires ? prettyDate(f.expires) + ' ' + f.expires.slice(0, 4) : null)}
    </div>
    ${!f.rate ? '<p class="sub">No rate in the document (most don\'t include one): the plan keeps your current rate. Ask a broker or check the lender\'s current deals.</p>' : ''}
    <button class="btn primary full" data-action="mip-use">Use these for my plan</button>
    <button class="btn ghost full" data-action="close-sheet">Cancel</button>`, { wide: true });
  pending = f;
}
let pending = null;

// ---------- Charts ----------
const W = 320, H = 150, PAD = 6;
function lineChart(id, { labels, series, detail, sel = null, zero = false }) {
  charts[id] = { detail };
  const all = series.flatMap((x) => x.values);
  const lo = Math.min(zero ? 0 : Infinity, ...all), hi = Math.max(...all), span = hi - lo || 1;
  const n = labels.length;
  const x = (i) => PAD + (i / Math.max(1, n - 1)) * (W - PAD * 2);
  const y = (v) => H - 22 - ((v - lo) / span) * (H - 34);
  const step = (W - PAD * 2) / Math.max(1, n - 1);
  const every = Math.ceil(n / 7);
  return `<svg class="bi-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Chart: tap for values">
    ${lo < 0 && hi > 0 ? `<line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" class="bi-zero"/>` : ''}
    ${series.map((sr) => `${sr.area ? `<path d="M${x(0)},${y(lo)} ${sr.values.map((v, i) => `L${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} L${x(n - 1)},${y(lo)} Z" class="bi-area ${sr.cls}"/>` : ''}<path d="${sr.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}" class="bi-line ${sr.cls}"/>`).join('')}
    ${labels.map((l, i) => (i % every === 0 || i === n - 1 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}" class="bi-label">${esc(l)}</text>` : '')).join('')}
    ${labels.map((_, i) => `<rect x="${(x(i) - step / 2).toFixed(1)}" y="0" width="${step.toFixed(1)}" height="${H - 18}" class="bi-hit ${i === sel ? 'sel' : ''}" data-action="pl-pt" data-c="${id}" data-i="${i}"/>`).join('')}
  </svg><div class="bi-detail" id="bi-d-${id}">${detail(sel ?? n - 1)}</div>`;
}
function barChart(id, { labels, stacks, detail }) {
  charts[id] = { detail };
  const n = labels.length;
  const tot = labels.map((_, i) => stacks.reduce((a, s) => a + s.values[i], 0));
  const hi = Math.max(1, ...tot);
  const step = (W - PAD * 2) / n, bw = Math.max(3, step * 0.7);
  const every = Math.ceil(n / 7);
  return `<svg class="bi-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Chart: tap a bar">
    ${labels.map((l, i) => { let acc = 0; return `<g>${stacks.map((s) => { const h = (s.values[i] / hi) * (H - 34); const yy = H - 22 - acc - h; acc += h; return `<rect x="${(PAD + i * step + (step - bw) / 2).toFixed(1)}" y="${yy.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" class="bi-bar ${s.cls}"/>`; }).join('')}
      ${i % every === 0 || i === n - 1 ? `<text x="${(PAD + i * step + step / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="bi-label">${esc(l)}</text>` : ''}
      <rect x="${(PAD + i * step).toFixed(1)}" y="0" width="${step.toFixed(1)}" height="${H - 18}" class="bi-hit" data-action="pl-pt" data-c="${id}" data-i="${i}"/></g>`; }).join('')}
  </svg><div class="bi-detail" id="bi-d-${id}">${detail(0)}</div>`;
}
const legend = (items) => `<div class="bi-legend">${items.map(([cls, l]) => `<span><i class="bi-key ${cls}"></i>${esc(l)}</span>`).join('')}</div>`;

export function biSection(m, principal, rent, b) {
  const mort = { principal, rate: m.rate, termYears: m.termYears, fixedYears: m.fixedYears, followRate: m.followRate, interestOnly: m.interestOnly, overpay: m.overpay || 0, startMonth: m.startMonth };
  const s = schedule(mort);
  const years = byYear(s.rows);
  const price = m.price || Math.round(principal / 0.9);
  const g = (m.growth ?? 2.5) / 100;
  const startYear = +m.startMonth.slice(0, 4);
  const pay = s.payment + (m.overpay || 0);
  const housing = pay + (m.extraCosts || 0);
  const totalPaid = s.rows.reduce((a, r) => a + r.payment, 0);
  const takeHome = b.income || 0;
  const pctHome = takeHome ? housing / takeHome : null;
  const at = (yr) => years[Math.min(yr, years.length) - 1];
  const eq5 = at(5) ? Math.round(price * Math.pow(1 + g, 5)) - at(5).balance : null;
  const fixEnd = m.fixedYears ? s.rows[Math.round(m.fixedYears * 12) - 1] : null;

  // KPI tiles.
  const kpis = [
    ['Monthly payment', fmt(pay, { whole: true }), m.extraCosts ? `${fmt(housing, { whole: true })} with costs` : ''],
    ['Total interest', fmt(s.totalInterest, { whole: true }), `${(s.totalInterest / principal).toFixed(2)} per £1 borrowed`],
    ['Total repaid', fmt(totalPaid, { whole: true }), `over ${Math.floor(s.months / 12)} yrs ${s.months % 12 ? `${s.months % 12} mo` : ''}`],
    ['Mortgage-free', `${monthLabel(s.rows.at(-1).month, { short: true }).split(' ')[0]} ${s.rows.at(-1).month.slice(0, 4)}`, `${startYear + Math.ceil(s.months / 12) - new Date().getFullYear()} years from now`],
    ['Equity after 5 yrs', eq5 != null ? fmt(eq5, { whole: true }) : '–', `at ${(g * 100).toFixed(1)}% house prices`],
    ['Share of take-home', pctHome != null ? `${Math.round(pctHome * 100)}%` : '–', pctHome == null ? 'set income' : pctHome < 0.3 ? 'comfortable' : pctHome < 0.4 ? 'stretched' : 'high'],
    ['LTV at the start', `${Math.round((principal / price) * 100)}%`, fixEnd ? `${Math.round((fixEnd.balance / (price * Math.pow(1 + g, m.fixedYears))) * 100)}% when the fix ends` : ''],
    ['Interest in year 1', fmt(years[0]?.interest || 0, { whole: true }), `${Math.round(((years[0]?.interest || 0) / (years[0]?.paid || 1)) * 100)}% of what you pay`],
  ];

  // 1. Balance vs home value (equity).
  const ys = Array.from({ length: years.length + 1 }, (_, i) => i);
  const bal = ys.map((i) => (i === 0 ? principal : years[i - 1].balance));
  const val = ys.map((i) => Math.round(price * Math.pow(1 + g, i)));
  let paidInt = 0; const intTo = ys.map((i) => (i === 0 ? 0 : (paidInt += years[i - 1].interest)));
  const c1 = lineChart('equity', {
    labels: ys.map((i) => String(startYear + i).slice(2).padStart(3, "'")), series: [{ values: val, cls: 'val', area: true }, { values: bal, cls: 'bal', area: true }], zero: true,
    detail: (i) => `<b>${startYear + i}</b> · owe ${fmt(bal[i], { whole: true })} · home worth ${fmt(val[i], { whole: true })} · <span class="pos">equity ${fmt(val[i] - bal[i], { whole: true })} (${Math.round(((val[i] - bal[i]) / val[i]) * 100)}%)</span> · interest so far ${fmt(intTo[i], { whole: true })}`,
    sel: Math.min(5, ys.length - 1),
  });

  // 2. Where each year's payments go.
  const c2 = barChart('split', {
    labels: years.map((y) => String(startYear + y.year - 1).slice(2).padStart(3, "'")),
    stacks: [{ values: years.map((y) => y.paid - y.interest), cls: 'cap' }, { values: years.map((y) => y.interest), cls: 'int' }],
    detail: (i) => `<b>${startYear + i}</b> · paid ${fmt(years[i].paid, { whole: true })}: <span class="bi-txt cap">${fmt(years[i].paid - years[i].interest, { whole: true })} off the loan</span>, <span class="bi-txt int">${fmt(years[i].interest, { whole: true })} interest</span> (${Math.round((years[i].interest / years[i].paid) * 100)}%)`,
  });

  // 3. Overpayment explorer.
  const over = ui.over ?? (m.overpay || 0);
  const base = schedule({ ...mort, overpay: 0 }), withO = schedule({ ...mort, overpay: over });
  const by0 = byYear(base.rows), by1 = byYear(withO.rows);
  const n3 = by0.length + 1;
  const b0 = Array.from({ length: n3 }, (_, i) => (i === 0 ? principal : by0[i - 1].balance));
  const b1 = Array.from({ length: n3 }, (_, i) => (i === 0 ? principal : by1[i - 1]?.balance ?? 0));
  const saved = base.totalInterest - withO.totalInterest, sooner = base.months - withO.months;
  const tenPct = Math.round((principal * 0.1) / 12 / 100) * 100;
  const c3 = lineChart('over', {
    labels: Array.from({ length: n3 }, (_, i) => String(startYear + i).slice(2).padStart(3, "'")), series: [{ values: b0, cls: 'bal' }, { values: b1, cls: 'over' }], zero: true,
    detail: (i) => `<b>${startYear + i}</b> · owe ${fmt(b0[i], { whole: true })} without, <span class="bi-txt over">${fmt(b1[i], { whole: true })} with ${fmt(over, { whole: true })}/mo extra</span>`,
  });

  // 4. Rate sensitivity.
  const rates = Array.from({ length: 15 }, (_, i) => 2 + i * 0.5);
  const nM = Math.round(m.termYears * 12);
  const pays = rates.map((r) => monthlyPayment(principal, r, nM, { interestOnly: m.interestOnly }) + (m.overpay || 0));
  const ci = rates.reduce((best, r, i) => (Math.abs(r - m.rate) < Math.abs(rates[best] - m.rate) ? i : best), 0);
  const c4 = lineChart('rate', {
    labels: rates.map((r) => `${r}%`), series: [{ values: pays, cls: 'bal' }],
    detail: (i) => `At <b>${rates[i]}%</b>: ${fmt(pays[i], { whole: true })}/month (${pays[i] >= pay ? '+' : '−'}${fmt(Math.abs(pays[i] - pay), { whole: true })} vs now)${takeHome ? ` · ${Math.round(((pays[i] + (m.extraCosts || 0)) / takeHome) * 100)}% of take-home` : ''}${rent ? ` · ${pays[i] > rent ? 'more' : 'less'} than rent by ${fmt(Math.abs(pays[i] + (m.extraCosts || 0) - rent), { whole: true })}` : ''}`,
    sel: ci,
  });

  // 5. Rent vs buy over 10 years.
  let c5 = '';
  if (rent) {
    const rg = 0.03, depositCost = (m.deposit || price - principal) * 0.04;
    const tax = propertyTax(price, { region: m.region, firstTime: m.firstTime !== false }).tax;
    const buyCosts = (m.buyCosts ?? 350000) + tax;
    const N = Math.min(10, years.length);
    const rentCum = [], ownCum = [];
    let r = 0, o = buyCosts;
    for (let i = 1; i <= N; i++) {
      r += rent * 12 * Math.pow(1 + rg, i - 1);
      o += years[i - 1].interest + (m.extraCosts || 0) * 12 + depositCost;
      rentCum.push(r);
      ownCum.push(o - (Math.round(price * Math.pow(1 + g, i)) - price)); // minus the rise in the home's value
    }
    const cross = rentCum.findIndex((x, i) => ownCum[i] < x);
    c5 = `<div class="card"><h3>Rent vs buy: money you don't get back</h3>
      ${lineChart('rvb', { labels: rentCum.map((_, i) => `Y${i + 1}`), series: [{ values: rentCum, cls: 'rent' }, { values: ownCum, cls: 'own' }], zero: true,
        detail: (i) => `<b>After ${i + 1} year${i ? 's' : ''}</b> · renting: <span class="bi-txt rent">${fmt(rentCum[i], { whole: true })}</span> · owning: <span class="bi-txt own">${fmt(ownCum[i], { whole: true })}</span> (${ownCum[i] < rentCum[i] ? `buying ahead by ${fmt(rentCum[i] - ownCum[i], { whole: true })}` : `renting ahead by ${fmt(ownCum[i] - rentCum[i], { whole: true })}`})` })}
      ${legend([['rent', 'Rent (rising 3%/yr)'], ['own', 'Owning: interest, costs, buying costs, lost savings interest, minus price growth']])}
      <p class="sub">${cross >= 0 ? `Buying comes out ahead from <b>year ${cross + 1}</b> on these assumptions.` : 'Renting stays cheaper over 10 years on these assumptions.'} Paying off the loan itself isn't a cost: it becomes your equity.</p></div>`;
  }

  // 6. Affordability gauge.
  const gauge = pctHome != null ? `<div class="card"><h3>Affordability</h3>
    <div class="gauge"><div class="g-zones"><span class="z1"></span><span class="z2"></span><span class="z3"></span></div><i style="left:${Math.min(100, pctHome * 200).toFixed(1)}%"></i></div>
    <div class="g-scale"><span>0%</span><span>30%</span><span>40%</span><span>50%+</span></div>
    <p class="sub">Mortgage and costs would be <b>${Math.round(pctHome * 100)}%</b> of your take-home (${fmt(takeHome, { whole: true })}). Under 30% is comfortable; over 40% leaves little room for everything else.</p>
    <div class="act-links"><a class="act-link" href="#/income">Check income ›</a><a class="act-link" href="#/track">On track ›</a></div></div>` : '';

  return `<div class="bi-head"><h2>Mortgage insights</h2><span class="sub">Tap any chart for the numbers</span></div>
  <div class="kpi-grid">${kpis.map(([l, v, sub]) => `<div class="kpi"><span class="label">${esc(l)}</span><b>${esc(v)}</b><small>${esc(sub)}</small></div>`).join('')}</div>
  <div class="card keep-open"><h3>What you owe vs what it's worth</h3>${c1}${legend([['val', 'Home value'], ['bal', 'Mortgage balance']])}
    <label class="field slim inline"><span>House prices rise % a year</span><input id="pl-growth" inputmode="decimal" value="${(g * 100).toFixed(1)}" data-change="pl-growth"></label></div>
  <div class="card"><h3>Where each year's payments go</h3>${c2}${legend([['cap', 'Paying off the loan'], ['int', 'Interest']])}
    <p class="sub">Early on most of each payment is interest; that's why overpaying early saves the most.</p></div>
  <div class="card"><h3>Overpayment explorer</h3>
    <div class="cal-filters">${[0, 50, 100, 200, 300, 500].map((v) => `<button class="chip ${over === v * 100 ? 'sel' : ''}" data-action="pl-over" data-v="${v * 100}">+£${v}</button>`).join('')}</div>
    <div class="stat-grid"><div><span class="label">Interest saved</span><b class="pos">${fmt(saved, { whole: true })}</b></div><div><span class="label">Mortgage-free sooner</span><b>${Math.floor(sooner / 12)}y ${sooner % 12}m</b></div></div>
    ${c3}${legend([['bal', 'Normal'], ['over', `With +${fmt(over, { whole: true })}/month`]])}
    <p class="sub">Most lenders let you overpay up to 10% a year with no fee (about ${fmt(tenPct, { whole: true })}/month here). ${over && over !== (m.overpay || 0) ? '<button class="chip" data-action="pl-over-save">Use this in my plan</button>' : ''}</p></div>
  <div class="card"><h3>If rates change</h3>${c4}<p class="sub">Monthly payment at each rate for ${fmt(principal, { whole: true })} over ${m.termYears} years. Remortgage before your fix ends to avoid the higher variable rate.</p></div>
  ${c5}${gauge}
  <div class="act-links"><a class="act-link" href="https://www.moneyhelper.org.uk/en/homes/buying-a-home/mortgage-calculator" target="_blank" rel="noopener">MoneyHelper mortgage calculator ↗</a><a class="act-link" href="https://www.moneyhelper.org.uk/en/homes/buying-a-home/first-time-buyer-guide" target="_blank" rel="noopener">First-time buyer guide ↗</a></div>`;
}

export const biActions = {
  'pl-pt': (el) => {
    const c = charts[el.dataset.c];
    if (!c) return;
    const d = document.getElementById(`bi-d-${el.dataset.c}`);
    if (d) d.innerHTML = c.detail(+el.dataset.i);
    el.parentNode.querySelectorAll('.bi-hit.sel').forEach((x) => x.classList.remove('sel'));
    el.classList.add('sel');
  },
  'pl-over': (el, rerender) => { ui.over = +el.dataset.v; rerender(); },
  'pl-over-save': async (_, rerender) => { await saveSettings({ mortgage: { ...current(), overpay: ui.over } }); ui.over = null; toast('Overpayment added to your plan'); rerender(); },
  'mip-use': async (_, rerender) => {
    const f = pending;
    if (!f) return;
    const m = current();
    const price = f.price ?? m.price ?? null;
    const deposit = f.deposit ?? (price && f.amount ? price - f.amount : m.deposit ?? null);
    const mortgage = { ...m, principal: f.amount ?? m.principal, price, deposit, termYears: f.termYears || m.termYears || 25, rate: f.rate || m.rate || 4.5, fixedYears: f.fixedYears ?? m.fixedYears ?? 5, interestOnly: !!f.interestOnly };
    await saveSettings({ mortgage, mip: { lender: f.lender, amount: f.amount, termYears: f.termYears, ltv: f.ltv, rate: f.rate, applicants: f.applicants, issued: f.issued, expires: f.expires, readAt: state.derived.today } });
    pending = null; closeSheet(); toast('Plan updated from your mortgage in principle'); rerender();
  },
};

export const biChanges = {
  'mip-file': async (el) => {
    const file = el.files?.[0];
    el.value = '';
    if (!file) return;
    toast('Reading your document…');
    try {
      const { found, how, looksRight } = await readFile(file);
      if (!found || (!found.amount && !found.lender)) return toast(state.settings.apiKey ? 'Couldn\'t find the mortgage figures in that file' : 'Couldn\'t read figures from that PDF. Add your Claude key in Settings to read scans and photos.', { error: true });
      if (!looksRight) toast('This doesn\'t look like a mortgage in principle: check the figures', { error: true });
      reviewSheet(found, how);
    } catch (e) {
      toast(e.message || String(e), { error: true });
    }
  },
  'pl-growth': async (el, rerender) => {
    const v = parseFloat(el.value);
    if (Number.isNaN(v) || v < -10 || v > 15) return toast('Enter a growth rate between −10% and 15%', { error: true });
    await saveSettings({ mortgage: { ...current(), growth: v } }); rerender();
  },
};

