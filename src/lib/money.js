// All money is stored as integer pence to avoid floating point drift.

const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
const gbp0 = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });

/** Format pence as £1,234.56 (or £1,235 when whole=true). */
export function fmt(pence, { whole = false, sign = false } = {}) {
  const v = (pence || 0) / 100;
  const s = (whole ? gbp0 : gbp).format(Math.abs(v));
  if (v < 0) return '−' + s;
  if (sign && v > 0) return '+' + s;
  return s;
}

/**
 * Parse a money string from a statement or user input into pence.
 * Handles "£1,234.56", "-12.00", "(12.00)", "12.00CR", "12.00 DR", "1 234,56" is NOT supported (UK only).
 * Returns { pence, credit, debit, negative } or null if not money.
 */
export function parseMoney(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/−/g, '-');
  if (!s) return null;
  let credit = false, debit = false, negative = false;
  const suffix = s.match(/\s*(CR|DR|C|D)$/i);
  if (suffix && /\d/.test(s.slice(0, suffix.index))) {
    const t = suffix[1].toUpperCase();
    credit = t === 'CR' || t === 'C';
    debit = t === 'DR' || t === 'D';
    s = s.slice(0, suffix.index).trim();
  }
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (s.startsWith('-')) { negative = true; s = s.slice(1).trim(); }
  if (s.startsWith('+')) s = s.slice(1).trim();
  s = s.replace(/^(GBP|£)\s*/i, '');
  if (s.startsWith('-')) { negative = true; s = s.slice(1).trim(); }
  if (!/^\d{1,3}(,\d{3})*(\.\d{1,2})?$|^\d+(\.\d{1,2})?$/.test(s)) return null;
  const pence = Math.round(parseFloat(s.replace(/,/g, '')) * 100);
  return { pence, credit, debit, negative };
}

/** Strict statement-amount token: must have exactly two decimals (avoids matching dates/refs). */
export const AMOUNT_TOKEN = /^\(?[-−+]?£?[-−]?\d{1,3}(?:,\d{3})*\.\d{2}\)?(?:CR|DR)?$|^\(?[-−+]?£?[-−]?\d+\.\d{2}\)?(?:CR|DR)?$/i;

/** Parse a user-typed price like "49.99", "£1,200", "1.2k". Returns pence or null. */
export function parsePrice(input) {
  if (input == null) return null;
  let s = String(input).trim().toLowerCase().replace(/[£,\s]/g, '').replace(/gbp/, '');
  let mult = 1;
  if (s.endsWith('k')) { mult = 1000; s = s.slice(0, -1); }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Math.round(parseFloat(s) * mult * 100);
}
