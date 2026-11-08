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
].map((p) => `(?:${p})\\b`).join('|'));
const ANCHORED = new RegExp(`^(?:YOUR |THE |TOTAL |EST\\.? )?(?:${SUMMARY.source})`);

export function isSummaryLine(description) {
  let d = String(description || '').toUpperCase().replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').trim();
  // Ignore leading dates ("07 Nov", "07/11/2026") and punctuation.
  d = d.replace(/^((\d{1,2}[ /.-](\d{1,2}|[A-Z]{3,9})([ /.-]\d{2,4})?|\d{4}-\d{2}-\d{2})\s*){1,2}/, '').replace(/^[^A-Z0-9]+/, '');
  // Only when the line STARTS with a summary phrase: on some card statements the summary
  // box sits on the same line as a real purchase, and that purchase must be kept.
  return ANCHORED.test(d);
}

/** For the PDF reader: the summary value worth keeping as the closing balance. */
export const CLOSING_LINE = /(carried forward|closing balance|end balance|(your )?new balance|statement balance|outstanding balance)/i;
export const OPENING_LINE = /(brought forward|opening balance|start balance|previous balance)/i;
