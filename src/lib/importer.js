import { categorize, merchantKey } from './categorize.js';

function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * Turn parsed rows into stored transactions with stable ids, so importing the same
 * statement twice (or overlapping statements) never double counts.
 */
export function toTransactions(rows, { accountId, importId, source, userRules = {} }) {
  const seen = {};
  return rows.map((r) => {
    const merchant = merchantKey(r.description);
    const base = `${accountId}|${r.date}|${r.amount}|${merchant}`;
    seen[base] = (seen[base] || 0) + 1;
    return {
      id: hash(base + '|' + seen[base]),
      accountId,
      importId,
      source,
      date: r.date,
      description: r.description,
      merchant,
      amount: r.amount,
      balance: r.balance ?? null,
      category: categorize(r.description, r.amount, userRules),
    };
  });
}

/** Split incoming into new vs already-stored. */
export function dedupe(incoming, existingIds) {
  const fresh = [], dupes = [];
  for (const t of incoming) (existingIds.has(t.id) ? dupes : fresh).push(t);
  return { fresh, dupes };
}

export function guessBank(text) {
  const banks = ['Monzo', 'Starling', 'Revolut', 'Barclays', 'Barclaycard', 'Lloyds', 'Halifax', 'NatWest', 'RBS', 'HSBC', 'First Direct', 'Santander', 'Nationwide', 'TSB', 'Metro Bank', 'Co-operative Bank', 'Virgin Money', 'Chase', 'Kroo', 'Amex', 'American Express', 'Capital One', 'Tesco Bank', 'Chip', 'Marcus', 'Zopa', 'Tide', 'Wise'];
  const t = text.toLowerCase();
  return banks.find((b) => t.includes(b.toLowerCase())) || null;
}
