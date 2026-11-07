// CSV statement import. Every UK bank app can export CSV, and it is more reliable than PDF.
import { parseDate } from '../dates.js';
import { parseMoney } from '../money.js';

export function parseCSVRows(text) {
  const s = text.replace(/^\uFEFF/, '');
  const first = s.split(/\r?\n/)[0] || '';
  const count = (ch) => first.split(ch).length - 1;
  const sep = [',', ';', '\t'].sort((x, y) => count(y) - count(x))[0];
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows.map((r) => r.map((f) => f.trim()));
}

const H = {
  date: /^(date|transaction date|posting date|posted date|completed date|started date|value date|booking date|trans date)$/i,
  desc: /^(description|name|merchant|narrative|details|transaction description|payee|counter ?party|transaction details|memo)$/i,
  ref: /^(reference|notes?|notes and #tags|memo|type|transaction type)$/i,
  amount: /^(amount|value|amount \(gbp\)|amount gbp|local amount|money in\/out|paid in\/out|£)$/i,
  out: /^(paid out|money out|debit|debits|debit amount|withdrawals?|out|spent|money out \(£\))$/i,
  in: /^(paid in|money in|credit|credits|credit amount|deposits?|in|received|money in \(£\))$/i,
  balance: /^(balance|running balance|balance \(gbp\))$/i,
  category: /^(category|spending category)$/i,
  account: /^(account name|account|account number)$/i,
};

export function parseCSVStatement(text, { fallbackYear = new Date().getFullYear() } = {}) {
  const rows = parseCSVRows(text);
  const headerIdx = rows.findIndex((r) => r.some((f) => H.date.test(f)) && r.some((f) => H.amount.test(f) || H.out.test(f) || H.in.test(f)));
  if (headerIdx < 0) return { transactions: [], warnings: ['Could not find a header row with Date and Amount columns.'] };
  const head = rows[headerIdx];
  const col = {};
  head.forEach((h, i) => {
    for (const [k, re] of Object.entries(H)) if (col[k] == null && re.test(h)) { col[k] = i; break; }
  });
  const transactions = [];
  let closingBalance = null;
  let lastDate = null;
  for (const r of rows.slice(headerIdx + 1)) {
    const date = parseDate(r[col.date] || '', fallbackYear);
    if (!date) continue;
    let amount = null;
    if (col.amount != null && r[col.amount]) {
      const p = parseMoney(r[col.amount]);
      if (p) amount = p.credit ? p.pence : p.debit || p.negative ? -p.pence : p.pence;
    } else {
      const o = parseMoney(r[col.out] || '');
      const i = parseMoney(r[col.in] || '');
      amount = (i ? i.pence : 0) - (o ? o.pence : 0);
    }
    if (!amount) continue;
    const description = [r[col.desc], col.desc == null ? r[col.ref] : null].filter(Boolean).join(' ').trim() || (r[col.ref] || 'Unknown');
    const bal = col.balance != null ? parseMoney(r[col.balance]) : null;
    const balance = bal ? (bal.negative || bal.debit ? -bal.pence : bal.pence) : null;
    if (balance != null && (!lastDate || date >= lastDate)) { closingBalance = balance; lastDate = date; }
    transactions.push({ date, description, amount, balance, bankCategory: col.category != null ? r[col.category] : undefined });
  }
  return { transactions, closingBalance, warnings: transactions.length ? [] : ['Header found but no rows parsed.'] };
}
