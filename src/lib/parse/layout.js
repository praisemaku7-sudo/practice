// Pure helpers for turning pdf.js lines into compact text, and checking a parse.

/**
 * Re-create each page as plain text with columns roughly preserved (spaces from x position).
 * This is what Claude reads: far fewer tokens than the PDF itself, so far faster.
 */
export function linesToPageTexts(lines, { charWidth = 4.5, maxCols = 140 } = {}) {
  const pages = new Map();
  for (const line of lines) {
    let out = '';
    for (const it of [...line.items].sort((a, b) => a.x - b.x)) {
      const col = Math.min(maxCols, Math.round(it.x / charWidth));
      if (out.length < col) out += ' '.repeat(col - out.length);
      else if (out.length && !out.endsWith(' ')) out += ' ';
      out += String(it.str).replace(/\s+/g, ' ').trim();
    }
    out = out.replace(/\s+$/, '');
    if (!out) continue;
    if (!pages.has(line.page)) pages.set(line.page, []);
    pages.get(line.page).push(out);
  }
  // Strip the common left margin so lines don't start with lots of spaces.
  return [...pages.keys()].sort((a, b) => a - b).map((p) => {
    const ls = pages.get(p);
    const margin = Math.min(...ls.map((l) => l.match(/^ */)[0].length));
    return ls.map((l) => l.slice(margin)).join('\n');
  });
}

/** Group page texts into chunks for parallel reading. */
export function chunkPages(pageTexts, { maxChars = 7000, maxChunks = 6 } = {}) {
  const total = pageTexts.reduce((a, p) => a + p.length, 0);
  const target = Math.max(maxChars, Math.ceil((total / maxChunks) * 1.15)); // headroom for page markers
  const chunks = [];
  let cur = { from: 1, to: 0, text: '' };
  pageTexts.forEach((t, i) => {
    if (cur.text && cur.text.length + t.length > target) { chunks.push(cur); cur = { from: i + 1, to: i, text: '' }; }
    cur.text += (cur.text ? '\n\n' : '') + `--- page ${i + 1} ---\n` + t;
    cur.to = i + 1;
  });
  if (cur.text) chunks.push(cur);
  return chunks;
}

/** Last 4 digits of the account / card number printed on a statement, if found. */
export function detectAccountRef(text) {
  const s = String(text);
  const patterns = [
    /account\s*(?:number|no\.?|#)?\s*[:\-]?\s*(?:\d{2}[- ]?\d{2}[- ]?\d{2}\s+)?(\d{8})\b/i,
    /\b\d{2}-\d{2}-\d{2}\s+(\d{8})\b/,
    /card\s*(?:number|no\.?|ending(?: in)?)\s*[:\-]?\s*(?:[x*•\d]{4}[\s-]?){0,3}(\d{4})\b/i,
    /ending\s+(?:in\s+)?(\d{4})\b/i,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return m[1].slice(-4);
  }
  return null;
}

/**
 * Do the amounts agree with the printed running balances / opening and closing balance?
 * If yes, the on-device read is trustworthy and we can skip the AI entirely.
 */
export function reconcile({ transactions, openingBalance = null, closingBalance = null }) {
  let checked = 0, ok = 0;
  let prev = openingBalance;
  for (const t of transactions) {
    if (t.balance != null && prev != null) {
      checked += 1;
      if (Math.abs(prev + t.amount - t.balance) <= 1) ok += 1;
    }
    if (t.balance != null) prev = t.balance;
    else if (prev != null) prev += t.amount;
  }
  const sum = transactions.reduce((a, t) => a + t.amount, 0);
  const totalsMatch = openingBalance != null && closingBalance != null ? Math.abs(openingBalance + sum - closingBalance) <= 1 : null;
  const ratio = checked ? ok / checked : null;
  const confident = transactions.length > 0 && (totalsMatch === true || (checked >= 3 && ratio >= 0.97 && totalsMatch !== false));
  return { checked, ok, ratio, totalsMatch, confident };
}
