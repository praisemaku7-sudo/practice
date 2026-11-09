// Suggested categories for payments filed as "Other", worked out on the phone (free):
// your own past choices, card-processor prefixes, similar merchants, and regular-payment patterns.
import { categorize, merchantKey } from './categorize.js';
import { catName } from './categories.js';
import { daysBetween } from './dates.js';

// "SQ *THE COFFEE BAR", "SUMUP *ANYTOWN BUTCHER", "PAYPAL *NETFLIX": the real merchant is after the prefix.
const PROCESSOR = /^(SQ|SQUARE|SUMUP|SUM ?UP|ZETTLE|IZETTLE|IZ|PP|PAYPAL|CRV|CURVE|STRIPE|SP|GOCARDLESS|WORLDPAY|YOYO|TAP|PAYPOINT|ELAVON)\b\s*\*?\s*/i;

/** Every "Other" payment grouped by merchant, biggest first. */
export function otherMerchants(txs) {
  const groups = new Map();
  for (const t of txs) {
    if (t.category !== 'other') continue;
    const k = t.merchant || merchantKey(t.description);
    if (!groups.has(k)) groups.set(k, { merchant: k, txs: [], total: 0, sample: t.description });
    const g = groups.get(k); g.txs.push(t); g.total += Math.abs(t.amount);
  }
  return [...groups.values()].sort((a, b) => b.total - a.total);
}

/** Merchants and how much went to each, for any set of transactions. */
export function merchantGroups(txs) {
  const groups = new Map();
  for (const t of txs) {
    const k = t.merchant || merchantKey(t.description);
    if (!groups.has(k)) groups.set(k, { merchant: k, category: t.category, txs: [], total: 0, sample: t.description });
    const g = groups.get(k); g.txs.push(t); g.total += Math.abs(t.amount);
  }
  return [...groups.values()];
}

/**
 * @returns {{category: string, confidence: 'high'|'medium'|'low', reason: string} | null}
 */
export function suggestCategory(group, allTxs, { userRules = {}, saved = {} } = {}) {
  const { merchant, sample } = group;
  const out = group.txs.every((t) => t.amount < 0);
  // 1. Claude looked it up online earlier.
  if (saved[merchant] && saved[merchant].category !== 'other') return { category: saved[merchant].category, confidence: saved[merchant].confidence || 'medium', reason: saved[merchant].business ? `Claude: ${saved[merchant].business}` : 'Claude looked it up' };
  // 2. A card-processor prefix hides the real name.
  const stripped = String(sample || '').replace(PROCESSOR, '');
  if (stripped !== sample) {
    const c = categorize(stripped, out ? -1 : 1, userRules);
    if (c !== 'other' && c !== 'income') return { category: c, confidence: 'high', reason: `"${merchantKey(stripped)}" paid through a card reader` };
  }
  // 2b. Spelling variants the rules miss: plurals and possessives ("SAINSBURYS", "MCDONALDS LTD").
  {
    const orig = String(sample || merchant).toUpperCase();
    const variants = [orig, orig.replace(/'S\b/g, 'S'), orig.replace(/'S\b/g, '').replace(/\b([A-Z]{4,})S\b/g, '$1')];
    for (const v of variants) {
      const c = categorize(v, out ? -1 : 1, userRules);
      if (c !== 'other' && !(out && c === 'income')) return { category: c, confidence: 'high', reason: `Looks like ${catName(c).toLowerCase()}` };
    }
  }
  // 3. You've put a merchant with the same first word somewhere else before.
  let weak = null;
  const first = merchant.split(' ')[0];
  if (first && first.length >= 4) {
    const votes = {};
    for (const [k, c] of Object.entries(userRules)) if (k !== merchant && k.split(' ')[0] === first && c !== 'other' && !(out && c === 'income')) votes[c] = (votes[c] || 0) + 3;
    for (const t of allTxs) {
      if (t.category === 'other' || t.category === 'transfer' || t.category === 'excluded') continue;
      // Only learn from payments going the same way: "ACME SALARY" (in) says nothing about "ACME HOMES" (out).
      if ((t.amount < 0) !== out || (out && t.category === 'income')) continue;
      const k = t.merchant || merchantKey(t.description);
      if (k !== merchant && k.split(' ')[0] === first) votes[t.category] = (votes[t.category] || 0) + 1;
    }
    const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
    // One similar payment is only a hint; a regular-payment pattern below can beat it.
    if (best && best[1] >= 2) return { category: best[0], confidence: best[1] >= 3 ? 'high' : 'medium', reason: `Same as other ${first[0] + first.slice(1).toLowerCase()} payments` };
    if (best) weak = { category: best[0], confidence: 'low', reason: `Like another ${first[0] + first.slice(1).toLowerCase()} payment` };
  }
  // 4. Money in that isn't a transfer is usually income or a refund.
  if (!out) return { category: 'income', confidence: 'low', reason: 'Money coming in' };
  // 5. Regular payments: same amount roughly monthly.
  const list = [...group.txs].sort((a, b) => a.date.localeCompare(b.date));
  if (list.length >= 2) {
    const gaps = list.slice(1).map((t, i) => daysBetween(list[i].date, t.date));
    const monthly = gaps.every((g) => g >= 25 && g <= 35);
    const amounts = list.map((t) => Math.abs(t.amount));
    const steady = Math.max(...amounts) - Math.min(...amounts) <= Math.max(...amounts) * 0.05;
    if (monthly && steady) {
      const amt = amounts[amounts.length - 1];
      if (amt >= 40000) return { category: 'housing', confidence: 'low', reason: `Same large amount every month (£${Math.round(amt / 100)}): rent or mortgage?` };
      if (amt <= 3000) return { category: 'subscriptions', confidence: 'medium', reason: `Same small amount every month (£${(amt / 100).toFixed(2)})` };
      return { category: 'bills', confidence: 'low', reason: 'Same amount every month' };
    }
  }
  if (/\b(DD|DIRECT DEBIT)\b/i.test(sample || '')) return { category: 'bills', confidence: 'low', reason: 'Paid by Direct Debit' };
  return weak;
}

export const describeSuggestion = (s) => (s ? `${catName(s.category)} · ${s.reason}` : '');
