// Mortgage in principle (also called Agreement / Decision in Principle, AIP / DIP / MIP):
// read the lender, how much they'd lend, term, rate, LTV and when it expires from the PDF text.
// Only these figures are kept: never the file, names or addresses.
import { parseDate, addDays } from './dates.js';

const LENDERS = ['Halifax', 'Nationwide', 'Santander', 'Barclays', 'NatWest', 'HSBC', 'Lloyds', 'TSB', 'Virgin Money', 'Coventry Building Society', 'Skipton', 'Leeds Building Society', 'Yorkshire Building Society', 'Accord', 'Platform', 'Kensington', 'Metro Bank', 'first direct', 'Clydesdale', 'Principality', 'Newcastle Building Society', 'Nottingham Building Society', 'Habito', 'Molo', 'Gen H', 'Precise', 'Pepper Money', 'Bluestone', 'Aldermore', 'Fleet', 'Paragon', 'Hodge', 'Furness', 'Darlington', 'Bank of Ireland', 'Post Office', 'Royal Bank of Scotland', 'Ulster Bank', 'Co-operative Bank', 'Tesco Bank', 'Chelsea Building Society', 'Cumberland', 'Leek Building Society', 'Saffron', 'Suffolk Building Society', 'Mortgage Advice Bureau', 'L&C', 'Trussle', 'Mojo', 'Habito', 'Chase', 'Monzo', 'Starling', 'April Mortgages', 'Perenna', 'Generation Home', 'Kensington Mortgages', 'Atom'];
const MONEY = '£?\\s?(\\d{1,3}(?:,\\d{3})+|\\d{4,7})(?:\\.\\d{2})?';
const near = (labels, gap = 60) => new RegExp(`(?:${labels})[^£\\d\\n]{0,${gap}}${MONEY}`, 'i');
const pounds = (s) => (s ? Math.round(parseFloat(s.replace(/,/g, '')) * 100) : null);

export function isMIP(text, name = '') {
  return /\b(mortgage|agreement|decision|approval)\s+in\s+principle\b|\b(AIP|DIP|MIP)\b|mortgage promise|mortgage illustration/i.test(text) || /\b(aip|dip|mip|in.?principle)\b/i.test(name);
}

function dateNear(text, labels) {
  const re = new RegExp(`(?:${labels})[^\\d\\n]{0,25}(\\d{1,2}(?:st|nd|rd|th)?[\\s/.\\-]+(?:\\d{1,2}|[A-Za-z]{3,9})[\\s/.\\-,]+\\d{2,4})`, 'i');
  const m = text.match(re);
  return m ? parseDate(m[1].replace(/(st|nd|rd|th)\b/i, '').replace(/,/g, ' ').replace(/\s+/g, ' ')) : null;
}

/** @returns {{lender, amount, price, deposit, termYears, rate, ltv, interestOnly, applicants, issued, expires, validDays} | null} */
export function parseMIP(text) {
  const t = String(text || '').replace(/ /g, ' ');
  if (!t.trim()) return null;
  const lenderHit = LENDERS.map((l) => [l, t.search(new RegExp(`\\b${l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'))]).filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1])[0];
  const amount = pounds(t.match(near('loan amount|mortgage amount|amount (?:you could borrow|we could lend|we (?:are|would be) (?:prepared|willing|happy) to lend|agreed|requested|of (?:the )?(?:loan|mortgage))|borrowing amount|maximum (?:loan|borrowing|amount)|lend you(?: up to)?|you could borrow(?: up to)?|amount to borrow|total loan'))?.[1]);
  const price = pounds(t.match(near('purchase price|property (?:price|value)|estimated (?:property )?value|price of (?:the )?property|valuation'))?.[1]);
  const deposit = pounds(t.match(near('deposit', 30))?.[1]);
  const termM = t.match(/(?:mortgage\s+)?term[^\d\n]{0,25}(\d{1,2})\s*(?:years?|yrs?)(?:\s*(?:and\s*)?(\d{1,2})\s*months?)?/i);
  const termYears = termM ? +termM[1] + (termM[2] ? +termM[2] / 12 : 0) : null;
  const rateM = t.match(/(?:interest rate|initial rate|rate of interest|fixed rate|pay rate|tracker)[^\d\n]{0,40}(\d{1,2}\.\d{1,2})\s?%/i) || t.match(/(\d{1,2}\.\d{1,2})\s?%\s*(?:fixed|initial|variable|tracker)/i);
  const rate = rateM ? parseFloat(rateM[1]) : null;
  const ltvM = t.match(/(?:LTV|loan[\s-]to[\s-]value)[^\d\n]{0,25}(\d{1,3}(?:\.\d+)?)\s?%/i);
  const fixedM = t.match(/(\d{1,2})[\s-]*year\s+fix/i) || t.match(/fixed\s+(?:rate\s+)?(?:for|until)[^\d\n]{0,10}(\d{1,2})\s*years?/i);
  const issued = dateNear(t, 'date of issue|date issued|issued on|issue date|dated|date of decision|decision date|created on|date');
  const validDaysM = t.match(/valid\s+for\s+(\d{2,3})\s+days/i);
  let expires = dateNear(t, 'valid until|valid to|expiry date|expires on|expires|expiry|valid up to|until');
  if (!expires && issued && validDaysM) expires = addDays(issued, +validDaysM[1]);
  const applicants = Math.max(1, ...[...t.matchAll(/applicant\s*(\d)/gi)].map((m) => +m[1]), /joint (?:application|applicants|mortgage)/i.test(t) ? 2 : 1);
  const out = {
    lender: lenderHit ? lenderHit[0] : null, amount, price, deposit: deposit ?? (price && amount && price > amount ? price - amount : null), termYears, rate,
    ltv: ltvM ? parseFloat(ltvM[1]) : price && amount ? Math.round((amount / price) * 1000) / 10 : null,
    fixedYears: fixedM ? +fixedM[1] : null, interestOnly: /interest[\s-]only/i.test(t) && !/repayment\s*(?:basis|method)?\s*:?\s*capital/i.test(t),
    applicants, issued, expires, validDays: validDaysM ? +validDaysM[1] : null,
  };
  return out.amount || out.lender ? out : null;
}

/** Fields worth asking Claude for when the PDF has no text layer (photo or scan). */
export const MIP_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['lender', 'amount_gbp', 'property_price_gbp', 'deposit_gbp', 'term_years', 'rate_percent', 'ltv_percent', 'fixed_years', 'interest_only', 'applicants', 'issued', 'expires'],
  properties: {
    lender: { type: ['string', 'null'] }, amount_gbp: { type: ['number', 'null'] }, property_price_gbp: { type: ['number', 'null'] }, deposit_gbp: { type: ['number', 'null'] },
    term_years: { type: ['number', 'null'] }, rate_percent: { type: ['number', 'null'] }, ltv_percent: { type: ['number', 'null'] }, fixed_years: { type: ['number', 'null'] },
    interest_only: { type: 'boolean' }, applicants: { type: 'integer' },
    issued: { type: ['string', 'null'], description: 'YYYY-MM-DD' }, expires: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
  },
};
export const fromAI = (r) => ({
  lender: r.lender, amount: r.amount_gbp != null ? Math.round(r.amount_gbp * 100) : null, price: r.property_price_gbp != null ? Math.round(r.property_price_gbp * 100) : null,
  deposit: r.deposit_gbp != null ? Math.round(r.deposit_gbp * 100) : null, termYears: r.term_years, rate: r.rate_percent, ltv: r.ltv_percent, fixedYears: r.fixed_years,
  interestOnly: !!r.interest_only, applicants: r.applicants || 1, issued: r.issued, expires: r.expires, validDays: null,
});
