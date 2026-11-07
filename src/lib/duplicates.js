// Fuzzy duplicate detection. The same payment can appear with a different date
// (transaction vs posting date) and different wording in a PDF, a CSV, or two
// overlapping statements, so exact matching misses it.
import { daysBetween } from './dates.js';

const STOP = new Set(['CARD', 'PAYMENT', 'PAYMENTS', 'PURCHASE', 'TO', 'FROM', 'THE', 'AND', 'LTD', 'LIMITED', 'PLC', 'UK', 'GB', 'GBR', 'LONDON',
  'DIRECT', 'DEBIT', 'STANDING', 'ORDER', 'FASTER', 'CONTACTLESS', 'VISA', 'MASTERCARD', 'POS', 'DD', 'SO', 'BGC', 'FPO', 'FPI', 'CPT', 'DEB', 'ON', 'AT', 'REF', 'COM', 'WWW', 'CO']);

export function words(desc) {
  return new Set(String(desc || '').toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w)));
}

/** 0..1 overlap of meaningful words (relative to the shorter description). */
export function similarity(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0.5; // nothing meaningful to compare: neutral
  let shared = 0;
  for (const w of A) if (B.has(w)) shared += 1;
  // Allow prefix matches like "SAINSBURYS" vs "SAINSBURY".
  if (!shared) for (const w of A) for (const v of B) if (w.length >= 5 && v.length >= 5 && (w.startsWith(v.slice(0, 5)) || v.startsWith(w.slice(0, 5)))) { shared += 1; break; }
  return shared / Math.min(A.size, B.size);
}

export function isSamePayment(a, b, { maxDays = 3, minSim = 0.5, sameAccount = true } = {}) {
  if (a.amount !== b.amount) return false;
  if (sameAccount && a.accountId !== b.accountId) return false;
  if (Math.abs(daysBetween(a.date, b.date)) > maxDays) return false;
  return similarity(a.description, b.description) >= minSim;
}

/**
 * Match incoming rows against stored transactions, one-to-one.
 * Returns { matches: Map<incomingIndex, storedTx>, byAccount: Map<accountId, count> }.
 */
export function matchIncoming(incoming, stored, { sameAccountId = null } = {}) {
  const byAmount = new Map();
  for (const t of stored) {
    if (t.manual) continue;
    if (sameAccountId && t.accountId !== sameAccountId) continue;
    if (!byAmount.has(t.amount)) byAmount.set(t.amount, []);
    byAmount.get(t.amount).push(t);
  }
  const used = new Set();
  const matches = new Map();
  const byAccount = new Map();
  incoming.forEach((t, i) => {
    const cands = (byAmount.get(t.amount) || []).filter((s) => !used.has(s.id) && isSamePayment(t, s, { sameAccount: false }));
    if (!cands.length) return;
    // Prefer exact date, then most similar wording.
    cands.sort((x, y) => Math.abs(daysBetween(t.date, x.date)) - Math.abs(daysBetween(t.date, y.date)) || similarity(t.description, y.description) - similarity(t.description, x.description));
    const s = cands[0];
    used.add(s.id);
    matches.set(i, s);
    byAccount.set(s.accountId, (byAccount.get(s.accountId) || 0) + 1);
  });
  return { matches, byAccount };
}

/**
 * Find duplicates already saved: same account, same amount, within 3 days, similar wording,
 * and from DIFFERENT imports (two identical coffees on one statement are both real).
 * Returns [{ keep, remove }] — keeps the one you categorised by hand, else the earlier import.
 */
export function findStoredDuplicates(txs) {
  const groups = new Map();
  for (const t of txs) {
    if (t.manual) continue;
    const k = `${t.accountId}|${t.amount}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const pairs = [];
  const removed = new Set();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (removed.has(a.id)) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (removed.has(b.id)) continue;
        if (daysBetween(a.date, b.date) > 3) break;
        if (a.importId && b.importId && a.importId === b.importId) continue;
        if (!isSamePayment(a, b)) continue;
        const keepA = (a.userCategory && !b.userCategory) || (!b.userCategory && (a.importId || '') <= (b.importId || ''));
        const keep = keepA ? a : b, remove = keepA ? b : a;
        removed.add(remove.id);
        pairs.push({ keep, remove });
        if (remove === a) break;
      }
    }
  }
  return pairs;
}
