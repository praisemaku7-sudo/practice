// Small helpers used across the app (one copy each).

/** 1 → "1st", 22 → "22nd", 13 → "13th". */
export const ord = (d) => `${d}${d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th'}`;

/** Total of a list, by a field or function (default: .amount). */
export const sum = (list, f = (x) => x.amount) => (list || []).reduce((a, x) => a + (f(x) || 0), 0);

/** Middle value (the upper middle for an even count). */
export const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** Pounds (number or "1,234.56") to pence; null stays null. */
export const pence = (v) => (v == null || v === '' ? null : Math.round(parseFloat(String(v).replace(/[£,\s]/g, '')) * 100));
