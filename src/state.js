// In-memory app state, loaded from IndexedDB, with derived values recomputed on change.
import { db } from './lib/db.js';
import { markTransfers, detectRecurring, detectPayday, monthsPresent, clearAnalysisCache } from './lib/analysis.js';
import { buildBudget } from './lib/budget.js';
import { monthKey, todayISO, daysBetween, nextDayOfMonth } from './lib/dates.js';
import { DEFAULT_MODEL } from './lib/models.js';
import { categorize, merchantKey } from './lib/categorize.js';
import { statementCoverage } from './lib/coverage.js';
import { cardSummary, suspectedCreditCards } from './lib/credit.js';
import { findStoredDuplicates } from './lib/duplicates.js';
import { isSummaryLine } from './lib/parse/junk.js';
import { goalsMonthly } from './lib/goals.js';
import { householdFor, otherFor } from './lib/income.js';

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
  tempIncome: {},        // { [personId]: { label, monthly, until: 'YYYY-MM' } }, e.g. maternity pay
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
  const TITLES = ['MR', 'MRS', 'MS', 'MISS', 'DR', 'MX'];
  const words = (n) => String(n).toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter((w) => w && !TITLES.includes(w));
  const hay = words(name);
  if (!hay.length) return null;
  // Each person's names: what you typed plus names seen on their statements (e.g. a maiden name).
  const people = state.settings.people.map((p) => ({ id: p.id, names: [p.name, ...(p.aliases || [])].filter((n) => n && n !== 'Me').map(words).filter((w) => w.length) })).filter((p) => p.names.length);
  // 1) Exact full name.
  const full = people.find((p) => p.names.some((n) => n.join(' ') === hay.join(' ')));
  if (full) return full.id;
  // 2) First name (a shared surname says nothing about whose it is), unique to one person.
  const firsts = people.map((p) => ({ id: p.id, firsts: new Set(p.names.map((n) => n[0]).filter((w) => w.length >= 3)) }));
  const hits = firsts.filter((p) => [...p.firsts].some((f) => hay.includes(f) && firsts.filter((o) => o.firsts.has(f)).length === 1));
  return hits.length === 1 ? hits[0].id : null;
}

/** Every name you and your partner appear under on statements (used to spot transfers between you). */
export function allPeopleNames() {
  const full = state.settings.people.flatMap((p) => [p.name, ...(p.aliases || [])]).filter((n) => n && n !== 'Me' && /\s/.test(n.trim()));
  const variants = full.flatMap((n) => {
    const w = n.toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter((x) => x.length > 1 && !['MR', 'MRS', 'MS', 'MISS', 'DR'].includes(x));
    if (w.length < 2) return [];
    const first = w[0], last = w[w.length - 1];
    return [`${first} ${last}`, `${last} ${first}`, `${first[0]} ${last}`, `${last} ${first[0]}`];
  });
  return [...new Set([...full, ...variants])];
}

/** Whose spending is this? The cardholder named on the statement, else the account's owner. */
export function txOwner(t, accountsById) {
  return (t.cardholder && personForName(t.cardholder)) || ownerOf(accountsById[t.accountId]);
}

/** Which accounts and transactions the current view covers. */
function applyView(allTxs, allAccounts) {
  const scope = state.settings.scope;
  const from = state.settings.trackFrom;
  // Accounts you've chosen not to count (investments, someone else's pot) are kept but left out of every number.
  const inScope = scope === 'all' ? allAccounts : allAccounts.filter((a) => ownerOf(a) === scope);
  const accounts = inScope.filter((a) => !a.excluded && a.type !== 'investment');
  state.excludedAccounts = inScope.filter((a) => a.excluded || a.type === 'investment');
  const excludedIds = new Set(allAccounts.filter((a) => a.excluded || a.type === 'investment').map((a) => a.id));
  const ids = new Set(accounts.map((a) => a.id));
  const known = new Set(allAccounts.map((a) => a.id));
  state.hiddenCount = from ? allTxs.filter((t) => t.date < from).length : 0;
  state.allAccounts = allAccounts;
  state.allTxs = allTxs;
  state.accounts = accounts;
  const byId = Object.fromEntries(allAccounts.map((a) => [a.id, a]));
  // A person's view includes their purchases on a shared card (by cardholder), and excludes
  // other cardholders' purchases on their own card.
  state.txs = allTxs.filter((t) => {
    if (from && t.date < from) return false;
    if (excludedIds.has(t.accountId)) return false;
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

/** A temporary income (e.g. maternity pay) that's active this month, if any. */
export function activeTempIncome(personId, today = todayISO()) {
  const t = state.settings.tempIncome?.[personId];
  const m = monthKey(today);
  return t && t.monthly && (!t.from || m >= t.from) && (!t.until || m <= t.until) ? t : null;
}

/** A person's monthly income right now: temporary income while it lasts, else their usual income. */
export function personIncome(personId) {
  const temp = activeTempIncome(personId);
  if (temp) return temp.monthly;
  return state.settings.scoped?.[personId]?.income ?? null;
}

/** Average monthly income seen in one person's accounts over their last 3 complete months. */
export function estimatedIncome(personId) {
  const all = state.allTxs || [];
  const byId = Object.fromEntries((state.allAccounts || []).map((a) => [a.id, a]));
  const mine = all.filter((t) => byId[t.accountId] && txOwner(t, byId) === personId && (!state.settings.trackFrom || t.date >= state.settings.trackFrom));
  const cur = monthKey(todayISO());
  const months = [...new Set(mine.map((t) => monthKey(t.date)))].filter((m) => m < cur).sort().slice(-3);
  if (!months.length) return 0;
  const total = mine.filter((t) => months.includes(monthKey(t.date)) && t.category === 'income').reduce((a, t) => a + t.amount, 0);
  return Math.round(total / months.length);
}

/** Settings in force for the current view: each person has their own income, goals and budgets. */
function effectiveSettings() {
  const s = state.settings;
  if (s.scope === 'all') {
    // Household income = everyone's income together (payslip / SA302 / maternity), once each person has one.
    // Household extras (Child Benefit…) always add on top.
    const extra = otherFor(s, monthKey(todayISO()), 'all').reduce((a, x) => a + x.monthly, 0);
    if (s.income == null && s.people.length > 1) {
      const incomes = s.people.map((p) => personIncome(p.id));
      // Anyone without a set income: use the average of what actually arrived in their accounts.
      if (incomes.some((v) => v != null)) return { ...s, income: s.people.reduce((a, p, i) => a + (incomes[i] ?? estimatedIncome(p.id)), 0) + extra };
    }
    if (s.income == null && s.people.length === 1 && personIncome(s.people[0].id) != null) return { ...s, income: personIncome(s.people[0].id) + extra };
    if (s.income != null && extra) return { ...s, income: s.income + extra };
    return s;
  }
  const mine = { ...s, income: null, savingsTarget: null, budgets: {}, cardPayoff: null, payday: null, ...(s.scoped?.[s.scope] || {}) };
  const temp = activeTempIncome(s.scope);
  const extra = otherFor(s, monthKey(todayISO()), s.scope).reduce((a, x) => a + x.monthly, 0);
  const base = temp ? temp.monthly : mine.income;
  return { ...mine, income: base == null ? (extra || null) : base + extra };
}

/** Regular payments you added by hand (e.g. rent not found in statements yet). */
function withManualBills(detected, today) {
  const ids = new Set(state.accounts.map((a) => a.id));
  const names = new Set(detected.map((r) => r.name.toUpperCase()));
  const manual = (state.settings.manualBills || [])
    .filter((b) => (!b.accountId || ids.has(b.accountId) || state.settings.scope === 'all') && !names.has(String(b.name).toUpperCase()))
    .map((b) => ({ key: 'manual|' + b.id, id: b.id, name: b.name, description: b.name, category: b.category || 'bills', amount: b.amount, direction: 'out', accountId: b.accountId || null,
      day: b.day, lastDate: null, nextDue: nextDayOfMonth(today, b.day), months: 0, type: b.type || 'Direct Debit', priceChange: 0, active: true, manual: true }));
  return [...detected, ...manual].sort((a, b) => b.amount - a.amount);
}

export function recompute() {
  clearAnalysisCache(); // data may have changed (categories, imports…)
  const today = todayISO();
  state.eff = effectiveSettings();
  const recurring = withManualBills(detectRecurring(state.txs, { today }), today);
  const detected = detectPayday(recurring);
  const payday = state.eff.payday ?? detected?.day ?? null;
  const byIdAll = Object.fromEntries((state.allAccounts || state.accounts).map((a) => [a.id, a]));
  const gm = goalsMonthly(state.settings.goals || [], state.settings.scope, today, byIdAll);
  const coverage = statementCoverage({ accounts: state.accounts, imports: state.imports, txs: state.txs, today, dismissed: state.settings.coverageDismissed || {}, startMonth: state.settings.trackFrom ? monthKey(state.settings.trackFrom) : null });
  // Months missing a statement from any account: their totals are too low, so averages skip them.
  const incomplete = new Set(coverage.missing.map((m) => m.month));
  const budget = buildBudget(state.txs, { ...state.eff, goalsMonthly: gm }, { today, incomplete });
  const currentAccounts = state.accounts.filter((a) => a.type === 'current' && a.balance != null);
  // A balance older than ~10 days is too stale to trust for the bills check.
  const fresh = currentAccounts.filter((a) => a.balanceDate && daysBetween(a.balanceDate, today) <= 10);
  const balance = fresh.length ? fresh.reduce((s, a) => s + a.balance, 0) : null;
  const cards = cardSummary({ accounts: state.accounts, txs: state.txs, allTxs: state.allTxs, today, trackFrom: state.settings.trackFrom });
  const suspects = suspectedCreditCards(state.accounts, state.txs);
  const duplicates = findStoredDuplicates(state.txs);
  state.derived = { today, coverage, cards, suspects, duplicates, recurring, payday, detectedPayday: detected, budget, balance, staleBalance: currentAccounts.length > 0 && !fresh.length, months: monthsPresent(state.txs), incomplete };
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
      delete t.pairId; delete t.autoTransfer; delete t.cardRepay;
      t.category = categorize(t.description, t.amount, state.settings.userRules);
    }
  }
  const byAcc = Object.fromEntries(allAccounts.map((a) => [a.id, a]));
  const names = [...(state.settings.ownNames || []), ...allPeopleNames()];
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

/**
 * Start fresh: delete accounts, transactions and the import log, but keep people, income,
 * goals, budgets, rules, settings and the cache of Claude's reads (so re-importing is free and quick).
 */
export async function startFresh() {
  await Promise.all(['tx', 'accounts', 'imports'].map((s) => db.clear(s)));
  const keep = { ...state.settings, bankSync: { ...(state.settings.bankSync || {}), links: {}, lastSync: {} }, consolidationDone: {}, coverageDismissed: {}, hiddenBanners: {}, mainAccountId: null };
  await db.kvSet('settings', keep);
  await load();
}

export async function wipeAll() {
  await Promise.all(['tx', 'accounts', 'imports', 'checks', 'kv'].map((s) => db.clear(s)));
  Object.assign(state, { txs: [], accounts: [], imports: [], checks: [], settings: { ...DEFAULT_SETTINGS } });
  recompute();
}

export const accountName = (id) => state.accounts.find((a) => a.id === id)?.name ?? 'Unknown account';

/**
 * Put every payment from a merchant (all months, everyone's accounts) in a category, and remember it
 * so future imports use it too. Money in and money out are kept apart unless `bothWays`.
 */
export async function applyMerchantCategory(merchant, category, { direction = null } = {}) {
  const all = state.allTxs || state.txs;
  const targets = all.filter((t) => (t.merchant || merchantKey(t.description)) === merchant && (!direction || (direction === 'out' ? t.amount < 0 : t.amount > 0)));
  for (const t of targets) { t.category = category; t.userCategory = true; delete t.autoTransfer; delete t.pairId; }
  await db.putMany('tx', targets);
  await saveSettings({ userRules: { ...state.settings.userRules, [merchant]: category } });
  recompute();
  return targets.length;
}

/** Total take-home in any month (with maternity ending, Child Benefit starting…), for the current view. */
export function incomeFor(month) {
  const s = state.settings;
  if (s.scope === 'all' && s.income != null) return s.income + otherFor(s, month, 'all').reduce((a, x) => a + x.monthly, 0);
  return householdFor(s, month, { scope: s.scope === 'joint' ? 'all' : s.scope, estimate: estimatedIncome }).total;
}
