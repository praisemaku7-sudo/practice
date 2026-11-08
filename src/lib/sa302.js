// HMRC SA302 tax calculation (self-employed income): total income and tax for a tax year,
// turned into a monthly take-home figure for the budget.
const money = (re, t) => { const m = t.match(re); return m ? Math.round(parseFloat(m[m.length - 1].replace(/,/g, '')) * 100) : null; };
const AMT = '£?\\s*(-?[\\d,]+\\.\\d{2})';

export function isSA302(text) {
  return /\bSA302\b/i.test(text) || (/tax calculation/i.test(text) && /self assessment|HMRC|HM Revenue/i.test(text) && /total income/i.test(text));
}

/**
 * @returns {{ taxYear, totalIncome, taxDue, net, monthlyNet } | null}
 */
export function parseSA302(text) {
  const t = String(text || '').replace(/ /g, ' ');
  if (!isSA302(t)) return null;
  const totalIncome = money(new RegExp(`total income received[^\\d£\\n]{0,40}${AMT}`, 'i'), t)
    ?? money(new RegExp(`total income[^\\d£\\n]{0,40}${AMT}`, 'i'), t);
  if (totalIncome == null) return null;
  // Prefer the all-in total (income tax + Class 2 & 4 NI); otherwise add the parts.
  let taxDue = money(new RegExp(`total (?:income tax and class [24] (?:and [24] )?nic|tax(?: and nic)?|income tax)[^\\n]{0,40}?due[^\\d£\\n]{0,40}${AMT}`, 'i'), t);
  if (taxDue == null) {
    const it = money(new RegExp(`income tax due[^\\d£\\n]{0,60}${AMT}`, 'i'), t) || 0;
    const c4 = money(new RegExp(`class 4[^\\d£\\n]{0,60}${AMT}`, 'i'), t) || 0;
    const c2 = money(new RegExp(`class 2[^\\d£\\n]{0,60}${AMT}`, 'i'), t) || 0;
    taxDue = it + c4 + c2;
  }
  const y = t.match(/(?:tax )?year[^\d\n]{0,20}(20\d\d)\s*[-–/]\s*(20\d\d|\d\d)\b/i) || t.match(/year ended 5 april (20\d\d)/i);
  const taxYear = y ? (y[2] ? `${y[1]}-${String(y[2]).slice(-2)}` : `${+y[1] - 1}-${String(y[1]).slice(-2)}`) : null;
  const net = Math.max(0, totalIncome - Math.max(0, taxDue));
  return { taxYear, totalIncome, taxDue, net, monthlyNet: Math.round(net / 12) };
}
