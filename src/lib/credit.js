// Credit cards: what you owe, new spending on them, and a plan to get every card to £0.
import { monthKey, daysBetween, addMonths } from './dates.js';

const ISSUERS = /\b(AMEX|AMERICAN EXPRESS|BARCLAYCARD|CAPITAL ONE|MBNA|VANQUIS|AQUA|MARBLES|FLUID|NEWDAY|JOHN LEWIS PARTNERSHIP CARD|TESCO BANK|SAINSBURY'?S BANK|VIRGIN MONEY CREDIT|ZOPA CREDIT|CURVE|HSBC CREDIT|NATWEST CREDIT|LLOYDS CREDIT|HALIFAX CREDIT|SANTANDER CREDIT|M&S BANK|POST OFFICE MONEY|JAJA|TYMIT|CREDIT CARD)\b/i;
const CARD_TX = /\b(PAYMENT RECEIVED|THANK YOU|INTEREST CHARGED|PURCHASE INTEREST|MINIMUM PAYMENT|DIRECT DEBIT PAYMENT - THANK YOU|BALANCE TRANSFER|CASH ADVANCE)\b/i;

export const isCredit = (a) => a?.type === 'credit';

/** The bank name is a card issuer (Barclaycard, Amex, Capital One...). */
export const isCardIssuer = (text) => ISSUERS.test(String(text || ''));

/** Statement text that reads like a credit card statement. */
export function looksLikeCreditText(text) {
  const t = String(text);
  // Strong signs only a card statement has; small print ("statement balance", "interest rate", APR)
  // appears on current-account statements too, so it only counts alongside a strong sign.
  const strong = [/credit limit/i, /minimum (payment|repayment)/i, /available credit/i, /payment due (date|by)/i].filter((re) => re.test(t)).length;
  const weak = [/\bAPR\b/, /statement balance/i, /interest rates?/i].filter((re) => re.test(t)).length;
  if (/\b(current account|e-money account|account \(current account\))/i.test(t) && strong < 2) return false;
  return strong >= 2 || (strong >= 1 && (weak >= 1 || ISSUERS.test(t)));
}

/** Accounts that look like credit cards but are filed as current/savings. */
export function suspectedCreditCards(accounts, txs) {
  return accounts.filter((a) => {
    if (a.type === 'credit' || a.typeLocked) return false;
    if (ISSUERS.test(`${a.bank || ''} ${a.name || ''}`) || /\b(card|credit)\b/i.test(a.name || '')) return true;
    const mine = txs.filter((t) => t.accountId === a.id);
    if (!mine.length) return false;
    const cardish = mine.filter((t) => CARD_TX.test(t.description)).length;
    const credits = mine.filter((t) => t.amount > 0);
    // Card accounts: almost all money in is a single repayment per month, and no salary.
    return cardish >= 2 || (mine.length >= 10 && credits.length <= Math.ceil(mine.length / 15) && cardish >= 1);
  });
}

/** Money owed on a card, today (pence, positive = you owe). */
export function owedNow(account, txs) {
  if (account.balance == null) return null;
  const after = txs.filter((t) => t.accountId === account.id && account.balanceDate && t.date > account.balanceDate).reduce((a, t) => a + t.amount, 0);
  return Math.max(0, -(account.balance + after));
}

/**
 * Per-card summary and totals.
 * spent = purchases this month (money out, excluding refunds), paid = repayments in.
 */
export function cardSummary({ accounts, txs, allTxs = txs, today, trackFrom = null }) {
  // What's owed is the card's whole balance: every transaction on it, including ones before
  // you started tracking and other cardholders' purchases. Spending figures follow the view.
  const key = monthKey(today);
  const cards = accounts.filter(isCredit).map((a) => {
    const mine = txs.filter((t) => t.accountId === a.id && !['excluded'].includes(t.category));
    const month = mine.filter((t) => monthKey(t.date) === key);
    const purchases = mine.filter((t) => t.amount < 0 && t.category !== 'transfer' && t.category !== 'fees');
    const lastPurchase = purchases.map((t) => t.date).sort().pop() || null;
    const owed = owedNow(a, allTxs);
    // Owed at tracking start = today's balance with everything since then undone.
    let owedAtStart = null;
    if (owed != null && trackFrom) {
      const since = allTxs.filter((t) => t.accountId === a.id && t.date >= trackFrom).reduce((s, t) => s + t.amount, 0);
      owedAtStart = Math.max(0, owed + since);
    }
    const monthSpend = month.filter((t) => t.amount < 0 && t.category !== 'transfer').reduce((s, t) => s - t.amount, 0);
    const monthPaid = month.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const recentPurchases = purchases.filter((t) => monthKey(t.date) === key).sort((x, y) => y.date.localeCompare(x.date));
    return {
      account: a, owed, owedAtStart, apr: a.apr ?? null,
      monthSpend, monthPaid, lastPurchase,
      daysSinceSpend: lastPurchase ? daysBetween(lastPurchase, today) : null,
      recentPurchases,
      interestThisMonth: month.filter((t) => t.category === 'fees' && t.amount < 0).reduce((s, t) => s - t.amount, 0),
    };
  });
  const known = cards.filter((c) => c.owed != null);
  return {
    cards,
    totalOwed: known.reduce((s, c) => s + c.owed, 0),
    totalAtStart: known.every((c) => c.owedAtStart != null) ? known.reduce((s, c) => s + c.owedAtStart, 0) : null,
    unknownBalances: cards.filter((c) => c.owed == null).length,
    monthSpend: cards.reduce((s, c) => s + c.monthSpend, 0),
    monthPaid: cards.reduce((s, c) => s + c.monthPaid, 0),
    lastPurchase: cards.map((c) => c.lastPurchase).filter(Boolean).sort().pop() || null,
  };
}

/**
 * Month-by-month payoff. Every card gets its minimum (interest + 1%, at least £5);
 * everything else goes to the priority card: highest APR first (avalanche) or
 * smallest balance first (snowball). Returns months to £0, interest, and per-card payoff month.
 */
export function payoffPlan(cards, monthly, { method = 'avalanche', startMonth } = {}) {
  let debts = cards.filter((c) => c.owed > 0).map((c) => ({ id: c.account.id, name: c.account.name, owed: c.owed, apr: c.apr ?? 0.24 }));
  if (!debts.length) return { months: 0, interest: 0, payoff: [], feasible: true, debtFreeMonth: startMonth };
  const payoff = [];
  let interest = 0;
  for (let m = 1; m <= 600; m++) {
    let budget = monthly;
    for (const d of debts) {
      const i = Math.round(d.owed * (d.apr / 12));
      d.owed += i; interest += i;
    }
    const order = [...debts].sort((a, b) => (method === 'snowball' ? a.owed - b.owed : b.apr - a.apr || a.owed - b.owed));
    for (const d of debts) {
      const min = Math.min(d.owed, Math.max(500, Math.round(d.owed * (d.apr / 12)) + Math.round(d.owed * 0.01)));
      const pay = Math.min(min, budget);
      d.owed -= pay; budget -= pay;
    }
    for (const d of order) {
      if (budget <= 0) break;
      const pay = Math.min(d.owed, budget);
      d.owed -= pay; budget -= pay;
    }
    for (const d of debts.filter((x) => x.owed <= 0)) payoff.push({ id: d.id, name: d.name, month: m });
    debts = debts.filter((x) => x.owed > 0);
    if (!debts.length) return { months: m, interest, payoff, feasible: true, debtFreeMonth: startMonth ? addMonths(startMonth, m) : null };
    if (m === 3 && monthly <= debts.reduce((s, d) => s + Math.round(d.owed * (d.apr / 12)), 0)) break; // payment doesn't beat interest
  }
  return { months: null, interest, payoff, feasible: false, debtFreeMonth: null };
}
