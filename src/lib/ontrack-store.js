// Saving what On track uses: credit reports and your household plan (kept on this phone only).
import { state, saveSettings, recompute } from '../state.js';
import { db } from './db.js';

/** Credit reports, newest first; the last few per person are kept so you can see the score move. */
export async function creditReports() {
  return (await db.kvGet('creditReports', [])) || [];
}

export async function saveCreditReport(report) {
  const all = await creditReports();
  const entry = { ...report, id: `${report.owner}|${report.date || Date.now()}`, savedAt: Date.now() };
  const rest = all.filter((r) => r.id !== entry.id);
  const mine = [entry, ...rest.filter((r) => r.owner === entry.owner)].slice(0, 6);
  await db.kvSet('creditReports', [...mine, ...rest.filter((r) => r.owner !== entry.owner)].sort((a, b) => String(b.date).localeCompare(String(a.date))));
}

const tokens = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !['card', 'credit', 'the', 'newday', 'ltd', 'bank'].includes(w));

/**
 * Use a spreadsheet plan: keep it for On track, optionally set category budgets to its suggested
 * amounts, and give matching credit cards their APR and limit. Returns how many budgets were set.
 */
export async function usePlan(plan, { budgets = true } = {}) {
  const startMonth = new Date().toISOString().slice(0, 7);
  const patch = { plan: { ...plan, importedAt: Date.now(), startMonth } };
  let n = 0;
  if (budgets) {
    const b = {};
    for (const l of plan.budget) {
      // Stepped plans start on their Month 1 targets.
      const amount = l.stages ? l.stages[0] : l.suggested;
      if (l.category) { b[l.category] = (b[l.category] || 0) + amount; continue; }
      if (/^savings?\b/i.test(l.label)) patch.savingsTarget = amount;
      else if (/card repay/i.test(l.label)) patch.cardPayoff = amount;
    }
    n = Object.keys(b).length;
    if (n) patch.budgets = { ...(state.settings.budgets || {}), ...b };
  }
  await saveSettings(patch);
  // Cards: "Aqua (NewDay) card" ↔ "Aqua Card ••4411", "Amex Gold (Sarah)" ↔ "American Express Preferred Rewards Gold".
  const cards = (state.allAccounts || state.accounts).filter((a) => a.type === 'credit');
  for (const d of plan.debts) {
    const dt = tokens(d.name.replace(/amex/i, 'american express'));
    let best = null, bestScore = 0;
    for (const c of cards) {
      const ct = tokens(`${c.name} ${c.bank}`.replace(/amex/i, 'american express'));
      const score = dt.filter((w) => ct.includes(w)).length;
      if (score > bestScore) { best = c; bestScore = score; }
    }
    if (!best) continue;
    let changed = false;
    if (d.apr != null && d.apr > 0 && best.apr == null) { best.apr = d.apr; changed = true; }
    if (d.limit && !best.limit) { best.limit = d.limit; changed = true; }
    if (d.min && !best.minPayment) { best.minPayment = d.min; changed = true; }
    if (changed) await db.put('accounts', best);
  }
  recompute();
  return n;
}

/** Tick a step / savings action as done (stored in the plan). */
export async function togglePlanItem(kind, i, j) {
  const plan = structuredClone(state.settings.plan);
  if (!plan) return;
  if (kind === 'step') plan.steps[i].items[j].done = !plan.steps[i].items[j].done;
  else if (kind === 'saving') plan.savings[i].done = !plan.savings[i].done;
  await saveSettings({ plan });
}

/** Move the budgets on to a stepped plan's targets for this month. */
export async function applyStage(stage) {
  const plan = state.settings.plan;
  if (!plan) return 0;
  const b = { ...(state.settings.budgets || {}) }, sums = {};
  for (const l of plan.budget) if (l.category) sums[l.category] = (sums[l.category] || 0) + (l.stages ? l.stages[Math.min(stage, l.stages.length - 1)] : l.suggested);
  Object.assign(b, sums);
  await saveSettings({ budgets: b, plan: { ...plan, appliedStage: stage } });
  recompute();
  return Object.keys(sums).length;
}
