// Statement coverage: which months each account has statements for, and which are missing.
import { monthKey, addMonths, todayISO } from './dates.js';
import { matchIncoming } from './duplicates.js';

function monthsBetween(a, b) {
  const out = [];
  for (let m = a; m <= b; m = addMonths(m, 1)) out.push(m);
  return out;
}

/**
 * @param {{accounts, imports, txs, today?, dismissed?: Record<string, boolean>, graceDays?: number}} p
 * imports: [{accountId, periodStart, periodEnd}] — periods are ISO dates (may be missing on old imports).
 * Returns per-account coverage and a flat list of missing months.
 */
export function statementCoverage({ accounts, imports, txs, today = todayISO(), dismissed = {}, graceDays = 7, startMonth = null }) {
  const thisMonth = monthKey(today);
  // A statement for last month is normally available a few days into this month.
  const expectUpTo = +today.slice(8) > graceDays ? addMonths(thisMonth, -1) : addMonths(thisMonth, -2);
  const result = [];
  const missing = [];
  for (const acc of accounts) {
    const covered = new Set();
    // Nothing before the tracking start (global, or later for an account opened since) is ever asked for.
    const accStart = [startMonth, acc.trackFrom ? monthKey(acc.trackFrom) : null].filter(Boolean).sort().pop() || null;
    const keep = (m) => !accStart || m >= accStart;
    for (const imp of imports.filter((i) => i.accountId === acc.id && i.periodStart && i.periodEnd)) {
      for (const m of monthsBetween(monthKey(imp.periodStart), monthKey(imp.periodEnd))) if (keep(m)) covered.add(m);
    }
    // Months with transactions count as covered too (e.g. CSVs, older imports without a period).
    for (const t of txs) if (t.accountId === acc.id && !t.manual && keep(monthKey(t.date))) covered.add(monthKey(t.date));
    if (!covered.size) { result.push({ account: acc, months: [], covered, missing: [] }); continue; }
    const sorted = [...covered].sort();
    // Expect statements from the tracking start, so a missing first month (e.g. June) is still flagged.
    const first = accStart && accStart < sorted[0] ? accStart : sorted[0];
    const last = sorted[sorted.length - 1] > expectUpTo ? sorted[sorted.length - 1] : expectUpTo;
    const months = monthsBetween(first, last);
    const accMissing = months
      .filter((m) => !covered.has(m) && m <= expectUpTo && !dismissed[`${acc.id}|${m}`])
      .map((m) => ({ accountId: acc.id, accountName: acc.name, month: m, reason: m > sorted[sorted.length - 1] ? 'latest' : m < sorted[0] ? 'start' : 'gap' }));
    missing.push(...accMissing);
    result.push({ account: acc, months, covered, missing: accMissing });
  }
  return { accounts: result, missing };
}

/**
 * Compare an incoming statement with what's stored. Fuzzy: same amount, dates within 3 days,
 * similar wording, on any account (so a statement filed under the wrong account is still caught).
 */
export function overlapReport(incoming, existing) {
  const { matches, byAccount } = matchIncoming(incoming, existing);
  const matched = matches.size;
  const top = [...byAccount.entries()].sort((a, b) => b[1] - a[1])[0];
  const ratio = incoming.length ? matched / incoming.length : 0;
  return {
    matched,
    total: incoming.length,
    ratio,
    likelyDuplicate: ratio >= 0.8,
    partialOverlap: matched > 0 && ratio < 0.8,
    matchedAccountId: top ? top[0] : null,
  };
}

/** SHA-256 of file bytes, hex. Browser + Node 20+. */
export async function fileHash(arrayBuffer) {
  const d = await crypto.subtle.digest('SHA-256', arrayBuffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
