// Who and what a statement is for: bank (cross-checked against the sort code), product,
// account holder, postcode, sort code and the last 4 digits of the account number.
// Everything is read on the phone; nothing is sent anywhere.

// UK sort code ranges → bank. Exact codes first (digital banks share ranges), then 4- and 2-digit prefixes.
// The official directory (EISCD) is licensed, so branch names aren't available offline.
const SORT_EXACT = {
  '040004': 'Monzo', '040075': 'Revolut', '608371': 'Starling', '608464': 'Chase', '231470': 'Wise', '230580': 'Metro Bank',
  '040003': 'Kroo', '040605': 'Kroo', '608005': 'NatWest', '309950': 'Lloyds', '404784': 'First Direct', '402715': 'HSBC',
};
const SORT_PREFIX4 = { '4047': 'First Direct', '0400': 'e-money bank', '2314': 'Wise', '0700': 'Nationwide', '0701': 'Nationwide', '0702': 'Nationwide', '0703': 'Nationwide', '0704': 'Nationwide' };
const SORT_PREFIX2 = {
  '07': 'Nationwide', '20': 'Barclays', '30': 'Lloyds', '77': 'Lloyds', '87': 'TSB', '11': 'Halifax', '12': 'Bank of Scotland', '80': 'Bank of Scotland',
  '40': 'HSBC', '09': 'Santander', '72': 'Santander', '60': 'NatWest', '50': 'NatWest', '51': 'NatWest', '52': 'NatWest', '53': 'NatWest', '54': 'NatWest',
  '55': 'NatWest', '56': 'NatWest', '15': 'RBS', '16': 'RBS', '83': 'RBS', '08': 'Co-operative Bank', '05': 'Virgin Money', '82': 'Virgin Money', '18': 'Coutts',
};

export function bankFromSortCode(sortCode) {
  const d = String(sortCode || '').replace(/\D/g, '');
  if (d.length !== 6) return null;
  const hit = SORT_EXACT[d] || SORT_PREFIX4[d.slice(0, 4)] || SORT_PREFIX2[d.slice(0, 2)] || null;
  return hit === 'e-money bank' ? null : hit;
}

const BANKS = ['American Express', 'Amex', 'Barclaycard', 'Monzo', 'Starling', 'Revolut', 'Chase', 'Nationwide', 'First Direct', 'HSBC', 'Barclays', 'Lloyds', 'Halifax',
  'Bank of Scotland', 'NatWest', 'RBS', 'Royal Bank of Scotland', 'Santander', 'TSB', 'Metro Bank', 'Co-operative Bank', 'Virgin Money', 'Kroo', 'Chip', 'Marcus', 'Zopa',
  'Tesco Bank', 'Capital One', 'MBNA', 'Vanquis', 'Aqua', 'Wise', 'Tide', 'Coutts', 'Plum', 'Moneybox', 'Trading 212'];
const CANON = { Amex: 'American Express', 'Royal Bank of Scotland': 'RBS' };

// Sections that mention OTHER banks (how to pay us, payees) shouldn't decide whose statement it is.
const NOISE = /(how (you can|to) pay|please use account name|internet banking|chaps|international payment|pay(ing)? (us|by)|direct debit guarantee|financial services compensation|fscs)[^\n]*(\n[^\n]*){0,3}/gi;

/** The bank whose statement this is: the earliest bank name in the header, ignoring payment-instruction boxes. */
export function bankFromText(text) {
  const t = String(text || '').replace(NOISE, ' ');
  const head = t.slice(0, 2500);
  let best = null;
  for (const b of BANKS) {
    const re = new RegExp(`\\b${b.replace(/ /g, '\\s+')}\\b`, 'i');
    const m = head.match(re);
    if (m && (!best || m.index < best.index)) best = { name: CANON[b] || b, index: m.index };
  }
  return best?.name || null;
}

const PRODUCTS = [
  'FlexDirect', 'FlexAccount', 'FlexPlus', 'FlexBasic', 'FlexOne', 'FlexStudent', 'Flex Regular Saver', 'Loyalty Saver', 'Single Access ISA', 'Triple Access Online Saver',
  'Club Lloyds', 'Classic Account', 'Platinum Account', 'Silver Account', 'Gold Account', 'Premier Account', 'Advance Account', 'Bank Account', 'Current Account',
  'Reward Current Account', 'Select Account', 'Edge Account', '1|2|3 Account', 'Everyday Saver', 'Easy Access ISA', 'Easy Access Saver', 'Cash ISA', 'Lifetime ISA',
  'Instant Access Saver', 'Regular Saver', 'Joint Account', 'Personal Account', 'Business Account',
  'Preferred Rewards Gold Credit Card', 'Platinum Cashback Credit Card', 'Platinum Cashback Everyday Credit Card', 'Platinum Card', 'Gold Card', 'Rewards Credit Card',
  'Nectar Credit Card', 'British Airways American Express', 'Marriott Bonvoy', 'Avios Plus', 'Clubcard Plus', 'Credit Card',
];

/** A person's name: letters only, 2+ words, no digits or month names. */
const looksLikeName = (v) => !!v && /^[A-Za-z][A-Za-z' .-]+$/.test(v.trim()) && v.trim().split(/\s+/).length >= 2
  && !/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\bstatement\b|\bbalance\b/i.test(v);

/** Text on the line under a label, at the same column (statements often print values below their labels). */
function valueBelow(lines, labelRe) {
  for (let i = 0; i < lines.length - 1; i++) {
    const m = lines[i].match(labelRe);
    if (!m) continue;
    // Value on the same line: stop at the next label ("Membership Number", "Sort code"...).
    const sameLine = lines[i].slice(m.index + m[0].length).replace(/^[\s:]+/, '')
      .split(/\s{2,}|\b(?:membership|account|card|sort|date|number|page|statement)\b/i)[0].trim();
    if (looksLikeName(sameLine)) return sameLine;
    const below = lines[i + 1];
    const col = m.index;
    const seg = (below.slice(Math.max(0, col - 2)).match(/^\s*([^\s].*?)(\s{2,}|$)/) || [])[1];
    if (seg && looksLikeName(seg)) return seg.trim();
  }
  return null;
}

const titleCase = (s) => s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\bMac([a-z])/g, (_, c) => `Mac${c.toUpperCase()}`).replace(/\bMc([a-z])/g, (_, c) => `Mc${c.toUpperCase()}`);

/**
 * @param {string} text  statement text (layout-preserving, as from linesToPageTexts)
 * @returns {{ bank, bankFromSort, bankMismatch, sortCode, last4, holder, postcode, product }}
 */
export function extractDetails(text, fileName = '') {
  const t = String(text || '');
  const clean = t.replace(NOISE, ' ');
  const lines = clean.split('\n');
  const sc = clean.match(/sort\s*code[^\d\n]{0,20}(\d{2})[\s-](\d{2})[\s-](\d{2})/i) || clean.match(/\b(\d{2})-(\d{2})-(\d{2})\s+\d{8}\b/);
  const sortCode = sc ? `${sc[1]}-${sc[2]}-${sc[3]}` : null;
  const acct = clean.match(/account\s*(?:number|no\.?)[^\d\n]{0,25}(\d{8})\b/i) || clean.match(/\b\d{2}-\d{2}-\d{2}\s+(\d{8})\b/);
  const card = clean.match(/(?:membership|card)\s*(?:number|no\.?)[\s\S]{0,120}?(?:x{2,}|\*{2,}|•{2,})[-\s]?x*[-\s]?\*?(\d{4,5})\b/i);
  const last4 = (acct?.[1] || card?.[1] || '').slice(-4) || null;
  const HOLDER = /(prepared for|account name|account holder|name of account holder|cardholder name|statement for)\b/i;
  let holder = valueBelow(lines, HOLDER);
  let holderLine = lines.findIndex((l) => HOLDER.test(l));
  if (!holder) {
    const m = clean.match(/^\s*((?:MR|MRS|MS|MISS|DR|MX)\.?\s+[A-Z][A-Z' .-]{2,40}?)(?:\s{2,}|$)/m);
    holder = m ? m[1] : null;
    holderLine = m ? lines.findIndex((l) => l.includes(m[1])) : -1;
  }
  if (holder) holder = titleCase(holder.replace(/\s+/g, ' ').replace(/\b(MR|MRS|MS|MISS|DR|MX)\b\.?/i, (x) => x.toUpperCase()).trim());
  // The holder's postcode is printed just under their name (the first postcode is often the bank's own office).
  const near = holderLine >= 0 ? lines.slice(holderLine, holderLine + 8).join('\n') : '';
  const pc = near.match(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/);
  const product = PRODUCTS.find((p) => new RegExp(`\\b${p.replace(/[|]/g, '\\|').replace(/ /g, '\\s+')}\\b`, 'i').test(clean.slice(0, 4000))) || null;
  let bankText = bankFromText(t) || bankFromText(fileName.replace(/[_-]+/g, ' '));
  const bankSort = bankFromSortCode(sortCode);
  // A transaction mentioning another bank ("To Revolut") can appear before the issuer's own name.
  // If the sort code's bank is also named on the statement, it's that bank's statement.
  if (bankSort && bankText && bankSort !== bankText && new RegExp(`\\b${bankSort.replace(/ /g, '\\s+')}\\b`, 'i').test(clean)) bankText = bankSort;
  // A product name tells you the bank too (FlexAccount is Nationwide, Club Lloyds is Lloyds…).
  const PRODUCT_BANK = { Flex: 'Nationwide', 'Club Lloyds': 'Lloyds', 'Preferred Rewards': 'American Express', 'Platinum Card': 'American Express' };
  const pb = Object.entries(PRODUCT_BANK).find(([k]) => new RegExp(`\\b${k}`, 'i').test(clean.slice(0, 4000)));
  if (pb && bankSort === pb[1]) bankText = pb[1];
  return {
    bank: bankText || bankSort || null,
    bankFromSort: bankSort,
    bankMismatch: !!(bankSort && bankText && bankSort !== bankText && !(bankSort === 'Lloyds' && /Halifax|Bank of Scotland/.test(bankText)) && !(bankSort === 'NatWest' && /RBS|Coutts/.test(bankText))),
    sortCode, last4, holder, postcode: pc ? `${pc[1]} ${pc[2]}` : null, product,
  };
}

/** A clear account name: "Nationwide FlexDirect ••1234", "American Express Preferred Rewards Gold ••1009". */
export function suggestAccountName(d, type) {
  const bank = d.bank || d.bankFromSort;
  if (!bank) return null;
  let product = d.product ? d.product.replace(/\b(Credit Card|Account)$/i, '').trim() : '';
  if (product && bank && new RegExp(bank, 'i').test(product)) product = product.replace(new RegExp(bank, 'i'), '').trim();
  const kind = product || (type === 'credit' ? 'Card' : type === 'savings' ? 'Savings' : 'Current');
  return `${bank} ${kind}${d.last4 ? ` ••${d.last4}` : ''}`.replace(/\s+/g, ' ').trim();
}
