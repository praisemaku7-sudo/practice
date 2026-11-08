// Mortgage maths for future planning (all money in pence, rates as annual %).
import { addMonths } from './dates.js';

/** Monthly repayment for a repayment mortgage (or interest-only). */
export function monthlyPayment(principal, ratePct, months, { interestOnly = false } = {}) {
  if (!principal || !months) return 0;
  const r = ratePct / 100 / 12;
  if (interestOnly) return Math.round(principal * r);
  if (!r) return Math.round(principal / months);
  return Math.round((principal * r) / (1 - Math.pow(1 + r, -months)));
}

/**
 * Month-by-month schedule. Fixed rate for `fixedYears`, then `followRate` (payment recalculated).
 * Overpayment is added to every payment (most UK lenders allow 10%/year without fees).
 */
export function schedule({ principal, rate, termYears, fixedYears = 0, followRate = null, interestOnly = false, overpay = 0, startMonth }) {
  const n = Math.round(termYears * 12);
  const fixM = Math.round((fixedYears || 0) * 12);
  let bal = principal, month = 0, interest = 0;
  let payment = monthlyPayment(principal, rate, n, { interestOnly });
  const rows = [];
  while (bal > 0 && month < n) {
    const ratePct = fixM && month >= fixM && followRate != null ? followRate : rate;
    if (fixM && month === fixM && followRate != null) payment = monthlyPayment(bal, followRate, n - month, { interestOnly });
    const i = Math.round(bal * (ratePct / 100 / 12));
    // The last payment clears whatever pennies rounding left over.
    let pay = month === n - 1 ? bal + i : Math.min(bal + i, payment + overpay);
    if (interestOnly) pay = Math.min(bal + i, i + overpay + (month === n - 1 ? bal : 0));
    bal = bal + i - pay;
    interest += i;
    rows.push({ month: startMonth ? addMonths(startMonth, month) : month + 1, payment: pay, interest: i, balance: Math.max(0, bal), rate: ratePct });
    month += 1;
  }
  return { rows, totalInterest: interest, months: rows.length, payment: monthlyPayment(principal, rate, n, { interestOnly }),
    afterFix: fixM && rows[fixM - 1] ? { balance: rows[fixM - 1].balance, payment: followRate != null ? monthlyPayment(rows[fixM - 1].balance, followRate, n - fixM, { interestOnly }) : null } : null };
}

/** Yearly summary of a schedule: balance at the end of each year and interest paid in it. */
export function byYear(rows) {
  const out = [];
  for (let i = 0; i < rows.length; i += 12) {
    const yr = rows.slice(i, i + 12);
    out.push({ year: out.length + 1, end: yr[yr.length - 1].month, balance: yr[yr.length - 1].balance, interest: yr.reduce((a, r) => a + r.interest, 0), paid: yr.reduce((a, r) => a + r.payment, 0) });
  }
  return out;
}

/**
 * Cash-flow projection: for each future month, income − everyday spending − housing.
 * Housing is today's rent until the mortgage starts, then the mortgage payment plus any new costs.
 */
export function projection({ fromMonth, months = 24, income, everydaySpend, rent, savings = 0, mortgage }) {
  const sched = mortgage?.principal ? schedule(mortgage) : null;
  const byMonth = new Map((sched?.rows || []).map((r) => [r.month, r]));
  const out = [];
  let cumulative = 0;
  for (let k = 0; k < months; k++) {
    const m = addMonths(fromMonth, k);
    const mort = byMonth.get(m);
    const started = mortgage?.startMonth && m >= mortgage.startMonth;
    const housing = started ? (mort?.payment || 0) + (mortgage.extraCosts || 0) : rent;
    const left = income - everydaySpend - housing - savings;
    cumulative += left;
    out.push({ month: m, income, everydaySpend, housing, mortgage: started, savings, left, cumulative });
  }
  return out;
}
