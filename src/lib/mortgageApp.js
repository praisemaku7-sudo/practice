// A full mortgage application form, read by Claude from the PDF or photos: the loan, price, deposit
// sources, incomes, declared debts, credit-history answers and documents the lender wants.
// Only figures and yes/no answers are kept: never names, addresses, dates of birth or contact details.
import { monthlyPayment } from './mortgage.js';

const num = { type: ['number', 'null'] };
const bool = { type: ['boolean', 'null'] };
const str = { type: ['string', 'null'] };
const obj = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });

export const APP_SCHEMA = obj({
  lender: str,
  loan_gbp: num,
  property_price_gbp: num,
  term_years: num,
  repayment: bool,
  first_time_buyers: bool,
  new_build: bool,
  builder_incentive_gbp: { ...num, description: 'Builder or seller incentive / gifted deposit from the builder, if stated' },
  deposit_sources: { type: 'array', items: obj({ source: { type: 'string', description: 'e.g. Savings, Gifted deposit, Sale of property' }, amount_gbp: { type: 'number' } }) },
  submitted: { ...str, description: 'Date the application or declaration was confirmed, YYYY-MM-DD' },
  applicants: {
    type: 'array',
    description: 'One entry per applicant, in the order on the form. Never include names.',
    items: obj({
      employment: { type: 'string', description: 'employed, self-employed, director, retired, other' },
      current_job_start: { ...str, description: 'Start date of the CURRENT job or business, YYYY-MM-DD' },
      gross_income_gbp: { ...num, description: 'Total annual gross income as stated on the form (Total income)' },
      self_employed_latest_gbp: num,
      self_employed_previous_gbp: num,
      self_employed_average_gbp: num,
      rent_monthly_gbp: num,
      pension_monthly_gbp: num,
      dependants: { type: ['integer', 'null'] },
      missed_payments_ever: { ...bool, description: 'Answer to: ever failed to keep up payments on a mortgage, loan, rent or credit card' },
      arrears_last_2_years: bool,
      ccj: bool,
      insolvency: { ...bool, description: 'IVA, debt relief order, bankruptcy or sequestration' },
      declined_before: bool,
      other_credit_info: { ...bool, description: 'Answer to: any other credit conduct information to disclose' },
      income_change_expected: { ...bool, description: 'Answer to: aware of changes to income or expenditure during the term' },
      commitments: {
        type: 'array',
        items: obj({ type: { type: 'string', description: 'Credit card, Loan, Hire purchase, Student loan, Overdraft…' }, provider: str, balance_gbp: num, monthly_gbp: num, repaid_in_full: bool, plan: { ...str, description: 'e.g. To remain, To be repaid' } }),
      },
    }),
  },
  documents_required: { type: 'array', items: { type: 'string' }, description: 'Documents the lender asks for, short labels, e.g. "Last 2 months payslips"' },
});

const p = (v) => (v == null ? null : Math.round(v * 100));
/** Claude's answer (pounds) → the app's figures (pence). */
export function fromAppAI(r) {
  return {
    lender: r.lender || null,
    loan: p(r.loan_gbp), price: p(r.property_price_gbp), termYears: r.term_years, repayment: r.repayment !== false,
    firstTime: r.first_time_buyers, newBuild: r.new_build, incentive: p(r.builder_incentive_gbp),
    deposits: (r.deposit_sources || []).map((d) => ({ source: d.source, amount: p(d.amount_gbp) })),
    submitted: r.submitted || null,
    applicants: (r.applicants || []).map((a) => ({
      employment: a.employment, jobStart: a.current_job_start, gross: p(a.gross_income_gbp),
      seLatest: p(a.self_employed_latest_gbp), sePrevious: p(a.self_employed_previous_gbp), seAverage: p(a.self_employed_average_gbp),
      rent: p(a.rent_monthly_gbp), pension: p(a.pension_monthly_gbp), dependants: a.dependants,
      missed: a.missed_payments_ever, arrears: a.arrears_last_2_years, ccj: a.ccj, insolvency: a.insolvency, declined: a.declined_before, otherInfo: a.other_credit_info, incomeChange: a.income_change_expected,
      debts: (a.commitments || []).map((c) => ({ type: c.type, provider: c.provider, balance: p(c.balance_gbp), monthly: p(c.monthly_gbp), full: c.repaid_in_full, plan: c.plan })),
    })),
    docs: r.documents_required || [],
  };
}

const monthsBetween = (a, b) => (new Date(b) - new Date(a)) / (30.44 * 864e5);

/**
 * What a lender will look at, from the application plus what the statements show.
 * @param {object} app  fromAppAI() output
 * @param {{today: string, rate: number, takeHome?: number, statementDebtMonthly?: number, fees?: number, gambling?: number}} ctx
 */
export function assessApplication(app, ctx) {
  const A = app.applicants || [];
  const deposit = sum(app.deposits, (d) => d.amount) + (app.incentive || 0);
  const price = app.price || (app.loan && deposit ? app.loan + deposit : null);
  const ltv = app.loan && price ? Math.round((app.loan / price) * 1000) / 10 : null;
  // Lenders often use the lower of the latest year and the 2-year average for self-employed income.
  const gross = sum(A, (a) => (a.seAverage && a.seLatest ? Math.min(a.seAverage, a.seLatest) : a.gross || a.seLatest || 0));
  const lti = app.loan && gross ? Math.round((app.loan / gross) * 100) / 100 : null;
  const term = ctx.termYears || app.termYears || 25;
  const months = Math.round(term * 12);
  const pay = ctx.pay ?? (app.loan ? monthlyPayment(app.loan, ctx.rate, months, { interestOnly: !app.repayment }) : null);
  const pay25 = app.loan && months > 300 ? monthlyPayment(app.loan, ctx.rate, 300) : null;
  const interest = pay ? pay * months - app.loan : null;
  const interest25 = pay25 ? pay25 * 300 - app.loan : null;
  const rent = sum(A, (a) => a.rent || 0);
  const debts = A.flatMap((a, i) => a.debts.map((d) => ({ ...d, who: i })));
  const declaredMonthly = sum(debts, (d) => d.monthly || 0);
  const declaredBalance = sum(debts.filter((d) => !/student/i.test(d.type)), (d) => d.balance || 0);
  const pensions = sum(A, (a) => a.pension || 0);
  const conduct = A.map((a, i) => ({ i, flags: [a.missed && 'a missed payment', a.arrears && 'arrears in the last 2 years', a.ccj && 'a CCJ', a.insolvency && 'an IVA, DRO or bankruptcy', a.declined && 'a previous decline', a.otherInfo && 'other credit information'].filter(Boolean) })).filter((x) => x.flags.length);
  const newJobs = A.map((a, i) => ({ i, a, m: a.jobStart ? monthsBetween(a.jobStart, ctx.today) : null })).filter((x) => x.m != null && ((/self/i.test(x.a.employment) && x.m < 24) || (!/self/i.test(x.a.employment) && x.m < 12)));
  const deps = A.map((a) => a.dependants).filter((d) => d != null);
  const depMismatch = deps.length > 1 && new Set(deps.map((d) => d > 0)).size > 1;

  const checks = [];
  const add = (ok, title, detail = '') => checks.push({ ok, title, detail });
  if (ltv != null) add(ltv <= 90, `Loan to value ${ltv}%`, `${fmtK(deposit)} deposit${app.incentive ? ` (including a ${fmtK(app.incentive)} builder incentive)` : ''} on ${fmtK(price)}. ${ltv <= 60 ? 'Best rates.' : ltv <= 75 ? 'Good rates: each 5% step down to 60% can lower the rate.' : ltv <= 85 ? 'Fine: rates improve at 75%.' : 'High: fewer deals and higher rates.'}`);
  if (lti != null) add(lti <= 4.5, `Borrowing ${lti}× income`, `${fmtK(app.loan)} on ${fmtK(gross)} gross a year${A.some((a) => a.seAverage) ? ' (self-employed income at the lower of the latest year and the 2-year average)' : ''}. Most lenders cap at 4.5×.`);
  if (ctx.termYears && app.termYears && Math.abs(ctx.termYears - app.termYears) >= 1) add(false, `Term: application ${app.termYears} years, illustration ${ctx.termYears} years`, `The form and the illustration disagree. The lender decides on what's submitted: confirm with your broker which term is going in. The illustration's payment assumes ${ctx.termYears} years.`);
  if (pay != null) add(ctx.takeHome ? pay <= ctx.takeHome * 0.35 : null, `Mortgage ${ctx.pay ? '' : 'about '}${fmtK(pay)} a month`, `${ctx.pay ? `From your illustration: ${ctx.rate}% over ${term} years` : `At ${ctx.rate}% over ${term} years`}${rent ? `, against ${fmtK(rent)} rent now: ${pay < rent ? `${fmtK(rent - pay)} a month less` : `${fmtK(pay - rent)} a month more`}` : ''}${ctx.takeHome ? `. ${Math.round((pay / ctx.takeHome) * 100)}% of take-home` : ''}.${ctx.pay ? '' : ' The rate isn\'t on the application, so this uses your plan\'s rate; upload the illustration for the real payment.'}`);
  if (debts.length) {
    const gap = ctx.statementDebtMonthly != null ? ctx.statementDebtMonthly - declaredMonthly : 0;
    add(gap <= 5000, `Declared debts ${fmtK(declaredMonthly)} a month`, `${debts.length} item${debts.length > 1 ? 's' : ''}, ${fmtK(declaredBalance)} owed excluding student loans${pensions ? `; pensions ${fmtK(pensions)} a month` : ''}. ${gap > 5000 ? `Your statements show about ${fmtK(ctx.statementDebtMonthly)} a month going to cards and loans: lenders compare the form with your statements and credit file, so tell your broker about anything missing.` : 'Keep every one paid on time and don\'t add new credit until completion.'}`);
  }
  if (conduct.length) add(false, 'Credit history to explain', `${conduct.map((c) => `Applicant ${c.i + 1} declared ${c.flags.join(' and ')}`).join('. ')}. Have the dates, amounts and how it was settled ready: lenders ask, and an honest, settled account is usually fine. Nothing late from now until completion.`);
  else if (A.length) add(true, 'No adverse credit declared');
  for (const j of newJobs) add(null, `Applicant ${j.i + 1}: ${/self/i.test(j.a.employment) ? 'self-employed' : 'new job'} for ${Math.max(1, Math.floor(j.m))} months`, /self/i.test(j.a.employment) ? 'Many lenders want 2 years of accounts (SA302s): have both years ready.' : 'Some lenders want probation passed or 3 months of payslips in the new job: have the contract and payslips ready.');
  if (depMismatch) add(false, 'Dependants don\'t match between applicants', 'One applicant lists dependants and the other lists none. Lenders check the form is consistent, and dependants change the affordability sum: ask your broker to correct it before the offer.');
  if (A.some((a) => a.incomeChange === false)) add(null, 'Income changes', 'The form says no income change is expected. If either income will drop before completion or soon after (maternity, fewer hours, a new job), tell the lender: a change found later can stop the offer.');
  if (ctx.fees != null) add(ctx.fees === 0, ctx.fees ? `${ctx.fees} late or overdraft charges in 3 months` : 'No late or overdraft charges in 3 months', ctx.fees ? 'Lenders read the last 2–3 months of statements for these.' : '');
  if (ctx.gambling) add(false, `${ctx.gambling} gambling payments in 3 months`, 'Lenders often ask about these.');
  return { checks, term, deposit, price, ltv, gross, lti, pay, pay25, interest, interest25, rent, declaredMonthly, declaredBalance };
}

const sum = (l, f) => (l || []).reduce((a, x) => a + (f(x) || 0), 0);
const fmtK = (pence) => (pence == null ? '?' : `£${Math.round(pence / 100).toLocaleString('en-GB')}`);
