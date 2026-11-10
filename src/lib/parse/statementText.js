// Turns positioned text lines (from pdf.js) into transactions.
// Works on most UK current-account and credit-card PDF statements:
//   Date | Description | Paid out | Paid in | Balance      (Barclays, Lloyds, Halifax, NatWest, HSBC, Santander...)
//   Date | Description | Amount (signed)                   (Monzo, Starling, Revolut)
//   Date | Date | Description | Amount [CR]               (credit cards)

import { matchLeadingDate, findNamedDates, iso, monthIndex } from '../dates.js';
import { parseMoney, AMOUNT_TOKEN } from '../money.js';
import { isSummaryLine, CLOSING_LINE, OPENING_LINE } from './junk.js';
import { linesToPageTexts } from './layout.js';
import { cardSummaryFields, applyCardSummary } from './cardSummary.js';
import { looksLikeCreditText } from '../credit.js';

// The amount that belongs to a summary label: the first one after it, before the next label
// ("New balance £381.12  Minimum payment £25.00" is £381.12, not £25).
const NEXT_LABEL = /\b(minimum|min\.?|credit limit|available|payment due|due date|interest|apr|estimated|total|paid (in|out)|money (in|out))\b/i;
/** "£8.53 D" / "8.53 DR" / "8.53 OD": the balance is overdrawn. */
function overdrawnAfter(text, amount) {
  if (!amount) return false;
  const i = text.indexOf(amount);
  return i >= 0 && /^\s*(D|DR|OD)\b/i.test(text.slice(i + amount.length));
}
function amountAfter(text, labelRe, toks) {
  const m = text.match(labelRe);
  if (m) {
    let rest = text.slice(m.index + m[0].length);
    const n = rest.match(NEXT_LABEL);
    if (n) rest = rest.slice(0, n.index);
    const a = rest.split(/\s+/).find((w) => AMOUNT_TOKEN.test(w));
    if (a) return a;
  }
  const amts = toks.filter((t) => AMOUNT_TOKEN.test(t.t));
  return amts.length ? amts[amts.length - 1].t : null;
}

const DESC_HEAD = /^(payment type( and details)?|payment details|transaction (details|description|type)|description|details|narrative|particulars|merchant)$/i;
const OUT_HEAD = /^(paid out|money out|out|withdrawn|withdrawals?|debits?|debit amount|payments?|spent|money out \(£\))$/i;
const IN_HEAD = /^(paid in|money in|in|deposits?|credits?|credit amount|received|money in \(£\))$/i;
const BAL_HEAD = /^(balance|running balance|balance \(£\)|£ ?balance)$/i;
const AMT_HEAD = /^(amount|amount \(£\)|amount £|amount gbp|value|£|gbp)$/i;
const SKIP = /\b(balance (brought|carried) forward|brought forward|carried forward|opening balance|closing balance|start balance|end balance|total (paid|money|payments|debits|credits|in|out)|totals?$|page \d+|statement (date|period|number)|sort code|account number|iban|bic|continued)\b/i;
const INCOME_HINT = /\b(SALARY|WAGES|PAYROLL|REFUND|HMRC|DWP|INTEREST (PAID|EARNED)|CREDIT|RECEIVED|FROM|DEPOSIT|PAYMENT RECEIVED|THANK YOU)\b/i;

/**
 * Split pdf.js items into word tokens with an estimated x position, so that
 * "12 Oct TESCO 4.50" in a single item still yields separate tokens.
 */
export function tokenize(items) {
  const toks = [];
  for (const it of items) {
    const str = String(it.str);
    if (!str.trim()) continue;
    const w = it.w || str.length * 5;
    const per = w / Math.max(str.length, 1);
    const re = /\S+/g;
    let m;
    while ((m = re.exec(str))) toks.push({ t: m[0], x: it.x + m.index * per, w: m[0].length * per });
  }
  return toks.sort((a, b) => a.x - b.x);
}

function lineText(toks) { return toks.map((t) => t.t).join(' '); }

/** Column header x positions (right edges work best for right-aligned numbers) from one line, or null. */
function headerCols(line) {
  const toks = tokenize(line.items);
  // Letter-spaced headings ("Pay m e nt t y pe", "Paid o ut") are joined back up first.
  const text = lineText(toks).toLowerCase().replace(/\b(\w) (?=\w\b)/g, '$1');
  if (!/date/.test(text) || !/(balance|paid|money|amount|debit|credit|withdraw|deposit|out|in)/.test(text)) return null;
  if (toks.some((t) => AMOUNT_TOKEN.test(t.t))) return null; // a real header row has no amounts in it
  // Find header phrases by trying the longest run of words that names a column, so headings
  // printed close together ("Type Money In (£) Money Out (£)") are still told apart.
  const norm = (str) => str.toLowerCase().replace(/[:]/g, '').replace(/\(?\s*(£|gbp)\s*\)?/g, ' ').replace(/\b(\w) (?=\w\b)/g, '$1').replace(/\s+/g, ' ').trim();
  const cols = {};
  for (let i = 0; i < toks.length; i++) {
    for (let len = Math.min(4, toks.length - i); len >= 1; len--) {
      const run = toks.slice(i, i + len);
      // A "£" at the end belongs to the next column's heading ("£ Paid out  £ Paid in").
      if (len > 1 && /^\(?(£|gbp)\)?$/i.test(run[run.length - 1].t)) continue;
      const label = norm(run.map((t) => t.t).join(' '));
      if (!label) continue;
      const right = run[run.length - 1].x + run[run.length - 1].w;
      const role = DESC_HEAD.test(label) ? 'desc' : OUT_HEAD.test(label) ? 'out' : IN_HEAD.test(label) ? 'in' : BAL_HEAD.test(label) ? 'bal' : AMT_HEAD.test(label) ? 'amt' : null;
      if (role === 'desc') { i += len - 1; break; }
      if (role && cols[role] == null) { cols[role] = right; i += len - 1; break; }
    }
  }
  const roles = Object.keys(cols).length;
  return (cols.out != null || cols.in != null || cols.amt != null) && (roles >= 2 || cols.amt != null) ? cols : null;
}

/** The first header row's columns (used for the "were headers found" warning). */
function detectColumns(lines) {
  for (const line of lines) { const c = headerCols(line); if (c) return c; }
  return null;
}

/** "Statement period from 11 August to 10 September 2026", "9 September to 8 October 2026", "1 Jun 2026 - 9 Nov 2026". */
export function statedPeriod(text) {
  const M = '(\\d{1,2})(?:st|nd|rd|th)?\\s+([A-Za-z]{3,9})\\.?';
  const re = new RegExp(`${M}(?:,?\\s+(\\d{4}))?\\s*(?:to|until|-|–|—)\\s*${M},?\\s+(\\d{4})`, 'gi');
  const found = [];
  let m;
  while ((m = re.exec(text))) {
    const sm = monthIndex(m[2]), em = monthIndex(m[5]);
    if (!sm || !em) continue;
    const ey = +m[6], sy = m[3] ? +m[3] : sm > em ? ey - 1 : ey;
    const start = `${sy}-${String(sm).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`, end = `${ey}-${String(em).padStart(2, '0')}-${String(+m[4]).padStart(2, '0')}`;
    const days = (new Date(end) - new Date(start)) / 864e5;
    if (days < 6 || days > 400) continue;
    // Prefer one labelled as the statement period.
    found.push({ start, end, label: text.slice(Math.max(0, m.index - 40), m.index) });
  }
  // A labelled statement period wins; a statement made of monthly sections spans all of them.
  const lab = found.find((f) => /statement period/i.test(f.label || '')) || null;
  if (lab) return lab;
  if (!found.length) return null;
  return { start: found.map((f) => f.start).sort()[0], end: found.map((f) => f.end).sort().at(-1) };
}

function inferPeriod(fullText, fallbackYear) {
  const stated = statedPeriod(fullText);
  if (stated) return { start: stated.start, end: stated.end, year: +stated.end.slice(0, 4) };
  const dates = findNamedDates(fullText).sort();
  const years = dates.map((d) => +d.slice(0, 4));
  const counts = {};
  for (const y of years) counts[y] = (counts[y] || 0) + 1;
  const common = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return {
    start: dates[0] || null,
    end: dates[dates.length - 1] || null,
    year: common ? +common[0] : fallbackYear,
  };
}

const near = (a, b) => Math.abs(a - b) <= 1;
const FX_CODE = /^(EUR|USD|TRY|AUD|CAD|CHF|JPY|CNY|HKD|SGD|NZD|SEK|NOK|DKK|PLN|CZK|HUF|RON|BGN|ISK|AED|SAR|QAR|INR|PKR|NGN|GHS|KES|ZAR|THB|MYR|IDR|PHP|VND|KRW|MXN|BRL|ARS|EGP|MAD|ILS)$/;
const FX_LINE = /\b(revolut rate|ecb rate|exchange rate|conversion rate|rate £1(\.00)? =|non-sterling transaction fee)\b/i;
const TYPE_START = /^(CR|DR|BP|DD|SO|VIS|\)\)\)|ATM|OBP|TFR|CHQ|FPI|FPO|BGC|DEB|STO|IBP|CPT|DPC|PAY)\s+\S/;
const PAGE_HEAD = /\b(your statement|account name|sort ?code|sheet number|statement period|page \d+ of \d+)\b|^\d{1,2}(st|nd|rd|th)? [a-z]+( \d{4})? to \d{1,2}(st|nd|rd|th)? [a-z]+ \d{4}\b/i;

const CREDIT_WORDS = /\b(BENEFIT|CREDIT|REFUND|CASHBACK|POINTS TOWARDS|REWARD|REVERSAL|ADJUSTMENT)\b/i;
const MONEY = '£?\\s*([\\d,]+\\.\\d{2})';

/** Parse a credit-card summary box: previous balance, credits, debits, closing balance (pence). */
export function cardSummaryBox(text) {
  const re = new RegExp(`previous[^\\n]{0,30}balance[^\\n]*credits?[^\\n]*debits?[^\\n]*balance[^\\n]*\\n[^\\d£]*${MONEY}\\s*[-–]\\s*${MONEY}\\s*\\+\\s*${MONEY}\\s*=\\s*${MONEY}`, 'i');
  const m = String(text).match(re);
  if (!m) return null;
  const p = (v) => Math.round(parseFloat(v.replace(/,/g, '')) * 100);
  const box = { previous: p(m[1]), credits: p(m[2]), debits: p(m[3]), closing: p(m[4]) };
  return box.previous - box.credits + box.debits === box.closing ? box : null;
}

/**
 * @param {Array<{page:number,y:number,items:Array<{x:number,w:number,str:string}>}>} lines
 * @param {{fallbackYear?: number}} opts
 * @returns {{transactions: Array, closingBalance: number|null, period: object, warnings: string[]}}
 */
export function parseStatementLines(lines, { fallbackYear = new Date().getFullYear() } = {}) {
  const fullText = lines.map((l) => lineText(tokenize(l.items))).join('\n');
  const period = inferPeriod(fullText, fallbackYear);
  let cols = detectColumns(lines);
  const foundCols = !!cols;
  const warnings = [];
  const raw = [];
  let currentDate = null;
  let pending = null; // a dated line with description but no amount yet
  let openingBalance = null;
  let closingBalance = null;
  let lastMonth = null;
  let yearOffset = 0;
  let lastWasTx = false;
  let holderFrom = 0; // index of the first row not yet assigned to a cardholder

  const resolveDate = (r) => {
    let y = r.y;
    if (y == null) {
      // Statement with "12 Oct" dates: anchor on period end year, handle Dec -> Jan rollover.
      const baseYear = period.start ? +period.start.slice(0, 4) : period.year;
      if (lastMonth != null && r.m < lastMonth && lastMonth - r.m > 6) yearOffset += 1;
      y = baseYear + yearOffset;
      lastMonth = r.m;
    }
    return iso(y, r.m, r.d);
  };

  for (const line of lines) {
    let toks = tokenize(line.items);
    if (!toks.length) continue;
    const text = lineText(toks);
    // Columns can move from page to page (HSBC): re-read them at every header row.
    const hc = headerCols(line);
    if (hc) { cols = hc; pending = null; lastWasTx = false; continue; }
    // The header block repeated at the top of each page is never part of a transaction.
    if (PAGE_HEAD.test(text)) { pending = null; lastWasTx = false; continue; }

    if (SKIP.test(text) || isSummaryLine(text)) {
      lastWasTx = false;
      const amts = toks.filter((t) => AMOUNT_TOKEN.test(t.t));
      if (amts.length && OPENING_LINE.test(text) && openingBalance == null) {
        const a = amountAfter(text, OPENING_LINE, toks);
        const p = parseMoney(a);
        openingBalance = p.negative || p.debit || overdrawnAfter(text, a) ? -p.pence : p.pence;
      }
      if (amts.length && CLOSING_LINE.test(text)) {
        const a = amountAfter(text, CLOSING_LINE, toks);
        const p = parseMoney(a);
        closingBalance = p.negative || p.debit || overdrawnAfter(text, a) ? -p.pence : p.pence;
      }
      continue;
    }

    // Leading date (possibly two dates on credit cards: transaction date + posting date).
    let dateMatch = matchLeadingDate(text);
    let consumed = 0;
    if (dateMatch) {
      currentDate = resolveDate(dateMatch);
      consumed = dateMatch.length;
      const rest = text.slice(consumed).trimStart();
      const second = matchLeadingDate(rest);
      if (second) consumed = text.length - rest.length + second.length;
      // Drop the tokens that made up the date(s).
      let chars = 0;
      toks = toks.filter((t) => { const keep = chars >= consumed; chars += t.t.length + 1; return keep; });
    }

    // Foreign-currency details ("Revolut Rate £1.00 = 64.39 TRY … 2,561.00 TRY", "€25.00") are
    // never the sterling amount: drop those figures (and exchange-rate lines) so they aren't counted.
    const fx = FX_LINE.test(text);
    const amountToks = toks.filter((t, i) => AMOUNT_TOKEN.test(t.t) && !fx && !FX_CODE.test(toks[i + 1]?.t || '') && !FX_CODE.test(toks[i - 1]?.t || '') && !/^[€$¥₺]/.test(t.t));
    const descToks = toks.filter((t) => !AMOUNT_TOKEN.test(t.t) && !/^(£|GBP|CR|DR)$/i.test(t.t));
    const desc = lineText(descToks).trim();

    // "CR" / "DR" printed on its own line under the amount (American Express).
    if (!amountToks.length && !dateMatch && /^(CR|DR)$/i.test(text.trim()) && lastWasTx) {
      raw[raw.length - 1].suffix = text.trim().toUpperCase();
      continue;
    }
    // Lines starting with "Total" are subtotals, never transactions.
    if (!dateMatch && /^total\b/i.test(text.trim())) {
      // "Total new spend transactions for JANE SMITH": everything since the last total was hers.
      const holder = text.match(/transactions\s+for\s+([A-Z][A-Z' .-]+?)(?:\s+[\d£-]|$)/i);
      if (holder) {
        const name = holder[1].replace(/\s+/g, ' ').trim();
        for (let i = holderFrom; i < raw.length; i++) if (!raw[i].holder) raw[i].holder = name;
      }
      holderFrom = raw.length;
      lastWasTx = false; pending = null; continue;
    }
    if (!amountToks.length) {
      // A line that starts with a payment-type code (HSBC: "CR Sarah Smith", "BP Landlord", "VIS
      // Shop") begins a new transaction whose amount is on the next line, even with no date.
      if (!dateMatch && currentDate && desc && TYPE_START.test(text.trim())) {
        pending = { date: currentDate, desc }; lastWasTx = false; continue;
      }
      if (dateMatch && desc) {
        pending = { date: currentDate, desc };
      } else if (pending && desc && desc.length < 80) {
        pending.desc += ' ' + desc;
      } else if (lastWasTx && desc && desc.length < 60 && !/\d{5,}/.test(desc)) {
        // Second line of the previous transaction (e.g. merchant location / reference).
        raw[raw.length - 1].desc += ' ' + desc;
      }
      lastWasTx = false;
      continue;
    }
    if (!currentDate) continue; // amounts before any dated row are summary boxes

    const description = (pending && !dateMatch ? pending.desc + ' ' + desc : desc).trim()
      || (pending ? pending.desc : '');
    pending = null;
    if (!description) continue;

    const entry = { date: currentDate, desc: description, out: null, in: null, amt: null, bal: null };
    const right = (t) => t.x + t.w;

    if (cols && (cols.out != null || cols.in != null || cols.bal != null)) {
      for (const t of amountToks) {
        const candidates = [['out', cols.out], ['in', cols.in], ['bal', cols.bal], ['amt', cols.amt]].filter(([, x]) => x != null);
        candidates.sort((a, b) => Math.abs(right(t) - a[1]) - Math.abs(right(t) - b[1]));
        const role = candidates[0][0];
        const p = parseMoney(t.t);
        if (role === 'bal') entry.bal = p.negative || p.debit || /^(D|DR|OD)$/i.test(toks[toks.indexOf(t) + 1]?.t || '') ? -p.pence : p.pence;
        else if (role === 'amt') entry.amt = p;
        else entry[role] = p.pence;
      }
    } else if (amountToks.length >= 2) {
      const balTok = amountToks[amountToks.length - 1];
      const bp = parseMoney(balTok.t);
      entry.bal = bp.negative || bp.debit ? -bp.pence : bp.pence;
      entry.amt = parseMoney(amountToks[amountToks.length - 2].t);
    } else {
      entry.amt = parseMoney(amountToks[0].t);
    }
    raw.push(entry);
    lastWasTx = true;
  }

  // Decide signs.
  const anyNegative = raw.some((e) => e.amt && e.amt.negative);
  let prevBal = openingBalance;
  const transactions = [];
  for (const e of raw) {
    let amount = null;
    if (e.out != null || e.in != null) {
      amount = (e.in || 0) - (e.out || 0);
    } else if (e.amt) {
      const a = e.suffix ? { ...e.amt, credit: e.suffix === 'CR', debit: e.suffix === 'DR' } : e.amt;
      if (a.credit) amount = a.pence;
      else if (a.debit) amount = -a.pence;
      else if (anyNegative) amount = a.negative ? -a.pence : a.pence;
      else amount = INCOME_HINT.test(e.desc) ? a.pence : -a.pence;
    }
    // Use running balance to confirm or correct direction.
    if (amount != null && e.bal != null && prevBal != null) {
      const abs = Math.abs(amount);
      if (near(prevBal - abs, e.bal)) amount = -abs;
      else if (near(prevBal + abs, e.bal)) amount = abs;
    } else if (amount == null && e.bal != null && prevBal != null) {
      amount = e.bal - prevBal; // balance-only line
    }
    if (e.bal != null) prevBal = e.bal;
    if (amount == null || amount === 0) continue;
    transactions.push({ date: e.date, description: e.desc.replace(/\s+/g, ' ').trim(), amount, balance: e.bal, ...(e.holder ? { cardholder: e.holder } : {}) });
  }

  // Card statements print a balance summary (Amex: "Previous balance − credits + debits = New balance";
  // Aqua/Barclaycard/Capital One: one figure per line or per column, often with interest and fees).
  // Use it to fix signs, prove the balances and add interest/fees that are only in the summary.
  const amex = cardSummaryBox(fullText);
  const box = amex ? { ...amex, interest: 0, fees: 0 }
    : looksLikeCreditText(fullText) ? cardSummaryFields(linesToPageTexts(lines).join('\n')) : null;
  let balanceProven = false;
  if (box) {
    const res = applyCardSummary({ transactions, period }, box);
    transactions.splice(0, transactions.length, ...res.transactions);
    openingBalance = res.openingBalance;
    closingBalance = res.closingBalance;
    balanceProven = true;
    if (res.added.length) warnings.push(`Added ${res.added.map((t) => `${t.description.split(' (')[0].toLowerCase()} £${(-t.amount / 100).toFixed(2)}`).join(' and ')} from the statement summary (not listed as transactions).`);
  }
  // Statements with a per-product balance summary (Revolut: account + pockets): the main account's
  // closing figure in the latest summary, not the running balance of whichever section came last.
  if (closingBalance == null) {
    const rows = [...fullText.matchAll(/^account \((?:current|savings) account\)[^\n]*?(-?£[\d,]+\.\d{2})\s*$/gim)];
    if (rows.length) { const p = parseMoney(rows[rows.length - 1][1]); closingBalance = p.negative ? -p.pence : p.pence; }
  }
  if (prevBal != null && closingBalance == null) closingBalance = prevBal;
  if (!transactions.length) warnings.push('No transactions recognised. If this is a scanned PDF, turn on AI reading in Settings.');
  if (!foundCols && raw.length) warnings.push('Column headers not found; money in/out was inferred. Please review signs.');
  return { transactions, openingBalance, closingBalance, period, warnings, balanceProven };
}
