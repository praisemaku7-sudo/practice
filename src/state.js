// In-memory app state, loaded from IndexedDB, with derived values recomputed on change.
import { db } from './lib/db.js';
import { markTransfers, detectRecurring, detectPayday, monthsPresent } from './lib/analysis.js';
import { buildBudget } from './lib/budget.js';
import { monthKey, todayISO, daysBetween } from './lib/dates.js';
import { DEFAULT_MODEL } from './lib/ai.js';
import { categorize } from './lib/categorize.js';
import { statementCoverage } from './lib/coverage.js';
import { cardSummary, suspectedCreditCards } from './lib/credit.js';
import { findStoredDuplicates } from './lib/duplicates.js';
import { isSummaryLine } from './lib/parse/junk.js';
import { goalsMonthly } from './lib/goals.js';

export const DEFAULT_SETTINGS = {
  income: null,          // pence/month; null = estimate from statements
  savingsTarget: null,   // pence/month; null = 20% of income
  budgets: {},           // category -> pence override
  payday: null,          // day of month; null = detect from salary
  apiKey: '',
  model: DEFAULT_MODEL,
  pdfMode: 'auto',       // 'auto' = on-device first, Claude only if balances don't add up; 'always'; 'never'
  mainAccountId: null,
  userRules: {},         // merchantKey -> category
  consolidationDone: {},
  trackFrom: '2026-06-01', // ignore everything before this date (null = keep all history)
  coverageDismissed: {}, // 'accountId|YYYY-MM' -> true (no statement expected)
  checkins: {},          // 'YYYY-MM' -> ISO date the monthly check-in was completed
  billFlags: {},         // recurring key -> 'cancel' | 'cancelled'
  wishlist: [],          // [{id, item, price, category, added}]
  goals: [],             // savings goals [{id, name, icon, target, by: 'YYYY-MM', saved, accountId, owner}]
  cardPayoff: null,      // pence/month extra toward credit cards
  cardMethod: 'avalanche',
  ownNames: [],
  hiddenBanners: {},
  people: [{ id: 'p1', name: 'Me', color: '#3d8fd1' }], // household members
  scope: 'all',          // whose money you're looking at: 'all' (household), a person id, or 'joint'
  scoped: {},            // per-person budget settings: { [personId]: { income, savingsTarget, budgets, cardPayoff, payday } }     // banner key -> signature when you closed it          // how your name appears on transfers between your own accounts
  bufferPence: 5000,     // keep at least £50 after bills
};

export const state = {
  txs: [], accounts: [], imports: [], checks: [],
  settings: { ...DEFAULT_SETTINGS },
  month: monthKey(todayISO()),
  derived: null,
};

// Budget settings that belong to whoever you're viewing (household vs each person).
export const SCOPED_KEYS = ['income', 'savingsTarget', 'budgets', 'cardPayoff', 'payday'];
export const PERSON_COLORS = ['#3d8fd1', '#c84f9b', '#d18a2e', '#2e9e6a', '#7a63c9'];
export const ownerOf = (a) => a?.owner || state.settings.people[0]?.id || 'p1';
export const personName = (id) => (id === 'joint' ? 'Joint' : state.settings.people.find((p) => p.id === id)?.name || 'Me');
export const scopeLabel = () => (state.settings.scope === 'all' ? 'Household' : personName(state.settings.scope));

/** Household member whose name matches a cardholder printed on a statement (words unique to one person). */
export function personForName(name) {
  if (!name) return null;
  const hay = ` ${String(name).toUpperCase().replace(/[^A-Z]+/g, ' ')} `;
  const people = state.settings.people.filter((p) => p.name && p.name !== 'Me');
  const words = (n) => n.toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter((w) => w.length >= 3);
  const all = people.flatMap((p) => words(p.name));
  const hits = people.filter((p) => words(p.name).some((w) => all.filter((v) => v === w).length === 1 && hay.includes(` ${w} `)));
  return hits.length === 1 ? hits[0].id : null;
}

/** Whose spending is this? The cardholder named on the statement, else the account's owner. */
export function txOwner(t, accountsById) {
  return (t.cardholder && personForName(t.cardholder)) || ownerOf(accountsById[t.accountId]);
}

/** Which accounts and transactions the current view covers. */
function applyView(allTxs, allAccounts) {
  const scope = state.settings.scope;
  const from = state.settings.trackFrom;
  const accounts = scope === 'all' ? allAccounts : allAccounts.filter((a) => ownerOf(a) === scope);
  const ids = new Set(accounts.map((a) => a.id));
  const known = new Set(allAccounts.map((a) => a.id));
  state.hiddenCount = from ? allTxs.filter((t) => t.date < from).length : 0;
  state.allAccounts = allAccounts;
  state.accounts = accounts;
  const byId = Object.fromEntries(allAccounts.map((a) => [a.id, a]));
  // A person's view includes their purchases on a shared card (by cardholder), and excludes
  // other cardholders' purchases on their own card.
  state.txs = allTxs.filter((t) => {
    if (from && t.date < from) return false;
    if (scope === 'all') return true;
    if (!known.has(t.accountId)) return scope === state.settings.people[0]?.id;
    return txOwner(t, byId) === scope;
  });
  void ids;
}

export async function load() {
  const [txs, accounts, imports, checks, settings] = await Promise.all([
    db.all('tx'), db.all('accounts'), db.all('imports'), db.all('checks'), db.kvGet('settings', {}),
  ]);
  state.settings = { ...DEFAULT_SETTINGS, ...settings };
  if (settings.useAIForPDF === false && !settings.pdfMode) state.settings.pdfMode = 'never';
  state.settings.wishlist = state.settings.wishlist || [];
  if (!state.settings.people?.length) state.settings.people = [...DEFAULT_SETTINGS.people];
  // Always open on the whole household; a person's view is something you pick each time.
  if (!state.scopeChosen) state.settings.scope = 'all';
  const scope = state.settings.scope;
  if (scope !== 'all' && scope !== 'joint' && !state.settings.people.some((p) => p.id === scope)) state.settings.scope = 'all';
  // Older transactions stay stored (so changing the date back restores them) but are hidden everywhere.
  applyView(txs, accounts);
  Object.assign(state, { imports, checks: checks.sort((a, b) => b.at - a.at) });
  recompute();
  const months = monthsPresent(state.txs);
  if (months.length && !months.includes(state.month)) state.month = months[months.length - 1];
}

/** Settings in force for the current view: each person has their own income, goals and budgets. */
function effectiveSettings() {
  const s = state.settings;
  if (s.scope === 'all') {
    // Household income = everyone's payslip income together, once each person has one.
    if (s.income == null && s.people.length > 1) {
      const incomes = s.people.map((p) => s.scoped?.[p.id]?.income);
      if (incomes.every((v) => v != null)) return { ...s, income: incomes.reduce((a, v) => a + v, 0) };
    }
    return s;
  }
  return { ...s, income: null, savingsTarget: null, budgets: {}, cardPayoff: null, payday: null, ...(s.scoped?.[s.scope] || {}) };
}

export function recompute() {
  const today = todayISO();
  state.eff = effectiveSettings();
  const recurring = detectRecurring(state.txs, { today });
  const detected = detectPayday(recurring);
  const payday = state.eff.payday ?? detected?.day ?? null;
  const byIdAll = Object.fromEntries((state.allAccounts || state.accounts).map((a) => [a.id, a]));
  const gm = goalsMonthly(state.settings.goals || [], state.settings.scope, today, byIdAll);
  const budget = buildBudget(state.txs, { ...state.eff, goalsMonthly: gm }, { today });
  const currentAccounts = state.accounts.filter((a) => a.type === 'current' && a.balance != null);
  // A balance older than ~10 days is too stale to trust for the bills check.
  const fresh = currentAccounts.filter((a) => a.balanceDate && daysBetween(a.balanceDate, today) <= 10);
  const balance = fresh.length ? fresh.reduce((s, a) => s + a.balance, 0) : null;
  const coverage = statementCoverage({ accounts: state.accounts, imports: state.imports, txs: state.txs, today, dismissed: state.settings.coverageDismissed || {}, startMonth: state.settings.trackFrom ? monthKey(state.settings.trackFrom) : null });
  const cards = cardSummary({ accounts: state.accounts, txs: state.txs, today, trackFrom: state.settings.trackFrom });
  const suspects = suspectedCreditCards(state.accounts, state.txs);
  const duplicates = findStoredDuplicates(state.txs);
  state.derived = { today, coverage, cards, suspects, duplicates, recurring, payday, detectedPayday: detected, budget, balance, staleBalance: currentAccounts.length > 0 && !fresh.length, months: monthsPresent(state.txs) };
  return state.derived;
}

export async function saveSettings(patch) {
  const scope = state.settings.scope;
  if (scope !== 'all' && SCOPED_KEYS.some((k) => k in patch)) {
    // Budget settings changed while viewing one person are saved for that person only.
    const mine = { ...(state.settings.scoped?.[scope] || {}) };
    patch = { ...patch };
    for (const k of SCOPED_KEYS) if (k in patch) { mine[k] = patch[k]; delete patch[k]; }
    patch.scoped = { ...(state.settings.scoped || {}), [scope]: mine };
  }
  state.settings = { ...state.settings, ...patch };
  await db.kvSet('settings', state.settings);
  recompute();
}

/** Switch whose money you're looking at. */
export async function setScope(scope) {
  state.scopeChosen = true;
  await saveSettings({ scope });
  await load();
}

/**
 * Re-run transfer pairing over EVERY account (whoever's view is open, so transfers
 * between you and your partner still pair up), persist changes, then refresh the view.
 */
export async function relinkTransfers() {
  const [all, allAccounts] = await Promise.all([db.all('tx'), db.all('accounts')]);
  const before = new Map(all.map((t) => [t.id, t.category + '|' + (t.pairId || '') + '|' + (t.autoTransfer ? 1 : 0)]));
  for (const t of all) {
    if ((t.pairId || t.autoTransfer) && !t.userCategory) {
      delete t.pairId; delete t.autoTransfer;
      t.category = categorize(t.description, t.amount, state.settings.userRules);
    }
  }
  const byAcc = Object.fromEntries(allAccounts.map((a) => [a.id, a]));
  const names = [...(state.settings.ownNames || []), ...state.settings.people.map((p) => p.name).filter((n) => n && /\s/.test(n.trim()))];
  markTransfers(all, byAcc, { ownNames: names });
  const changed = all.filter((t) => before.get(t.id) !== t.category + '|' + (t.pairId || '') + '|' + (t.autoTransfer ? 1 : 0));
  if (changed.length) await db.putMany('tx', changed);
  applyView(all, allAccounts);
}

/** Remove statement summary lines (balances, rates…) that were saved as transactions. */
export async function removeSummaryLines() {
  const all = await db.all('tx');
  const junk = all.filter((t) => !t.manual && isSummaryLine(t.description));
  for (const t of junk) await db.del('tx', t.id);
  const ids = new Set(junk.map((t) => t.id));
  state.txs = state.txs.filter((t) => !ids.has(t.id));
  return junk;
}

export async function wipeAll() {
  await Promise.all(['tx', 'accounts', 'imports', 'checks', 'kv'].map((s) => db.clear(s)));
  Object.assign(state, { txs: [], accounts: [], imports: [], checks: [], settings: { ...DEFAULT_SETTINGS } });
  recompute();
}

export const accountName = (id) => state.accounts.find((a) => a.id === id)?.name ?? 'Unknown account';
