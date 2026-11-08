// "Back on track" plan: read from a household-finances spreadsheet (tables found by their headings,
// not by fixed cell positions), or worked out from your own spending when there's no spreadsheet.
import { CATEGORIES, catKind } from './categories.js';

const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && /^-?£?[\d,]+(\.\d+)?$/.test(v.trim()) ? parseFloat(v.replace(/[£,]/g, '')) : null);
const pence = (v) => (num(v) == null ? null : Math.round(num(v) * 100));
const str = (v) => (v == null ? '' : String(v).trim());
const isTotal = (row) => /^total\b/i.test(str(row.find((v) => v != null)));

/** Spreadsheet budget lines → the app's categories (null = shown in the plan but not a budget). */
export function mapCategory(label) {
  const l = str(label).toLowerCase();
  const rules = [
    [/eating out|restaurant|dining/, 'eating_out'], [/takeaway/, 'takeaway'], [/grocer|food shop|supermarket/, 'groceries'],
    [/subscription/, 'subscriptions'], [/transport|fuel|travel to work|car\b/, 'transport'], [/housing|rent|mortgage/, 'housing'],
    [/bills|phone|utilit|broadband|energy/, 'bills'], [/insurance|medical|health/, 'insurance'], [/giving|tithe|charity|church/, 'gifts'],
    [/shopping|clothes/, 'shopping'], [/entertain/, 'entertainment'], [/holiday|travel/, 'travel'], [/child|baby|nursery/, 'childcare'],
    [/personal care|hair|beauty/, 'personal_care'], [/fitness|gym/, 'fitness'],
  ];
  for (const [re, id] of rules) if (re.test(l)) return id;
  return null;
}

/** Find a table by its header row (all keywords present). Returns {header, rows, col(name)}. */
function findTable(sheets, need, { prefer } = {}) {
  const ordered = prefer ? [...sheets].sort((a, b) => (prefer.test(b.name) ? 1 : 0) - (prefer.test(a.name) ? 1 : 0)) : sheets;
  for (const sh of ordered) {
    for (let i = 0; i < sh.rows.length; i++) {
      const cells = sh.rows[i].map((v) => str(v).toLowerCase());
      if (!need.every((re) => cells.some((c) => re.test(c)))) continue;
      const col = (re) => cells.findIndex((c) => re.test(c));
      const rows = [];
      for (let j = i + 1; j < sh.rows.length; j++) {
        const r = sh.rows[j];
        if (!r.some((v) => v != null && str(v) !== '')) { if (rows.length) break; continue; }
        if (isTotal(r)) break;
        rows.push(r);
      }
      return { sheet: sh.name, rows, col };
    }
  }
  return null;
}

/** Everything useful in a household-finances spreadsheet. */
export function extractPlan(sheets) {
  const plan = { income: [], debts: [], budget: [], savings: [], regular: [], steps: [], notes: [] };

  const inc = findTable(sheets, [/^source$/, /net|per month/]);
  if (inc) {
    const cS = inc.col(/^source$/), cA = inc.col(/net|per month/);
    for (const r of inc.rows) if (str(r[cS]) && pence(r[cA]) != null) plan.income.push({ source: str(r[cS]), monthly: pence(r[cA]) });
  }

  const debt = findTable(sheets, [/^debt$/, /^balance/, /apr|interest/]);
  if (debt) {
    const c = { name: debt.col(/^debt$/), bal: debt.col(/^balance/), apr: debt.col(/apr|interest/), min: debt.col(/min|payment/), lim: debt.col(/^limit/), note: debt.col(/status|note/) };
    for (const r of debt.rows) {
      const name = str(r[c.name]);
      if (!name || /^card payoff|^credit card debt/i.test(name)) continue;
      const apr = num(r[c.apr]);
      plan.debts.push({ name, balance: pence(r[c.bal]) ?? 0, apr: apr == null ? null : apr > 1 ? apr / 100 : apr, min: pence(r[c.min]), limit: c.lim >= 0 ? pence(r[c.lim]) : null, note: c.note >= 0 ? str(r[c.note]).slice(0, 200) : '' });
    }
  }

  const bud = findTable(sheets, [/^category$/, /^month\s*1/]) || findTable(sheets, [/^category$/, /^suggested/], { prefer: /suggest/i }) || findTable(sheets, [/^category$/, /^planned/]);
  if (bud) {
    const c = { cat: bud.col(/^category$/), now: bud.col(/^now|^actual|^planned/), sug: bud.col(/^suggested|^planned|^month 1/), note: bud.col(/note/) };
    // Optional stepped targets: "Month 1", "Month 2", "Month 3"… (big cuts made gradually).
    const header = sheets.find((sh) => sh.name === bud.sheet).rows.find((r) => r.some((v) => /^category$/i.test(str(v)))) || [];
    const stageCols = header.map((v, i) => [str(v), i]).filter(([v]) => /^month\s*\d+/i.test(v)).map(([, i]) => i);
    for (const r of bud.rows) {
      const label = str(r[c.cat]);
      if (!label || pence(r[c.sug]) == null) continue;
      const stages = stageCols.map((i) => pence(r[i])).filter((v) => v != null);
      plan.budget.push({ label, category: mapCategory(label), now: pence(r[c.now]), suggested: pence(r[c.sug]), ...(stages.length > 1 ? { stages } : {}), note: c.note >= 0 ? str(r[c.note]).slice(0, 200) : '' });
    }
  }

  const sav = findTable(sheets, [/^item$/, /saving/]);
  if (sav) {
    const c = { item: sav.col(/^item$/), now: sav.col(/^now/), action: sav.col(/^action/), nw: sav.col(/^new/), save: sav.col(/saving/), note: sav.col(/note/) };
    for (const r of sav.rows) {
      const item = str(r[c.item]);
      if (!item || pence(r[c.save]) == null) continue; // section headings have no amounts
      plan.savings.push({ item, now: pence(r[c.now]), action: str(r[c.action]), after: pence(r[c.nw]), saving: pence(r[c.save]), note: c.note >= 0 ? str(r[c.note]).slice(0, 160) : '', done: false });
    }
  }

  const reg = findTable(sheets, [/^item$/, /^amount/, /^status$/]);
  if (reg) {
    const c = { item: reg.col(/^item$/), amt: reg.col(/^amount/), cat: reg.col(/^category$/), st: reg.col(/^status$/), acc: reg.col(/account/) };
    for (const r of reg.rows) {
      const item = str(r[c.item]);
      if (!item || pence(r[c.amt]) == null) continue;
      plan.regular.push({ item, monthly: pence(r[c.amt]), category: str(r[c.cat]), status: str(r[c.st]).toUpperCase(), account: c.acc >= 0 ? str(r[c.acc]) : '' });
    }
  }

  // Action plan: "STEP 1: STOP THE BLEEDING (this week)" followed by its tasks.
  for (const sh of sheets) {
    let cur = null;
    for (const r of sh.rows) {
      const t = str(r.find((v) => v != null && str(v) !== ''));
      if (!t) continue;
      const m = t.match(/^step\s*(\d+)\s*[:.\-–]\s*(.+)$/i);
      if (m) { cur = { title: m[2].replace(/\s+/g, ' ').trim(), items: [] }; plan.steps.push(cur); continue; }
      if (cur && t.length > 12 && !/^free help|^tabs:|^how this/i.test(t)) cur.items.push({ text: t.slice(0, 300), done: false });
      else if (cur && /^free help/i.test(t)) plan.notes.push(t.slice(0, 300));
    }
    if (plan.steps.length) break;
  }
  return plan;
}

/** Savings actions that only defer a cost (payment holidays, lowered plans, pauses): they come back. */
export const isTemporary = (x) => /holiday|pause(?! non)|lower|defer|freeze|temporar|reduce .*during|break/i.test(`${x.action} ${x.note}`) && !/non.?essential/i.test(x.action || '');

/** Which stage of a stepped plan applies this month (0 = first month), counted from when it was imported. */
export function planStage(plan, month) {
  if (!plan?.startMonth) return 0;
  const [y0, m0] = plan.startMonth.split('-').map(Number), [y, m] = month.split('-').map(Number);
  const max = Math.max(0, ...plan.budget.map((l) => (l.stages?.length || 1) - 1));
  return Math.max(0, Math.min(max, (y - y0) * 12 + (m - m0)));
}
export const targetFor = (line, stage) => (line.stages ? line.stages[Math.min(stage, line.stages.length - 1)] : line.suggested);

/**
 * Plan lines that are far below what you actually spend (from your statements): a cut of more than
 * 60% (and £100+) in one go rarely sticks.
 */
export function realityCheck(plan, actualByCategory, stage = 0) {
  const out = [];
  for (const l of plan.budget) {
    if (!l.category) continue;
    // What you really spend: your statements, or the spreadsheet's own "Now" figure if that's higher.
    const actual = Math.max(actualByCategory[l.category] || 0, l.now || 0), target = targetFor(l, stage);
    if (actual > 0 && actual - target >= 10000 && target < actual * 0.4) out.push({ label: l.label, category: l.category, actual, target, cut: Math.round((1 - target / actual) * 100) });
  }
  return out.sort((a, b) => (b.actual - b.target) - (a.actual - a.target));
}

/** Debts in the order to pay: anything over its limit first (it's reported every month), then highest interest. */
export function debtOrder(debts) {
  return [...debts].filter((d) => d.balance > 0).sort((a, b) => {
    const oa = a.limit && a.balance > a.limit ? 1 : 0, ob = b.limit && b.balance > b.limit ? 1 : 0;
    return ob - oa || (b.apr || 0) - (a.apr || 0);
  });
}

export const hasPlan = (p) => !!(p && (p.debts.length || p.budget.length || p.savings.length || p.steps.length));

/**
 * A plan from your own spending when there's no spreadsheet: keep fixed costs, trim essentials a
 * little and lifestyle spending more, until income covers outgoings (plus a savings target).
 */
export function suggestBudget({ avgByCategory, income, savingsTarget = 0 }) {
  const lines = Object.entries(avgByCategory).filter(([c, v]) => v > 0 && !['income', 'transfer', 'savings', 'excluded'].includes(c))
    .map(([category, now]) => ({ category, now, suggested: now, kind: catKind(category) }));
  const total = () => lines.reduce((a, l) => a + l.suggested, 0);
  let gap = total() + savingsTarget - income;
  // Lifestyle first (up to 60% cut), then essentials (up to 15%); fixed costs need a call, not a budget.
  for (const [kind, maxCut] of [['personal', 0.6], ['essential', 0.15]]) {
    if (gap <= 0) break;
    const pool = lines.filter((l) => l.kind === kind);
    const room = pool.reduce((a, l) => a + l.now * maxCut, 0);
    if (!room) continue;
    const share = Math.min(1, gap / room);
    for (const l of pool) l.suggested = Math.round((l.now - l.now * maxCut * share) / 500) * 500;
    gap = total() + savingsTarget - income;
  }
  return { lines: lines.sort((a, b) => b.now - a.now), totalNow: lines.reduce((a, l) => a + l.now, 0), totalSuggested: total(), leftNow: income - lines.reduce((a, l) => a + l.now, 0), leftSuggested: income - total() - savingsTarget };
}

export { CATEGORIES };
