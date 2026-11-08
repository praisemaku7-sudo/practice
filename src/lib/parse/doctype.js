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

/**
 * @returns {{ isStatement: boolean, kind: string|null, reason: string }}
 */
export function classifyDocument(text, parsed = { transactions: [] }) {
  const t = String(text || '');
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
