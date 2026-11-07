// Lines from a statement's summary boxes that are NOT transactions:
// balances, interest-rate tables, minimum payments, warnings, totals.
// If one of these gets read as a payment it shows up as spending (and, because
// it appears every month, as a fake "subscription").
const SUMMARY = new RegExp([
  "(YOUR )?NEW BALANCE", 'PREVIOUS BALANCE', 'OPENING BALANCE', 'CLOSING BALANCE', 'STATEMENT BALANCE', 'OUTSTANDING BALANCE',
  'BALANCE (BROUGHT|CARRIED) FORWARD', 'BROUGHT FORWARD', 'CARRIED FORWARD', 'AVAILABLE (BALANCE|CREDIT|TO SPEND)', 'CREDIT LIMIT',
  'STANDARD (PURCHASE|CASH|BALANCE TRANSFER|MONEY TRANSFER) RATE', '(PURCHASE|CASH|BALANCE TRANSFER|MONEY TRANSFER) RATE',
  'ANNUAL PERCENTAGE RATE', 'APR', 'INTEREST RATES?', 'ESTIMATED INTEREST', 'INTEREST (FREE|DAYS)', 'PROMOTIONAL RATE',
  'MINIMUM (PAYMENT|REPAYMENT|AMOUNT)( DUE)?', '(TOTAL )?AMOUNT DUE', 'PAYMENT DUE( DATE| BY)?',
  "YOU'?VE INCURRED", 'YOU HAVE INCURRED', 'YOU WILL PAY', 'YOU COULD PAY', 'IF YOU (ONLY )?(MAKE|PAY)',
  'TOTAL (PAID IN|PAID OUT|MONEY IN|MONEY OUT|PAYMENTS|PURCHASES|CREDITS|DEBITS|SPENT|RECEIVED|INTEREST|FEES|CHARGES)',
  'STATEMENT (DATE|PERIOD|SUMMARY|NUMBER)', 'ACCOUNT SUMMARY', 'SUMMARY OF', 'PAGE \\d+ OF \\d+',
].map((p) => `\\b${p}\\b`).join('|'));

export function isSummaryLine(description) {
  const d = String(description || '').toUpperCase().replace(/[’‘`]/g, "'").replace(/\s+/g, ' ');
  return SUMMARY.test(d);
}

/** For the PDF reader: the summary value worth keeping as the closing balance. */
export const CLOSING_LINE = /(carried forward|closing balance|end balance|(your )?new balance|statement balance|outstanding balance)/i;
export const OPENING_LINE = /(brought forward|opening balance|start balance|previous balance)/i;
