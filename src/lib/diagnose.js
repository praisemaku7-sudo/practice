// "Does this look right?": when spending looks far above income, find the usual culprits in the
// data itself: card repayments counted twice, money moving between you, huge categories, one-offs.
import { monthKey } from './dates.js';
import { catKind, catName } from './categories.js';
import { summarizeMonth } from './analysis.js';

const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : Math.round((s[n / 2 - 1] + s[n / 2]) / 2)) : 0; };
export { median };

/**
 * @returns {Array<{id, title, detail, monthly, action:{label, href}|null, txs}>} biggest first
 */
export function diagnoseSpending({ txs, accounts, months, people = [], income }) {
  const out = [];
  const n = Math.max(1, months.length);
  const inWin = txs.filter((t) => months.includes(monthKey(t.date)));
  const spendTx = inWin.filter((t) => t.amount < 0 && !['income', 'transfer', 'savings'].includes(catKind(t.category)));
  const credit = accounts.filter((a) => a.type === 'credit');

  // 1. Paying a credit card you've also imported: the purchases are already counted on the card.
  if (credit.length) {
    const cardWords = credit.flatMap((a) => [a.name, a.institution, a.bank].filter(Boolean)).map((s) => String(s).toUpperCase().split(/\s+/)[0]).filter((w) => w.length > 2);
    const re = new RegExp(`\\b(${[...new Set([...cardWords, 'AMEX', 'AMERICAN EXPRESS', 'BARCLAYCARD', 'CAPITAL ONE', 'AQUA', 'NEWDAY', 'VANQUIS', 'MBNA', 'TESCO BANK', 'JOHN LEWIS', 'MARBLES', 'FLUID', 'ZABLE'])].map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
    const pays = spendTx.filter((t) => t.category === 'debt' && !credit.some((a) => a.id === t.accountId) && re.test(t.description));
    const sum = pays.reduce((a, t) => a - t.amount, 0);
    if (sum > 5000 * n) out.push({ id: 'card-double', title: 'Card repayments may be counted twice', detail: `${pays.length} payments to your credit cards (${fmt0(sum / n)}/month) are counted as spending, but you've also imported the card statements, so what you bought on the card is already counted. Mark these as transfers.`, monthly: Math.round(sum / n), action: { label: 'Fix in Check my numbers', href: '#/audit' }, txs: pays });
  }

  // 2. Money between the two of you (or to your own accounts) not marked as a transfer.
  const names = people.map((p) => String(p.name || '').trim().split(/\s+/)[0].toUpperCase()).filter((w) => w.length > 2);
  if (names.length) {
    const re = new RegExp(`\\b(${names.join('|')})\\b`);
    const between = spendTx.filter((t) => re.test(String(t.description).toUpperCase()) && Math.abs(t.amount) >= 2000);
    const sum = between.reduce((a, t) => a - t.amount, 0);
    if (sum > 5000 * n) out.push({ id: 'between', title: 'Payments between you counted as spending', detail: `${between.length} payments that mention your names (${fmt0(sum / n)}/month). If they go to each other's accounts, they're not spending: mark them as transfers.`, monthly: Math.round(sum / n), action: { label: 'Review in Transactions', href: '#/transactions' }, txs: between });
  }
  // Same amount out of one account and into another within 3 days, not marked as a transfer.
  const ins = inWin.filter((t) => t.amount > 0 && catKind(t.category) !== 'transfer');
  const pairs = spendTx.filter((t) => Math.abs(t.amount) >= 5000 && ins.some((x) => x.accountId !== t.accountId && x.amount === -t.amount && Math.abs(Date.parse(x.date) - Date.parse(t.date)) <= 3 * 86400000));
  const pSum = pairs.reduce((a, t) => a - t.amount, 0);
  if (pSum > 5000 * n) out.push({ id: 'pairs', title: 'Money moved between your accounts', detail: `${pairs.length} payments match the same amount arriving in another of your accounts within 3 days (${fmt0(pSum / n)}/month). These are moves, not spending.`, monthly: Math.round(pSum / n), action: { label: 'Fix in Check my numbers', href: '#/audit' }, txs: pairs });

  // 3. Categories that are a huge share of income.
  const byCat = {};
  for (const t of spendTx) byCat[t.category] = (byCat[t.category] || 0) - t.amount;
  for (const [c, v] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
    const mo = v / n;
    if (c === 'housing' || !income || mo < income * 0.25) continue;
    out.push({ id: 'big-' + c, title: `${catName(c)}: ${fmt0(mo)} a month`, detail: `That's ${Math.round((mo / income) * 100)}% of income. If that's not right, some payments are in the wrong category (transfers, bills or one-offs).`, monthly: Math.round(mo), action: { label: 'See these payments', href: `#/transactions?cat=${c}` }, cat: c, txs: spendTx.filter((t) => t.category === c) });
  }

  // 4. One-off heavy months.
  const spends = months.map((m) => summarizeMonth(txs, m).spend);
  const med = median(spends);
  months.forEach((m, i) => {
    if (med && spends[i] > med * 1.5 && spends[i] - med > 50000) out.push({ id: 'oneoff-' + m, title: `${m}: ${fmt0(spends[i])} spent`, detail: `${fmt0(spends[i] - med)} more than a typical month. One-offs like this push the average up; the forecast now uses a typical month instead.`, monthly: 0, action: null, month: m, txs: [] });
  });
  return out.sort((a, b) => b.monthly - a.monthly);
}

function fmt0(p) { return `£${Math.round(p / 100).toLocaleString('en-GB')}`; }
