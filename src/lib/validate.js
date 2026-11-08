// How sure are we that a statement was read correctly? A list of independent checks, each
// passed / failed / not possible, using the statement's own figures.
import { amountsFor } from './parse/amounts.js';

const sgbp = (p) => `${p < 0 ? '−' : ''}£${(Math.abs(p) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const gbp = (p) => `£${(Math.abs(p) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Printed totals ("Total paid in £2,603.40", "Money out £445.00") anywhere in the statement text. */
export function printedTotals(text) {
  // Only labels that say "total": a "Money in" column heading is not a total.
  const pick = (re) => amountsFor(text, re, { limit: 3, maxBelow: 1 });
  return {
    in: pick(/\b(total (paid in|money in|credits|deposits|received|payments in|in)|paid in total)\b/i),
    out: pick(/\b(total (paid out|money out|debits|withdrawals|spent|payments out|out)|paid out total)\b/i),
  };
}

/**
 * @param p parsed statement {transactions, openingBalance, closingBalance, period, printed, screenshot, accountType}
 * @returns {{level: 'ok'|'partial'|'fail'|'unchecked', summary: string, checks: Array<{ok: boolean|null, text: string}>}}
 */
export function validateStatement(p) {
  const txs = p.transactions || [];
  const checks = [];
  if (p.screenshot) {
    return { level: 'unchecked', summary: 'Screenshot: no printed balances to check against. Glance at the amounts.', checks: [{ ok: null, text: `${txs.length} transaction${txs.length === 1 ? '' : 's'} read by Claude from the picture` }] };
  }
  const card = p.accountType === 'credit';
  const inSum = txs.filter((t) => t.amount > 0).reduce((a, t) => a + t.amount, 0);
  const outSum = txs.filter((t) => t.amount < 0).reduce((a, t) => a - t.amount, 0);
  // 1. Opening + in − out = closing (cards: owed goes up with spending).
  if (p.openingBalance != null && p.closingBalance != null) {
    const open = p.openingBalance, close = p.closingBalance;
    const ok = Math.abs(open + inSum - outSum - close) <= 1;
    checks.push({ ok, text: card
      ? `Owed ${gbp(open)} + spent ${gbp(outSum)} − paid ${gbp(inSum)} = ${gbp(open + inSum - outSum)} ${ok ? '✓ matches the new balance' : `✗ the statement says ${gbp(close)}`}`
      : `Opening ${sgbp(open)} + in ${gbp(inSum)} − out ${gbp(outSum)} = ${sgbp(open + inSum - outSum)} ${ok ? '✓ matches the closing balance' : `✗ the statement says ${sgbp(close)} (${gbp(open + inSum - outSum - close)} out)`}` });
  } else {
    checks.push({ ok: null, text: 'No opening and closing balance on the statement to check the total against' });
  }
  // 2. Running balance on each row.
  let rows = 0, good = 0, prev = p.openingBalance;
  for (const t of txs) {
    if (t.balance != null && prev != null) { rows += 1; if (Math.abs(prev + t.amount - t.balance) <= 1) good += 1; }
    if (t.balance != null) prev = t.balance; else if (prev != null) prev += t.amount;
  }
  if (rows) checks.push({ ok: good === rows, text: `Running balance agrees on ${good} of ${rows} rows${good === rows ? ' ✓' : ''}` });
  // 3. Totals printed on the statement.
  const pr = p.printed || { in: [], out: [] };
  const matchIn = pr.in.find((v) => Math.abs(v - inSum) <= 1);
  const matchOut = pr.out.find((v) => Math.abs(v - outSum) <= 1);
  if (pr.in.length) checks.push({ ok: !!matchIn, text: matchIn ? `Money in ${gbp(inSum)} ✓ same as the statement's total` : `Money in ${gbp(inSum)}, statement total ${gbp(pr.in[0])}` });
  if (pr.out.length) checks.push({ ok: !!matchOut, text: matchOut ? `Money out ${gbp(outSum)} ✓ same as the statement's total` : `Money out ${gbp(outSum)}, statement total ${gbp(pr.out[0])}` });
  // 4. Dates inside the statement period.
  // Only when the statement gave a real date range (some only print the statement date).
  const spanDays = p.period?.start && p.period?.end ? (Date.parse(p.period.end) - Date.parse(p.period.start)) / 86400000 : 0;
  if (spanDays >= 20 && txs.length) {
    const outside = txs.filter((t) => t.date < p.period.start || t.date > p.period.end).length;
    // Allow a few days either side (posting vs transaction dates).
    checks.push({ ok: outside <= Math.max(1, Math.round(txs.length * 0.05)), text: outside ? `${outside} transaction${outside > 1 ? 's' : ''} dated outside ${p.period.start} – ${p.period.end}` : 'Every transaction is inside the statement period ✓' });
  }
  if (!txs.length) checks.push({ ok: false, text: 'No transactions found' });
  const decided = checks.filter((c) => c.ok !== null);
  const failed = decided.filter((c) => !c.ok);
  const strong = checks.some((c, i) => c.ok && (i === 0 || /total/.test(c.text)));
  const level = failed.length ? 'fail' : strong ? 'ok' : decided.length ? 'partial' : 'unchecked';
  const summary = { ok: 'Read correctly: the statement\'s own figures agree', partial: 'Partly checked: rows agree, but no totals to compare', fail: 'Something doesn\'t add up: check before importing', unchecked: 'Couldn\'t be checked: no balances or totals printed' }[level];
  return { level, summary, checks };
}
