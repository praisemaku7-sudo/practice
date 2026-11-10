// Mortgage illustration (ESIS / KFI): the standard document every UK lender issues, with numbered
// sections. Read on the phone from the PDF text: loan, term, price, fixed rate and end date, the rate
// after, monthly payments, fees, early repayment charges and the overpayment allowance.
// Only figures are kept: never names, addresses or reference numbers.

const MON = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
const pence = (s) => (s == null ? null : Math.round(parseFloat(String(s).replace(/,/g, '')) * 100));
const M = '£\\s?([\\d,]+(?:\\.\\d{2})?)';

export function isESIS(text, name = '') {
  return /European Standardised Information Sheet|\bESIS\b|Mortgage Illustration|Key Facts Illustration|\bKFI\b/i.test(text + ' ' + name) && /Amount of each instalment|Main features of the loan|Duration of the loan|Number of payments/i.test(text);
}

/** "01-JAN-2029", "01 - JAN - 2029", "1 January 2029", "01/01/2029" → "2029-01-01". */
function isoDate(s) {
  if (!s) return null;
  let m = s.match(/(\d{1,2})\s*[-/ ]\s*([A-Za-z]{3})[A-Za-z]*\s*[-/ ]\s*(\d{4})/);
  if (m && MON[m[2].toUpperCase()]) return `${m[3]}-${MON[m[2].toUpperCase()]}-${m[1].padStart(2, '0')}`;
  m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}
const DATE = '(\\d{1,2}\\s*[-/ ]\\s*[A-Za-z]{3,9}\\s*[-/ ]\\s*\\d{4}|\\d{1,2}\\/\\d{1,2}\\/\\d{4})';

export function parseESIS(raw) {
  const t = String(raw || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ');
  if (!t.trim()) return null;
  const flat = t.replace(/\n/g, ' ');
  const get = (re) => flat.match(re);
  const lender = (t.match(/(?:^|\n)\s*1\s*\|?\s*Lender\s*\n\s*([^\n]{3,60})/i) || [])[1]?.trim() || null;
  const loan = pence(get(new RegExp(`(?:Amount and currency of the loan to be granted|Amount of (?:the )?loan|Loan amount)[^£]{0,20}${M}`, 'i'))?.[1]);
  const termM = get(/Duration of the loan:?\s*(\d{1,2})\s*years?(?:\s*(?:and\s*)?(\d{1,2})\s*months?)?/i) || get(/\bterm of (\d{1,2}) years/i);
  const termYears = termM ? +termM[1] + (termM[2] ? +termM[2] / 12 : 0) : null;
  const price = pence(get(new RegExp(`purchase price of ${M}`, 'i'))?.[1] ?? get(new RegExp(`Value of the property assumed[^£]{0,60}${M}`, 'i'))?.[1]);
  const interestOnly = /interest[- ]only mortgage/i.test(flat) && !/This is a repayment mortgage/i.test(flat);
  const fixM = get(new RegExp(`fixed rate of (\\d{1,2}\\.\\d{1,2})%\\s*(?:until|to|for)\\s*${DATE}`, 'i'));
  const rate = fixM ? parseFloat(fixM[1]) : (get(/(?:initial|fixed|discounted|tracker) rate[^%]{0,30}?(\d{1,2}\.\d{1,2})%/i) || [])[1] ? parseFloat(get(/(?:initial|fixed|discounted|tracker) rate[^%]{0,30}?(\d{1,2}\.\d{1,2})%/i)[1]) : null;
  const fixedUntil = fixM ? isoDate(fixM[2]) : null;
  const svrM = get(/rate that will apply is[^%]{0,80}?(\d{1,2}\.\d{1,2})%/i) || get(/Standard Variable Rate,?\s*currently\s*(\d{1,2}\.\d{1,2})%/i);
  const followRate = svrM ? parseFloat(svrM[1]) : null;
  const aprc = (get(/APRC[^%]{0,40}?is\s*(\d{1,2}(?:\.\d{1,2})?)%/i) || [])[1];
  const produced = isoDate((get(new RegExp(`produced[^\\n]{0,80}?on ${DATE}`, 'i')) || [])[1] || '');
  // Payment schedule: "25 payments at a fixed rate of 5.98% £1,586.77", "275 payments at a variable rate currently 7.04% £1,740.43".
  const steps = [...flat.matchAll(new RegExp(`(\\d{1,3}) (?:monthly )?payments? at an? ([a-z ]{0,30}?)rate[^%]{0,30}?(\\d{1,2}\\.\\d{1,2})%[^£]{0,20}${M}`, 'gi'))].map((m) => ({ count: +m[1], kind: /fix/i.test(m[2]) ? 'fixed' : 'variable', rate: parseFloat(m[3]), payment: pence(m[4]) }));
  const payFixed = steps[0]?.payment ?? null;
  const payAfter = steps.length > 1 ? steps[steps.length - 1].payment : null;
  const total = pence(get(new RegExp(`Total amount to be repaid:?\\s*${M}`, 'i'))?.[1]);
  const perPoint = pence(get(new RegExp(`one percentage point increase[^£]{0,160}${M}`, 'i'))?.[1]);
  const fee = (label) => pence(get(new RegExp(`${label}[^£]{0,240}?${M}`, 'i'))?.[1]);
  const fees = [['Arrangement fee', fee('Arrangement fee')], ['Funds release fee', fee('Funds release fee')], ['Valuation fee', fee('Valuation fee')], ['Booking fee', fee('Booking fee')]].filter(([, v]) => v).map(([label, amount]) => ({ label, amount }));
  const ercs = [...flat.matchAll(new RegExp(`${DATE}\\s*to\\s*${DATE}\\s*\\|?\\s*(\\d{1,2}(?:\\.\\d{1,2})?)%\\s*of the amount repaid\\.?\\s*\\|?\\s*${M}`, 'gi'))].map((m) => ({ from: isoDate(m[1]), to: isoDate(m[2]), pct: parseFloat(m[3]), amount: pence(m[4]) }));
  const overpayPct = (get(/overpayments[^%]{0,120}?up to (\d{1,2})%/i) || [])[1];
  const out = { lender, loan, termYears, price, interestOnly, rate, fixedUntil, followRate, aprc: aprc ? parseFloat(aprc) : null, produced, steps, payFixed, payAfter, total, perPoint, fees, ercs, overpayPct: overpayPct ? +overpayPct : null };
  return out.loan || out.rate || out.payFixed ? out : null;
}
