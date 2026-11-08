// "Path to living within your means": concrete actions from your own spending, each with the £ a
// month it frees up, so you can tick what you'll do and see the gap close.
import { catName } from './categories.js';
import { helpFor } from './directory.js';
import { isTemporary } from './plan.js';

// Lifestyle cuts that are realistic in one go (share of what you spend now).
const TRIMS = { eating_out: 0.5, takeaway: 0.5, shopping: 0.4, entertainment: 0.3, travel: 0.5, personal_care: 0.25, groceries: 0.1, other: 0.25 };
const PHONE_TV = /\b(O2|EE|VODAFONE|THREE|SKY|BT|VIRGIN MEDIA|TALKTALK|PLUSNET|GIFFGAFF|NOW ?TV)\b/i;

/**
 * @returns {{ gap, actions: Array<{id, title, detail, saving, kind, category?, target?, help?}> }}
 *   gap = income − average spending (negative = short each month).
 */
export function buildPath({ budget, recurring, settings, income, avgSpend, mortgagePayment = null }) {
  const actions = [];
  const hist = Object.fromEntries(budget.lines.map((l) => [l.category, l.hist || 0]));
  const covered = new Set();
  // 1. Cancel subscriptions and memberships.
  for (const r of recurring.filter((x) => x.active && x.direction === 'out' && ['subscriptions', 'entertainment', 'fitness'].includes(x.category))) {
    const h = helpFor(r.name);
    actions.push({ id: `sub:${r.key}`, title: `Cancel ${r.name}`, detail: h ? h.how : 'Cancel in the company\'s app or website.', saving: r.amount, kind: 'lasting', help: h });
    covered.add(r.name.toUpperCase());
  }
  // 2. Phones and TV: SIM-only and out-of-contract prices.
  const phones = recurring.filter((x) => x.active && x.direction === 'out' && PHONE_TV.test(x.name) && !covered.has(x.name.toUpperCase()));
  if (phones.length) {
    const total = phones.reduce((a, r) => a + r.amount, 0);
    actions.push({ id: 'phones', title: 'Phones and TV: SIM-only, renegotiate or switch', detail: `${phones.map((r) => r.name).join(', ')}: out-of-contract deals usually cost far less. Ask for a better price or move.`, saving: Math.round(total * 0.35), kind: 'lasting', help: helpFor(phones[0].name) });
  }
  // 3. Bank fees and card interest.
  const fees = hist.fees || 0;
  if (fees >= 500) actions.push({ id: 'fees', title: 'Stop bank fees and card interest', detail: 'Fund every Direct Debit, move bills to after payday, pay cards down: no more fees for bounced payments.', saving: fees, kind: 'lasting' });
  // 4. Everyday spending: realistic cuts, set as budgets when ticked.
  for (const [cat, pct] of Object.entries(TRIMS)) {
    const now = hist[cat] || 0;
    if (now < 4000) continue;
    const target = Math.round((now * (1 - pct)) / 500) * 500;
    actions.push({ id: `trim:${cat}`, title: `${catName(cat)}: £${Math.round(now / 100)} → £${Math.round(target / 100)} a month`, detail: cat === 'eating_out' || cat === 'takeaway' ? 'About half as often. Tick it and this becomes your budget, with a per-day allowance in On track.' : `About ${Math.round(pct * 100)}% less. Tick it and this becomes your budget.`, saving: now - target, kind: 'lasting', category: cat, target });
  }
  // 5. Savings actions from your spreadsheet plan (not already listed, not done yet).
  for (const [i, x] of (settings.plan?.savings || []).entries()) {
    if (x.done || !x.saving || covered.has(String(x.item).toUpperCase())) continue;
    if (actions.some((a) => a.title.toUpperCase().includes(String(x.item).toUpperCase().split(' ')[0]) && a.id.startsWith('sub:'))) continue;
    if (/eating out|groceries|shopping|card overpayment/i.test(x.item)) continue; // covered by the spending cuts above
    actions.push({ id: `plan:${i}`, title: `${x.item}: ${x.action}`, detail: x.note || 'From your spreadsheet plan.', saving: x.saving, kind: isTemporary(x) ? 'temporary' : 'lasting', help: helpFor(x.item) });
  }
  // 6. Money you may be owed.
  const hasCB = (settings.otherIncome || []).some((x) => /child benefit/i.test(x.label));
  const baby = Object.values(settings.tempIncome || {}).some((t) => /maternity|paternity/i.test(t.label || ''));
  if (!hasCB && baby) actions.push({ id: 'cb', title: 'Claim Child Benefit', detail: '£26.05 a week for your first child (2025/26 rate). Claim even if you might pay some back: it protects National Insurance credits.', saving: 11288, kind: 'income' });
  // 7. Housing: the mortgage if it'll cost less than today's rent.
  const housing = hist.housing || 0;
  if (mortgagePayment && housing && mortgagePayment < housing) actions.push({ id: 'mortgage', title: 'Mortgage instead of rent', detail: `From your Future planning: £${Math.round(mortgagePayment / 100)} a month vs £${Math.round(housing / 100)} rent and costs now.`, saving: housing - mortgagePayment, kind: 'planned' });
  actions.sort((a, b) => b.saving - a.saving);
  return { gap: income - avgSpend - (budget.goalsMonthly || 0), actions };
}

export const chosenSaving = (path, chosen) => path.actions.filter((a) => chosen[a.id]).reduce((s, a) => s + a.saving, 0);
