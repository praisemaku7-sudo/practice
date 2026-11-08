// Is this file actually a bank / card statement? Catches payslips, receipts, invoices,
// bills, order confirmations and the like before they pollute your numbers.

const STATEMENT = [/statement/i, /\bbalance\b/i, /sort code/i, /account (number|no)/i, /paid (in|out)|money (in|out)/i, /transactions?/i,
  /brought forward|carried forward|previous balance|new balance|closing balance|opening balance/i, /credit limit|minimum (re)?payment/i, /\bIBAN\b|\bBIC\b/];
const OTHER = [
  ['payslip', /\b(payslip|pay slip|pay advice|net pay|gross pay|tax code|ni number|national insurance|ytd|year to date)\b/i],
  ['receipt', /\b(receipt|thank you for your (order|purchase)|order (number|confirmation)|subtotal|vat no|item\(s\))\b/i],
  ['invoice', /\b(invoice (number|no|date)|amount payable|bill to|remit to|due date)\b/i],
  ['utility or phone bill', /\b(your bill|meter reading|tariff|kwh|standing charge|data allowance|call charges)\b/i],
  ['booking or ticket', /\b(booking (reference|confirmation)|itinerary|boarding pass|e-?ticket|check-?in)\b/i],
  ['tax or pension document', /\b(P60|P45|self assessment|HMRC|pension statement|annual allowance)\b/i],
];

// Investment platforms and pension providers: their statements show portfolio values, not spending money.
const INVEST_PROVIDER = /\b(quilter|hargreaves lansdown|aj bell|vanguard|fidelity|interactive investor|nutmeg|wealthify|moneyfarm|freetrade|trading ?212|st\.? james'?s place|brewin|rathbones|charles stanley|parmenion|transact|nucleus|aviva|royal london|standard life|aegon|scottish widows|legal (&|and) general|nest pensions?|the people'?s pension|pensionbee|smart pension|evelyn partners|true potential|abrdn|investec wealth)\b/i;
const INVEST_WORDS = [/investment statement/i, /portfolio (summary|valuation)/i, /valuation (statement|date)/i, /\bunits? (held|price)\b/i, /\bfund (name|value|price)\b/i,
  /stocks (and|&) shares isa/i, /general investment account|\bGIA\b/i, /\bSIPP\b|self[- ]invested personal pension/i, /pension (statement|plan|pot|value)/i, /adviser fees?|platform (fee|charge)/i,
  /current value|previous value/i, /\bdividends?\b|income received/i, /annual management charge|ongoing charges?/i];

/** Investment/pension statements are never imported as bank accounts. */
export function isInvestmentDocument(text) {
  const t = String(text || '');
  const words = INVEST_WORDS.filter((re) => re.test(t)).length;
  return (INVEST_PROVIDER.test(t) && words >= 1) || words >= 3;
}

/**
 * @returns {{ isStatement: boolean, kind: string|null, reason: string }}
 */
export function classifyDocument(text, parsed = { transactions: [] }) {
  const t = String(text || '');
  if (isInvestmentDocument(t)) {
    const who = (t.match(INVEST_PROVIDER) || [])[0];
    return { isStatement: false, kind: 'investment', reason: `This is ${who ? `a ${who.replace(/\b\w/g, (c) => c.toUpperCase())} ` : 'an '}investment or pension statement. It isn't a bank account, so it's not counted in your spending, income or balances.` };
  }
  const statementHits = STATEMENT.filter((re) => re.test(t)).length;
  const other = OTHER.map(([kind, re]) => [kind, (t.match(new RegExp(re.source, 'gi')) || []).length]).sort((a, b) => b[1] - a[1])[0];
  const txs = parsed.transactions?.length || 0;
  if (other && other[1] >= 2 && statementHits <= 2) {
    return { isStatement: false, kind: other[0], reason: `This looks like a ${other[0]}, not a bank or card statement.` };
  }
  if (!txs && t.length > 200 && statementHits <= 1) {
    return { isStatement: false, kind: other?.[1] ? other[0] : 'document', reason: "This doesn't look like a bank or card statement (no transactions or balances found)." };
  }
  return { isStatement: true, kind: null, reason: '' };
}
