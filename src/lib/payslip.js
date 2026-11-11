// Reads take-home pay from a UK payslip so the budget uses real income, not an estimate.
import { findNamedDates } from './dates.js';
import { amountFor } from './parse/amounts.js';

const take = (re, text) => {
  const m = String(text).match(re);
  return m ? Math.round(parseFloat(m[1].replace(/,/g, '')) * 100) : null;
};

/** Monthly equivalent of a pay amount for a given frequency. */
export function toMonthly(pence, frequency) {
  const f = { weekly: 52 / 12, fortnightly: 26 / 12, 'four-weekly': 13 / 12, monthly: 1 }[frequency] || 1;
  return Math.round(pence * f);
}

/**
 * @returns {{ net, gross, frequency, monthlyNet, payDate, employer } | null}
 */
/**
 * Table-style payslips (Workday and similar): a heading row "Gross Pay  Employer Taxes  Employee
 * Taxes  Deductions  Net Pay" with the amounts on the next line in the same order. Returns the amount
 * in the same position as the matching heading, or null if the row doesn't line up.
 */
function fromTableRow(t, labelRe) {
  const lines = t.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const heads = lines[i].trim().split(/\s{2,}/);
    const idx = heads.findIndex((h) => labelRe.test(h));
    if (idx < 0 || heads.length < 3) continue;
    const next = lines.slice(i + 1, i + 4).find((l) => l.trim());
    // The amounts row may start with a row name ("Current", "This period").
    const vals = (next || '').trim().split(/\s{2,}/).filter((v) => /^-?£?[\d,]+\.\d{2}$/.test(v));
    if (vals.length === heads.length) return Math.round(parseFloat(vals[idx].replace(/[£,]/g, '')) * 100);
  }
  // Spacing between headings can vary (PDF text isn't always spaced evenly): if the heading row
  // starts with Gross Pay and ends with Net Pay, they are the first and last amounts below it.
  for (let i = 0; i < lines.length - 1; i++) {
    const h = lines[i];
    const g = h.search(/gross\s*pay/i), n = h.search(/net\s*pay/i);
    if (g < 0 || n < 0 || n < g || /\d\.\d{2}/.test(h)) continue;
    const next = lines.slice(i + 1, i + 4).find((l) => (l.match(/-?[\d,]+\.\d{2}/g) || []).length >= 3);
    if (!next) continue;
    const amts = next.match(/-?[\d,]+\.\d{2}/g);
    const want = labelRe.test('Gross Pay') ? amts[0] : labelRe.test('Net Pay') ? amts[amts.length - 1] : null;
    if (want) return Math.round(parseFloat(want.replace(/,/g, '')) * 100);
  }
  return null;
}

/** The payment date in a "Pay Period Begin  Pay Period End  Payment Date" row (three dates in a row). */
function paymentDateFromRow(t) {
  const lines = t.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    if (!/payment\s*date|pay\s*date|date\s*paid/i.test(lines[i])) continue;
    const heads = lines[i].trim().split(/\s{2,}/);
    const idx = heads.findIndex((h) => /payment\s*date|pay\s*date|date\s*paid/i.test(h));
    const next = lines.slice(i + 1, i + 4).find((l) => /\d{2}\/\d{2}\/\d{4}/.test(l));
    if (!next) continue;
    const vals = next.trim().split(/\s{2,}/);
    if (vals.length === heads.length && /^\d{2}\/\d{2}\/\d{4}$/.test(vals[idx])) return vals[idx];
    const dates = next.match(/\d{2}\/\d{2}\/\d{4}/g) || [];
    // Period begin, period end, payment date: the payment date is the third.
    if (dates.length === 3) return dates[2];
  }
  return null;
}

export function parsePayslip(text) {
  const t = String(text || '').replace(/ /g, ' ');
  // "Net Pay 2,345.67", "NET PAY: £2,345.67", or a "Net Pay" column with the amount underneath.
  const net = fromTableRow(t, /^net\s*pay$/i) ?? amountFor(t, /\b(net\s*pay(?:ment)?|take[- ]home(?:\s*pay)?|amount\s*paid(?:\s*to\s*you)?|total\s*net(?:\s*pay)?|net\s*amount)\b/i);
  if (!net || net <= 0) return null;
  const gross = fromTableRow(t, /^gross\s*pay$/i) ?? amountFor(t, /\b(gross\s*pay|total\s*gross(?:\s*pay)?|total\s*payments?|gross\s*earnings)\b(?!\s*(ytd|year))/i);
  const frequency = /\b(4|four)[- ]?week(ly)?\b/i.test(t) ? 'four-weekly'
    : /\b(fortnight(ly)?|bi-?weekly|2[- ]?week(ly)?)\b/i.test(t) ? 'fortnightly'
    : /\bweekly\b|\bweek\s*(no|number)\b/i.test(t) ? 'weekly' : 'monthly';
  const rowDate = paymentDateFromRow(t);
  const dateMatch = rowDate ? [null, rowDate] : t.match(/(?:pay(?:ment)?\s*date|date\s*paid|paid\s*on|process(?:ing)?\s*date)[^\d\n]{0,15}(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})/i);
  let payDate = null;
  if (dateMatch) {
    const d = dateMatch[1];
    const named = findNamedDates(d)[0];
    if (named) payDate = named;
    else { const [dd, mm, yy] = d.split(/[\/.-]/).map(Number); payDate = `${yy < 100 ? 2000 + yy : yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`; }
  }
  const employer = (t.match(/(?:employer|company)\s*(?:name)?\s*[:\-]?\s*([A-Z][A-Za-z0-9&.,' -]{2,40})/) || [])[1]?.trim() || null;
  return { net, gross, frequency, monthlyNet: toMonthly(net, frequency), payDate, employer };
}

/**
 * Your usual take-home from several payslips: the average of the latest three normal months, leaving
 * out one-off months (a correction, back pay or a part month) more than 15% away from the median.
 * @param slips [{payDate, monthlyNet}]
 */
export function typicalPay(slips) {
  const sorted = [...slips].filter((x) => x.monthlyNet > 0).sort((a, b) => String(b.payDate).localeCompare(String(a.payDate)));
  if (!sorted.length) return { monthly: null, used: [], oneOffs: [] };
  const recent = sorted.slice(0, 5);
  const vals = recent.map((x) => x.monthlyNet).sort((a, b) => a - b);
  const median = vals[Math.floor(vals.length / 2)];
  const oneOffs = recent.filter((x) => Math.abs(x.monthlyNet - median) > median * 0.15);
  const used = recent.filter((x) => !oneOffs.includes(x)).slice(0, 3);
  // With one or two payslips, the latest is the best guess.
  const monthly = sorted.length < 3 ? sorted[0].monthlyNet : Math.round(used.reduce((a, x) => a + x.monthlyNet, 0) / used.length);
  return { monthly, used, oneOffs, latest: sorted[0] };
}
