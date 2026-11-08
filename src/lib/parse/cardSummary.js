// Credit card statements print a summary of the balance, e.g. (Aqua/NewDay, Barclaycard, Capital One):
//   Previous balance £400.00 | Payments & credits £100.00 | New spending £60.00 | Interest £9.12 | Fees £12.00 | New balance £381.12
// in a column, a row, or a table with the figures underneath. When the figures add up, the
// new balance is proven, and interest/fees that are only in the summary (not listed as
// transactions) are added so what you owe and your spending are right.
import { amountsFor } from './amounts.js';

export const L = {
  previous: /\b(previous (statement )?balance|balance (from|on) (your )?(last|previous) statement|last statement balance|opening balance|balance brought forward)\b/i,
  credits: /(?<!minimum |min\.? |next |your )\b(payments?( (and|&) (other )?credits?)?( received| made| to (your )?(account|card))?|(new |total |other )?credits?( received)?|money (in|paid in)|refunds?)\b(?! ?(due|date|limit|by|interest|card|rate))/i,
  debits: /\b((new |total )?(purchases?|spending|spend|debits?|transactions)( (and|&) (other )?(debits|charges))?|money (out|spent)|new transactions)\b(?! ?(rate|interest))/i,
  interest: /\b(total )?interest( charged| added| this (month|period))?\b(?! ?(rate|free|-free|days|next|on (balance|purchases) (rate))|s?\s*%)/i,
  fees: /\b((total )?(fees( (and|&) charges)?|charges|default (fees?|charges)|late payment fee|over ?limit fee)|other fees)\b(?! ?rate)/i,
  closing: /\b((your )?new balance|(current |total )?statement balance|closing balance|balance (owed|outstanding|carried forward)|outstanding balance|total balance)\b/i,
};

const CREDIT_WORDS = /\b(BENEFIT|CREDIT|REFUND|CASHBACK|POINTS TOWARDS|REWARD|REVERSAL|ADJUSTMENT)\b/i;
const near = (a, b) => Math.abs(a - b) <= 1;

/** Returns {previous, credits, debits, interest, fees, closing} in pence (all positive = owed/paid), or null. */
export function cardSummaryFields(text) {
  const t = String(text || '');
  const c = Object.fromEntries(Object.entries(L).map(([k, re]) => [k, amountsFor(t, re)]));
  if (!c.previous.length || !c.closing.length) return null;
  const opt = (a) => [0, ...a];
  for (const closing of c.closing) for (const previous of c.previous) {
    if (!closing && !previous) continue;
    for (const credits of opt(c.credits)) for (const debits of opt(c.debits)) {
      if (!credits && !debits) continue;
      // Prefer the reading that uses the most summary lines (interest and fees included).
      for (const interest of [...c.interest, 0]) for (const fees of [...c.fees, 0]) {
        if (interest && fees && interest === fees) continue;
        if (near(previous - credits + debits + interest + fees, closing)) return { previous, credits, debits, interest, fees, closing };
      }
    }
  }
  return null;
}

/**
 * Line the transactions up with the summary. Transactions: spending negative, payments positive.
 * Returns {transactions, openingBalance, closingBalance, added} with balances stored as negative = owed.
 */
export function applyCardSummary({ transactions, period }, box) {
  const txs = transactions.map((t) => ({ ...t }));
  const sum = () => txs.reduce((a, t) => a + t.amount, 0);
  const credits = () => txs.filter((t) => t.amount > 0).reduce((a, t) => a + t.amount, 0);
  // A payment printed without "CR" (read as spending): flip the one that closes the gap.
  if (box.credits) {
    const diff = box.credits - credits();
    const cand = diff > 0 ? (txs.find((t) => t.amount === -diff) || txs.find((t) => t.amount < 0 && CREDIT_WORDS.test(t.description || '') && -t.amount <= diff))
      : diff < 0 ? txs.find((t) => t.amount === -diff) : null;
    if (cand) cand.amount = -cand.amount;
  }
  const openingBalance = -box.previous;
  const closingBalance = -box.closing;
  const added = [];
  const shortfall = (openingBalance + sum()) - closingBalance; // > 0: owed more than the transactions explain
  if (shortfall > 1) {
    const date = period?.end || txs.map((t) => t.date).filter(Boolean).sort().pop();
    const has = (amt, re) => txs.some((t) => t.amount === -amt && re.test(t.description || ''));
    const parts = [];
    if (box.interest && !has(box.interest, /interest/i)) parts.push(['Interest charged (from statement summary)', box.interest]);
    if (box.fees && !has(box.fees, /fee|charge/i)) parts.push(['Fee charged (from statement summary)', box.fees]);
    // Only add what exactly explains the gap.
    for (const pick of [parts, parts.slice(0, 1), parts.slice(1)]) {
      if (pick.length && near(pick.reduce((a, [, v]) => a + v, 0), shortfall)) {
        for (const [description, v] of pick) {
          const tx = { date, description, amount: -v, category: 'fees', fromSummary: true };
          txs.push(tx); added.push(tx);
        }
        break;
      }
    }
  }
  return { transactions: txs, openingBalance, closingBalance, added };
}
