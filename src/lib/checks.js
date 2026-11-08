// Sense checks on every account: does what the app shows agree with the latest statement,
// is the balance out of date or missing, and do the numbers look plausible?
import { daysBetween } from './dates.js';

const gbp = (p) => `£${(Math.abs(p) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const sumBetween = (txs, id, from, to) => txs.filter((t) => t.accountId === id && (!from || t.date > from) && t.date <= to).reduce((a, t) => a + t.amount, 0);

/** Balance the app would show on a given date (null if it has none). */
export function balanceOn(account, txs, date) {
  if (account.balance == null || !account.balanceDate) return null;
  if (date >= account.balanceDate) return account.balance + sumBetween(txs, account.id, account.balanceDate, date);
  return account.balance - sumBetween(txs, account.id, date, account.balanceDate);
}

/**
 * @returns {Array<{accountId, level: 'bad'|'warn'|'info', title, detail, fix?: {action, amount, date}}>}
 */
export function accountChecks({ accounts, txs, today }) {
  const out = [];
  for (const a of accounts) {
    const mine = txs.filter((t) => t.accountId === a.id);
    const card = a.type === 'credit';
    const shown = (v) => (card ? -v : v); // owed is positive for cards
    const u = a.balanceUnverified;
    if (u && (!a.balanceDate || u.date >= a.balanceDate)) {
      const ours = balanceOn(a, txs, u.date);
      const turnover = mine.reduce((s, t) => s + Math.abs(t.amount), 0);
      const implausible = !card && Math.abs(u.amount) > 2000000 && Math.abs(u.amount) > turnover * 20;
      if (implausible) {
        out.push({ accountId: a.id, level: 'bad', title: 'Balance looks misread', detail: `${u.file || 'The latest statement'} seemed to show ${gbp(u.amount)}, far more than ever moves through this account, and it didn't add up, so it's ignored. Tap the account to enter the real balance.` });
      } else if (ours == null) {
        out.push({ accountId: a.id, level: 'warn', title: `${card ? 'Owed' : 'Balance'} not confirmed`, detail: `${u.file || 'The latest statement'} seems to say ${card ? 'you owe ' : ''}${gbp(u.amount)}, but its figures didn't add up, so it isn't used yet. Check it against the statement.`, fix: { amount: u.amount, date: u.date } });
      } else if (Math.abs(ours - u.amount) > 100) {
        out.push({ accountId: a.id, level: 'bad', title: `Doesn't match the latest statement`, detail: `${u.file || 'Latest statement'} says ${card ? 'you owe ' : ''}${gbp(u.amount)} on ${u.date}; the app works out ${gbp(shown(ours))} (${card ? (shown(ours) < -u.amount ? 'too low' : 'too high') : ours < u.amount ? 'too low' : 'too high'}). Usually interest, fees or a missing statement.`, fix: { amount: u.amount, date: u.date } });
      }
    }
    if (a.balance == null && !u && mine.length) out.push({ accountId: a.id, level: 'warn', title: card ? 'No amount owed yet' : 'No balance yet', detail: 'None of its statements showed a balance the app could confirm. Enter it from the bank app.' });
    if (a.balance != null && a.balanceDate) {
      const latestTx = mine.map((t) => t.date).sort().pop();
      const age = daysBetween(a.balanceDate, today);
      if (age > 45 && !(latestTx && latestTx > a.balanceDate)) out.push({ accountId: a.id, level: 'info', title: 'Balance may be out of date', detail: `Last confirmed ${age} days ago. Import the latest statement or update it.` });
      const now = balanceOn(a, txs, today);
      if (card && now > 5000) out.push({ accountId: a.id, level: 'warn', title: 'Card shows money in credit', detail: `The app works out you're ${gbp(now)} in credit. That's unusual: often a payment counted twice or a missing statement.` });
      if (!card && a.type !== 'savings' && now < -500000) out.push({ accountId: a.id, level: 'warn', title: 'Very overdrawn?', detail: `The app works out ${gbp(now)}. Check the balance on the latest statement.` });
      const turnover = mine.reduce((s, t) => s + Math.abs(t.amount), 0);
      if (!card && Math.abs(now) > 2000000 && Math.abs(now) > Math.max(turnover, 1) * 20) out.push({ accountId: a.id, level: 'bad', title: 'Balance looks wrong', detail: `${gbp(now)} is far more than ever moves through this account. If it's an investment, a deposit pot or not yours, don't count it; if the figure was misread, edit it.`, exclude: true });
    }
    const summaryLines = mine.filter((t) => t.fromSummary);
    if (summaryLines.length) out.push({ accountId: a.id, level: 'info', title: 'Interest/fees from the statement summary', detail: `${summaryLines.length} charge${summaryLines.length > 1 ? 's' : ''} (${gbp(summaryLines.reduce((s, t) => s - t.amount, 0))}) added from the summary box, because they weren't listed as transactions.` });
  }
  return out;
}
