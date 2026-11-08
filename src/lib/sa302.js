// HMRC SA302 tax calculation (self-employed income): total income and tax for a tax year,
// turned into a monthly take-home figure for the budget.
import { amountFor } from './parse/amounts.js';

export function isSA302(text, fileName = '') {
  const t = String(text || '');
  return /\bSA ?302\b/i.test(t + ' ' + fileName) || /tax year overview/i.test(t)
    || (/tax calculation/i.test(t) && /(self assessment|HMRC|HM Revenue|income tax)/i.test(t))
    || (/self assessment/i.test(t) && /total income/i.test(t));
}

/**
 * @returns {{ taxYear, totalIncome, taxDue, net, monthlyNet } | null}
 */
export function parseSA302(text, fileName = '') {
  const t = String(text || '').replace(/\u00a0/g, ' ');
  if (!isSA302(t, fileName)) return null;
  const totalIncome = amountFor(t, /total income received/i) ?? amountFor(t, /\btotal income\b(?! on which)/i) ?? amountFor(t, /\bincome received\b/i)
    ?? amountFor(t, /profit from self[- ]employment/i);
  if (totalIncome == null) return null;
  // Prefer the all-in total (income tax + Class 2 & 4 NI); otherwise add the parts.
  let taxDue = amountFor(t, /total (?:income tax and class [24] (?:and [24] )?nic|tax(?: and nic)?|income tax)[^\n]{0,40}?due/i)
    ?? amountFor(t, /total tax due/i);
  if (taxDue == null) {
    const it = amountFor(t, /income tax (?:due|charged)/i) || 0;
    const c4 = amountFor(t, /class 4/i) || 0;
    const c2 = amountFor(t, /class 2/i) || 0;
    taxDue = it + c4 + c2;
  }
  const y = t.match(/(?:tax )?year[^\d\n]{0,20}(20\d\d)\s*[-–/to ]+\s*(20\d\d|\d\d)\b/i) || t.match(/year ended 5 april (20\d\d)/i) || String(fileName).match(/(20\d\d)/);
  const taxYear = y ? (y[2] ? `${y[1]}-${String(y[2]).slice(-2)}` : `${+y[1] - 1}-${String(y[1]).slice(-2)}`) : null;
  const net = Math.max(0, totalIncome - Math.max(0, taxDue));
  return { taxYear, totalIncome, taxDue, net, monthlyNet: Math.round(net / 12) };
}
