// Text-based statement exports other than CSV: OFX/QFX (Money, Quicken, many UK banks),
// QIF, and Santander's "Date: … Description: … Amount: …" text file. Anything else is CSV.
import { parseCSVStatement } from './csv.js';
import { parseDate } from '../dates.js';
import { parseMoney } from '../money.js';

const pence = (v) => { const p = parseMoney(String(v || '').replace(/\s*GBP$/i, '')); return p ? (p.negative || p.debit ? -p.pence : p.pence) : null; };
const ofxDate = (v) => (/^\d{8}/.test(v || '') ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : null);

export function parseOFX(text) {
  const tag = (block, name) => (block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, 'i')) || [])[1]?.trim() || '';
  const transactions = [];
  for (const m of text.matchAll(/<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi)) {
    const b = m[1];
    const date = ofxDate(tag(b, 'DTPOSTED') || tag(b, 'DTUSER'));
    const amount = pence(tag(b, 'TRNAMT'));
    if (!date || !amount) continue;
    const name = tag(b, 'NAME') || tag(b, 'PAYEE');
    const memo = tag(b, 'MEMO');
    transactions.push({ date, description: [name, memo && !name.includes(memo) ? memo : ''].filter(Boolean).join(' ') || 'Unknown', amount, balance: null });
  }
  const led = text.match(/<LEDGERBAL>[\s\S]*?<BALAMT>([^<\r\n]+)/i);
  const isCard = /<CCSTMTRS>|<CREDITCARDMSGSRSV1>/i.test(text);
  // The bank's own ledger balance in the file is exact.
  return { transactions, closingBalance: led ? pence(led[1]) : null, balanceProven: !!led, accountType: isCard ? 'credit' : undefined, accountRef: (text.match(/<ACCTID>\s*\**(\d{4})\b/i) || text.match(/<ACCTID>[^<\r\n]*?(\d{4})\s*(?:<|\r?\n)/i) || [])[1], warnings: [] };
}

export function parseQIF(text) {
  const transactions = [];
  let cur = {};
  const isCard = /^!Type:CCard/im.test(text);
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('!')) continue;
    if (line === '^') {
      if (cur.date && cur.amount) transactions.push({ date: cur.date, description: [cur.payee, cur.memo].filter(Boolean).join(' ') || 'Unknown', amount: cur.amount, balance: null });
      cur = {};
      continue;
    }
    const k = line[0], v = line.slice(1).trim();
    if (k === 'D') cur.date = parseDate(v.replace(/'/g, '/'));
    else if (k === 'T' || k === 'U') cur.amount = pence(v);
    else if (k === 'P') cur.payee = v;
    else if (k === 'M') cur.memo = v;
  }
  return { transactions, closingBalance: null, accountType: isCard ? 'credit' : undefined, warnings: [] };
}

/** Santander's .txt export: blocks of "Date:", "Description:", "Amount:", "Balance:". */
export function parseKeyValueText(text) {
  const t = text.replace(/ /g, ' ');
  const transactions = [];
  let closingBalance = null, lastDate = null;
  for (const block of t.split(/\r?\n\s*\r?\n/)) {
    const get = (k) => (block.match(new RegExp(`^\\s*${k}\\s*[:：]\\s*(.+)$`, 'im')) || [])[1]?.trim();
    const date = parseDate(get('Date') || '');
    const amount = pence(get('Amount'));
    if (!date || !amount) continue;
    const balance = pence(get('Balance'));
    transactions.push({ date, description: get('Description') || 'Unknown', amount, balance });
    if (balance != null && (!lastDate || date >= lastDate)) { closingBalance = balance; lastDate = date; }
  }
  const ref = (t.match(/Account:\s*[X*\s\d]*?(\d{4})\s*$/im) || [])[1];
  return { transactions, closingBalance, accountRef: ref, warnings: [] };
}

export const isOFX = (text, name = '') => /\.(ofx|qfx)$/i.test(name) || /<OFX>|OFXHEADER/i.test(text.slice(0, 2000));
export const isQIF = (text, name = '') => /\.qif$/i.test(name) || /^!Type:/im.test(text.slice(0, 200));

/** Any text export: picks the right reader. */
export function parseTextStatement(text, name = '', opts = {}) {
  if (isOFX(text, name)) return { ...parseOFX(text), format: 'OFX' };
  if (isQIF(text, name)) return { ...parseQIF(text), format: 'QIF' };
  if (/^\s*Date\s*[:：]/im.test(text) && /^\s*Amount\s*[:：]/im.test(text)) return { ...parseKeyValueText(text), format: 'text' };
  return { ...parseCSVStatement(text, opts), format: 'CSV' };
}

/** Read bytes as text: UTF-8, or Windows-1252 for older exports (Nationwide's "£" would garble otherwise). */
export function decodeText(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1252').decode(buf); }
}
