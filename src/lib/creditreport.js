// Credit reports (Checkmyfile, and similar layouts from ClearScore/Experian/Equifax/TransUnion):
// score, every account with balance/limit/status and late-payment markers, and searches.
// Read on the phone from the PDF's text; nothing is sent anywhere.

export function isCreditReport(text) {
  const t = String(text || '');
  const brand = /checkmyfile|clearscore|credit karma|experian|equifax|transunion/i.test(t);
  const words = [/credit (file|report)/i, /payment history/i, /hard searches?/i, /soft searches?/i, /my score|credit score/i, /arrears/i].filter((re) => re.test(t)).length;
  return (brand && words >= 2) || words >= 4;
}

const money = (s) => { const m = String(s || '').match(/£\s*([\d,]+(?:\.\d{2})?)/); return m ? Math.round(parseFloat(m[1].replace(/,/g, '')) * 100) : null; };
const ACC_HEAD = /^\s*(.+?)\s+-\s+(Credit Card|Credit and store cards|Store Card|Loans?|Current Account|Mortgage|Budget Account|Insurance|Communications(?: Supplier)?|Telecoms|Utilit(?:y|ies)|Mail Order|Hire Purchase|Home Credit|Rental|Other)[A-Za-z /]*\s+-\s+Ending\s+(\w{2,6})\s*$/i;

/** Months marked on a payment-history grid line, e.g. "26  OK OK OK 1 2 D - - -". */
function markers(line) {
  return (line.replace(/^\s*\d{2}\s+/, '').match(/\b(OK|U|S|IN|AR|SF|US|D|Q|[1-6])\b/g) || []);
}

/**
 * @returns {{provider, person, date, score, accounts: Array, hardSearches: Array<{date, by, agency}>, softSearches: number}}
 */
export function parseCreditReport(text) {
  const t = String(text || '');
  const lines = t.split('\n');
  const provider = (t.match(/checkmyfile|clearscore|credit karma|experian|equifax|transunion/i) || ['Credit report'])[0];
  const person = ((t.match(/([A-Z][a-z]+(?: [A-Z][a-z'-]+)+)'s Credit File/) || t.match(/Produced for ([A-Z][A-Za-z' -]+?) on /) || [])[1] || '').trim();
  const dm = t.match(/Produced for .+? on (\d{1,2} [A-Z][a-z]+ \d{4})/) || t.match(/\b(\d{1,2} (?:January|February|March|April|May|June|July|August|September|October|November|December) 20\d\d)\b/);
  const date = dm ? new Date(dm[1] + ' UTC').toISOString().slice(0, 10) : null;
  // The big score number sits just above or below its "MY SCORE" label, depending on the PDF.
  let score = null;
  const si = lines.findIndex((l) => /\b(MY SCORE|CREDIT SCORE|YOUR SCORE)\b/i.test(l));
  if (si >= 0) {
    for (const d of [0, -1, 1, -2, 2, -3, 3]) {
      const m = (lines[si + d] || '').match(/(?:^|\s)(\d{3,4})\s*$/);
      if (m && +m[1] >= 100 && +m[1] <= 1000) { score = +m[1]; break; }
    }
  }

  // Accounts: a heading line, then labelled rows (values for each agency side by side).
  const accounts = [];
  let section = 'active';
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/Payment History\s*-\s*(Settled|Closed|Inactive)/i.test(line)) section = 'settled';
    else if (/Payment History\s*-\s*Active/i.test(line)) section = 'active';
    if (/Hard Searches|Soft Searches|Electoral|Financial Associat|Linked Address/i.test(line) && !ACC_HEAD.test(line)) cur = null;
    const h = line.match(ACC_HEAD);
    if (h) {
      cur = { lender: h[1].replace(/\s+/g, ' ').trim(), type: h[2].toLowerCase().includes('card') ? 'credit card' : h[2].toLowerCase(), last4: h[3], section, balance: null, limit: null, status: '', regularPayment: null, opened: null, history: [] };
      accounts.push(cur);
      continue;
    }
    if (!cur) continue;
    const lab = line.match(/^\s*(BALANCE|LIMIT|STATUS|REGULAR PAYMENT|OPENED)\s+(.*)$/);
    if (lab) {
      const [, k, rest] = lab;
      if (k === 'BALANCE' && cur.balance == null) cur.balance = money(rest);
      else if (k === 'LIMIT' && cur.limit == null) cur.limit = money(rest);
      else if (k === 'REGULAR PAYMENT' && cur.regularPayment == null) cur.regularPayment = money(rest);
      else if (k === 'STATUS' && !cur.status) cur.status = rest.trim().split(/\s{2,}/)[0];
      else if (k === 'OPENED' && !cur.opened) cur.opened = rest.trim().split(/\s{2,}/)[0];
      continue;
    }
    // Payment history rows: "26  OK OK 1 ..." (year, then one marker per month, per agency).
    const yr = line.match(/^\s*(?:PAYMENT HISTORY\s+)?(\d{2})\s+((?:(?:OK|U|S|IN|AR|SF|US|D|Q|[1-6]|-)\s+){3,})/);
    if (yr) cur.history.push({ year: 2000 + +yr[1], marks: markers(yr[0]) });
  }
  for (const a of accounts) {
    const recent = a.history.filter((h) => h.year >= (date ? +date.slice(0, 4) - 1 : 0)).flatMap((h) => h.marks);
    a.late12 = recent.filter((m) => /^[1-6]$/.test(m)).length;
    a.defaulted = a.history.some((h) => h.marks.some((m) => m === 'D' || m === 'US')) || /default/i.test(a.status);
    a.arrangement = a.history.some((h) => h.marks.includes('AR')) || /arrangement/i.test(a.status);
    // Only cards have a real credit limit (a loan's "limit" is often its original amount).
    a.overLimit = a.type === 'credit card' && a.limit && a.balance != null && a.balance > a.limit;
  }

  // Searches: "EXPERIAN 03/01/2026 Searched by AMERICAN EXPRESS" blocks, split by the section headings.
  const hardAt = t.search(/Hard Searches/i), softAt = t.search(/Soft Searches/i);
  const block = (from, to) => (from < 0 ? '' : t.slice(from, to > from ? to : undefined));
  const hardText = block(hardAt, softAt > hardAt ? softAt : -1);
  const searches = (s) => {
    const dates = [...s.matchAll(/(EXPERIAN|EQUIFAX|TRANSUNION)\s+(\d{2})\/(\d{2})\/(\d{4})/g)].map((m) => ({ agency: m[1], date: `${m[4]}-${m[3]}-${m[2]}` }));
    const bys = [...s.matchAll(/Searched by\s+([A-Z0-9&().,' -]+?)(?=\s{2,}|\n|$)/g)].map((m) => m[1].trim());
    return dates.map((d, i) => ({ ...d, by: bys[i] || '' }));
  };
  const hardSearches = searches(hardText);
  const softSearches = searches(block(softAt, -1)).length;
  return { provider: provider[0].toUpperCase() + provider.slice(1).toLowerCase(), person, date, score, accounts, hardSearches, softSearches };
}

/** What's helping and hurting, from the latest report(s) and the app's own card balances. */
export function creditChecks(report, { today, cards = [] } = {}) {
  const out = [];
  if (!report) return out;
  const active = report.accounts.filter((a) => a.section === 'active');
  const cardsOnFile = active.filter((a) => a.type === 'credit card' && a.limit);
  const bal = cardsOnFile.reduce((s, a) => s + (a.balance || 0), 0), lim = cardsOnFile.reduce((s, a) => s + a.limit, 0);
  if (lim) {
    const pct = Math.round((bal / lim) * 100);
    out.push({ level: pct > 75 ? 'bad' : pct > 30 ? 'warn' : 'good', title: `Using ${pct}% of your card limits`, detail: pct > 30 ? `Lenders like to see under 30% (ideally under 10%). Paying cards down to £${Math.round((lim * 0.3) / 100)} in total would get you there.` : 'Under 30%: good.' });
  }
  for (const a of active.filter((x) => x.overLimit)) out.push({ level: 'bad', title: `${a.lender} is over its limit`, detail: `Balance above the £${Math.round(a.limit / 100)} limit. Bring it under before the next statement: over-limit is reported every month and costs fees.` });
  const late = active.filter((a) => a.late12 > 0);
  if (late.length) out.push({ level: 'bad', title: `Late payments in the last year on ${late.length} account${late.length > 1 ? 's' : ''}`, detail: `${late.map((a) => a.lender).join(', ')}. Every month paid on time from now pushes these further back. Set a Direct Debit for at least the minimum on every card.` });
  else if (active.length) out.push({ level: 'good', title: 'No late payments in the last year', detail: 'Keep every Direct Debit funded to keep it that way.' });
  const bad = active.filter((a) => a.defaulted || a.arrangement);
  if (bad.length) out.push({ level: 'bad', title: `${bad.length} default or payment arrangement`, detail: bad.map((a) => a.lender).join(', ') });
  const since = (days) => report.hardSearches.filter((s) => today && (Date.parse(today) - Date.parse(s.date)) / 86400000 <= days);
  const h6 = since(183), h12 = since(365);
  if (h6.length >= 2) out.push({ level: h6.length >= 4 ? 'bad' : 'warn', title: `${h6.length} credit applications in 6 months`, detail: `Each hard search (${[...new Set(h6.map((s) => s.by))].slice(0, 4).join(', ')}) can lower your score for up to a year. Check eligibility with soft-search tools first, and space applications at least 3 months apart.` });
  else out.push({ level: 'good', title: `${h12.length} credit application${h12.length === 1 ? '' : 's'} in the last year`, detail: 'Few recent applications: good.' });
  // Cards the app tracks that are close to their limit (limit from the report or the card's settings).
  for (const c of cards) {
    if (!c.limit || c.owed == null) continue;
    if (c.owed > c.limit * 0.9) out.push({ level: 'warn', title: `${c.name} is ${Math.round((c.owed / c.limit) * 100)}% of its limit`, detail: 'Keep a margin below the limit so a card fee or interest can\'t push it over.' });
  }
  return out;
}
