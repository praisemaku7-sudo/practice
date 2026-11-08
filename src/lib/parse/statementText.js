// Turns positioned text lines (from pdf.js) into transactions.
// Works on most UK current-account and credit-card PDF statements:
//   Date | Description | Paid out | Paid in | Balance      (Barclays, Lloyds, Halifax, NatWest, HSBC, Santander...)
//   Date | Description | Amount (signed)                   (Monzo, Starling, Revolut)
//   Date | Date | Description | Amount [CR]               (credit cards)

import { matchLeadingDate, findNamedDates, iso } from '../dates.js';
import { parseMoney, AMOUNT_TOKEN } from '../money.js';
import { isSummaryLine, CLOSING_LINE, OPENING_LINE } from './junk.js';

const OUT_HEAD = /^(paid out|money out|out|withdrawn|withdrawals?|debits?|debit amount|payments?|spent|money out \(£\))$/i;
const IN_HEAD = /^(paid in|money in|in|deposits?|credits?|credit amount|received|money in \(£\))$/i;
const BAL_HEAD = /^(balance|running balance|balance \(£\))$/i;
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

/** Find column header x-centres (right edges work best for right-aligned numbers). */
function detectColumns(lines) {
  for (const line of lines) {
    const toks = tokenize(line.items);
    const text = lineText(toks).toLowerCase();
    if (!/date/.test(text) || !/(balance|paid|money|amount|debit|credit|withdraw|deposit|out|in)/.test(text)) continue;
    // Merge adjacent tokens into phrases ("paid", "out" -> "paid out").
    const phrases = [];
    for (const t of toks) {
      const last = phrases[phrases.length - 1];
      if (last && t.x - (last.x + last.w) < 8) { last.t += ' ' + t.t; last.w = t.x + t.w - last.x; }
      else phrases.push({ ...t });
    }
    const cols = {};
    for (const p of phrases) {
      const label = p.t.replace(/[:]/g, '').trim();
      const right = p.x + p.w;
      if (OUT_HEAD.test(label)) cols.out = right;
      else if (IN_HEAD.test(label)) cols.in = right;
      else if (BAL_HEAD.test(label)) cols.bal = right;
      else if (AMT_HEAD.test(label)) cols.amt = right;
    }
    if (cols.out != null || cols.in != null || cols.amt != null) return cols;
  }
  return null;
}

function inferPeriod(fullText, fallbackYear) {
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
  const cols = detectColumns(lines);
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

    if (SKIP.test(text) || isSummaryLine(text)) {
      lastWasTx = false;
      const amts = toks.filter((t) => AMOUNT_TOKEN.test(t.t));
      if (amts.length && OPENING_LINE.test(text) && openingBalance == null) {
        const p = parseMoney(amts[amts.length - 1].t);
        openingBalance = p.negative || p.debit ? -p.pence : p.pence;
      }
      if (amts.length && CLOSING_LINE.test(text)) {
        const p = parseMoney(amts[amts.length - 1].t);
        closingBalance = p.negative || p.debit ? -p.pence : p.pence;
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

    const amountToks = toks.filter((t) => AMOUNT_TOKEN.test(t.t));
    const descToks = toks.filter((t) => !AMOUNT_TOKEN.test(t.t) && !/^(£|GBP|CR|DR)$/i.test(t.t));
    const desc = lineText(descToks).trim();

    // "CR" / "DR" printed on its own line under the amount (American Express).
    if (!amountToks.length && !dateMatch && /^(CR|DR)$/i.test(text.trim()) && lastWasTx) {
      raw[raw.length - 1].suffix = text.trim().toUpperCase();
      continue;
    }
    // Lines starting with "Total" are subtotals, never transactions.
    if (!dateMatch && /^total\b/i.test(text.trim())) {
      // "Total new spend transactions for SARAH MACPHAIL": everything since the last total was hers.
      const holder = text.match(/transactions\s+for\s+([A-Z][A-Z' .-]+?)(?:\s+[\d£-]|$)/i);
      if (holder) {
        const name = holder[1].replace(/\s+/g, ' ').trim();
        for (let i = holderFrom; i < raw.length; i++) if (!raw[i].holder) raw[i].holder = name;
      }
      holderFrom = raw.length;
      lastWasTx = false; pending = null; continue;
    }
    if (!amountToks.length) {
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
        if (role === 'bal') entry.bal = p.negative || p.debit ? -p.pence : p.pence;
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

  // Card statements print "Previous balance − New credits + New debits = Closing balance".
  // Use it to check signs (a credit printed without "CR" gets fixed) and as the balances.
  const box = cardSummaryBox(fullText);
  if (box) {
    const credits = () => transactions.filter((t) => t.amount > 0).reduce((a, t) => a + t.amount, 0);
    let diff = box.credits - credits();
    if (diff > 0) {
      // A debit that should be a credit: flip the one whose size matches the gap.
      const cand = transactions.find((t) => t.amount === -diff) || transactions.find((t) => t.amount < 0 && CREDIT_WORDS.test(t.description) && -t.amount <= diff);
      if (cand) cand.amount = -cand.amount;
    } else if (diff < 0) {
      const cand = transactions.find((t) => t.amount === -diff);
      if (cand) cand.amount = -cand.amount;
    }
    // Stored as balances: what you owe is negative.
    openingBalance = -box.previous;
    closingBalance = -box.closing;
  }
  if (prevBal != null && closingBalance == null) closingBalance = prevBal;
  if (!transactions.length) warnings.push('No transactions recognised. If this is a scanned PDF, turn on AI reading in Settings.');
  if (!cols && raw.length) warnings.push('Column headers not found; money in/out was inferred. Please review signs.');
  return { transactions, openingBalance, closingBalance, period, warnings };
}
