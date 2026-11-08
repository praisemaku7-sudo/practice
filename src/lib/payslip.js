// Reads take-home pay from a UK payslip so the budget uses real income, not an estimate.
import { findNamedDates } from './dates.js';

const MONEY = /£?\s*(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})/;
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
export function parsePayslip(text) {
  const t = String(text || '').replace(/ /g, ' ');
  // "Net Pay 2,345.67", "NET PAY: £2,345.67", "Take home pay ... 2345.67", "Amount paid 2,345.67"
  const net = take(new RegExp(`(?:net\\s*pay(?:ment)?|take[- ]home(?:\\s*pay)?|amount\\s*paid|total\\s*net)[^\\d£\\n]{0,40}${MONEY.source}`, 'i'), t);
  if (!net) return null;
  const gross = take(new RegExp(`(?:gross\\s*pay|total\\s*gross|total\\s*payments?)(?!\\s*(?:ytd|year))[^\\d£\\n]{0,40}${MONEY.source}`, 'i'), t);
  const frequency = /\b(4|four)[- ]?week(ly)?\b/i.test(t) ? 'four-weekly'
    : /\b(fortnight(ly)?|bi-?weekly|2[- ]?week(ly)?)\b/i.test(t) ? 'fortnightly'
    : /\bweekly\b|\bweek\s*(no|number)\b/i.test(t) ? 'weekly' : 'monthly';
  const dateMatch = t.match(/(?:pay(?:ment)?\s*date|date\s*paid|paid\s*on|process(?:ing)?\s*date)[^\d\n]{0,15}(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})/i);
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
