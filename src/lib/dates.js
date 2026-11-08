export const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

const pad = (n) => String(n).padStart(2, '0');
export const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

function validDate(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1;
}

function fullYear(y) {
  y = Number(y);
  return y < 100 ? 2000 + y : y;
}

export function monthIndex(name) {
  return MONTHS.indexOf(String(name).slice(0, 3).toLowerCase()) + 1;
}

/**
 * Match a UK-style date at the START of a string.
 * Returns { y|null, m, d, length } where y is null when the year is absent ("12 Oct").
 */
export function matchLeadingDate(text) {
  const s = String(text);
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s][\d:.]+Z?)?\b/))) {
    return { y: +m[1], m: +m[2], d: +m[3], length: m[0].length };
  }
  if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/))) {
    return { y: fullYear(m[3]), m: +m[2], d: +m[1], length: m[0].length };
  }
  const named = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?[\\s\\-]?${MONTH_RE}\\.?(?:[\\s\\-,]+(\\d{4}|\\d{2}))?\\b`, 'i');
  if ((m = s.match(named))) {
    return { y: m[3] ? fullYear(m[3]) : null, m: monthIndex(m[2]), d: +m[1], length: m[0].length };
  }
  // Month first, as American Express prints it: "Jun 14" or "Jun 14, 2026".
  const monthFirst = new RegExp(`^${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?(?!\\d)\\b`, 'i');
  if ((m = s.match(monthFirst))) {
    const d = +m[2];
    if (d >= 1 && d <= 31) return { y: m[3] ? +m[3] : null, m: monthIndex(m[1]), d, length: m[0].length };
  }
  return null;
}

/** Parse any supported date string fully (used by CSV). Returns ISO date or null. */
export function parseDate(text, fallbackYear) {
  const r = matchLeadingDate(String(text).trim());
  if (!r) return null;
  const y = r.y ?? fallbackYear;
  if (!y || !validDate(y, r.m, r.d)) return null;
  return iso(y, r.m, r.d);
}

/** Find all "12 October 2026"-style dates anywhere in a text block. */
export function findNamedDates(text) {
  const re = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}\\.?,?\\s+(\\d{4})\\b`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(text))) {
    const y = +m[3], mo = monthIndex(m[2]), d = +m[1];
    if (validDate(y, mo, d)) out.push(iso(y, mo, d));
  }
  const re2 = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
  while ((m = re2.exec(text))) {
    if (validDate(+m[3], +m[2], +m[1])) out.push(iso(+m[3], +m[2], +m[1]));
  }
  return out;
}

export const monthKey = (isoDate) => isoDate.slice(0, 7);

export function addMonths(key, n) {
  const [y, m] = key.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}

export function monthLabel(key, { short = false } = {}) {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', {
    month: short ? 'short' : 'long', year: short ? '2-digit' : 'numeric', timeZone: 'UTC',
  });
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

export function addDays(isoDate, n) {
  const t = Date.parse(isoDate + 'T00:00:00Z') + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

export function daysInMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function todayISO(now = new Date()) {
  return iso(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function prettyDate(isoDate) {
  return new Date(isoDate + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** Next date (>= from) that falls on day-of-month `day`, clamped to month length. */
export function nextDayOfMonth(from, day) {
  let key = monthKey(from);
  for (let i = 0; i < 3; i++) {
    const d = Math.min(day, daysInMonth(key));
    const candidate = `${key}-${pad(d)}`;
    if (candidate >= from) return candidate;
    key = addMonths(key, 1);
  }
  return from;
}
