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

// European-style numbers ("2.603,40", "-4,50") in semicolon files.
const euro = (v) => (/^[-+]?£?\s*\d{1,3}(\.\d{3})*,\d{2}$/.test(String(v).trim()) ? String(v).replace(/\./g, '').replace(',', '.') : v);
const money = (v, eu) => parseMoney(eu ? euro(v) : v);

/** No header row (HSBC, First Direct): work out the columns from the data itself. */
function guessColumns(rows, fallbackYear) {
  const data = rows.filter((r) => r.length >= 3).slice(0, 50);
  if (data.length < 2) return null;
  const share = (i, test) => data.filter((r) => r[i] != null && test(r[i])).length / data.length;
  const width = Math.max(...data.map((r) => r.length));
  const cols = [...Array(width).keys()];
  const date = cols.find((i) => share(i, (v) => !!parseDate(v, fallbackYear)) >= 0.8);
  if (date == null) return null;
  const isMoney = (v) => /\d\.\d{2}\b|^-?\d+$/.test(v) && !!parseMoney(v) && !parseDate(v, fallbackYear);
  const money = cols.filter((i) => i !== date && share(i, isMoney) >= 0.8);
  if (!money.length) return null;
  const desc = cols.filter((i) => i !== date && !money.includes(i)).sort((a, b) => share(b, (v) => /[a-z]{3}/i.test(v)) - share(a, (v) => /[a-z]{3}/i.test(v)))[0];
  // One money column = the amount; two = amount then balance.
  return { date, desc, amount: money[0], balance: money.length > 1 ? money[money.length - 1] : undefined };
}

const SKIP_STATE = /^(reverted|declined|failed|pending|cancelled|canceled)$/i;

export function parseCSVStatement(text, { fallbackYear = new Date().getFullYear() } = {}) {
  const rows = parseCSVRows(text);
  const eu = /;/.test(text.split(/\r?\n/)[0] || '') && rows.slice(1, 20).some((r) => r.some((f) => /^[-+]?\d{1,3}(\.\d{3})*,\d{2}$/.test(f)));
  const headerIdx = rows.findIndex((r) => r.some((f) => H.date.test(f)) && r.some((f) => H.amount.test(f) || H.out.test(f) || H.in.test(f)));
  let col = {};
  let body;
  if (headerIdx < 0) {
    const g = guessColumns(rows, fallbackYear);
    if (!g) return { transactions: [], warnings: ['Could not find a header row with Date and Amount columns.'] };
    col = g; body = rows;
  } else {
    rows[headerIdx].forEach((h, i) => {
      for (const [k, re] of Object.entries(H)) if (col[k] == null && re.test(h)) { col[k] = i; break; }
    });
    rows[headerIdx].forEach((h, i) => { if (/^state$/i.test(h)) col.state = i; if (/^fees?$/i.test(h)) col.fee = i; });
    body = rows.slice(headerIdx + 1);
  }
  const transactions = [];
  let closingBalance = null;
  let lastDate = null;
  for (const r of body) {
    const date = parseDate(r[col.date] || '', fallbackYear);
    if (!date) continue;
    if (col.state != null && SKIP_STATE.test(r[col.state] || '')) continue; // Revolut: reverted/declined/pending
    let amount = null;
    if (col.amount != null && r[col.amount]) {
      const p = money(r[col.amount], eu);
      if (p) amount = p.credit ? p.pence : p.debit || p.negative ? -p.pence : p.pence;
      const fee = col.fee != null ? money(r[col.fee] || '', eu) : null;
      if (amount != null && fee?.pence) amount -= fee.pence; // Revolut: fees are charged on top
    } else {
      const o = money(r[col.out] || '', eu);
      const i = money(r[col.in] || '', eu);
      amount = (i ? i.pence : 0) - (o ? o.pence : 0);
    }
    if (!amount) continue;
    const description = [r[col.desc], col.desc == null ? r[col.ref] : null].filter(Boolean).join(' ').trim() || (r[col.ref] || 'Unknown');
    const bal = col.balance != null ? money(r[col.balance] || '', eu) : null;
    const balance = bal ? (bal.negative || bal.debit ? -bal.pence : bal.pence) : null;
    if (balance != null && (!lastDate || date >= lastDate)) { closingBalance = balance; lastDate = date; }
    transactions.push({ date, description, amount, balance, bankCategory: col.category != null ? r[col.category] : undefined });
  }
  // Card exports (Amex, Barclaycard…) list purchases as positive and payments as negative: turn them round.
  if (col.amount != null && col.balance == null && transactions.length >= 2) {
    const pay = /\b(PAYMENT RECEIVED|THANK YOU|DIRECT DEBIT PAYMENT|PAYMENT - THANK)\b/i;
    const pays = transactions.filter((t) => pay.test(t.description));
    const rest = transactions.filter((t) => !pay.test(t.description));
    if (pays.length && pays.every((t) => t.amount < 0) && rest.filter((t) => t.amount > 0).length > rest.length / 2) {
      for (const t of transactions) t.amount = -t.amount;
    }
  }
  return { transactions, closingBalance, warnings: transactions.length ? [] : ['Header found but no rows parsed.'] };
}
