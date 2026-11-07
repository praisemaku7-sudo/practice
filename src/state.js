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
  cardPayoff: null,      // pence/month extra toward credit cards
  cardMethod: 'avalanche',
  bufferPence: 5000,     // keep at least £50 after bills
};

export const state = {
  txs: [], accounts: [], imports: [], checks: [],
  settings: { ...DEFAULT_SETTINGS },
  month: monthKey(todayISO()),
  derived: null,
};

export async function load() {
  const [txs, accounts, imports, checks, settings] = await Promise.all([
    db.all('tx'), db.all('accounts'), db.all('imports'), db.all('checks'), db.kvGet('settings', {}),
  ]);
  state.settings = { ...DEFAULT_SETTINGS, ...settings };
  if (settings.useAIForPDF === false && !settings.pdfMode) state.settings.pdfMode = 'never';
  state.settings.wishlist = state.settings.wishlist || [];
  const from = state.settings.trackFrom;
  // Older transactions stay stored (so changing the date back restores them) but are hidden everywhere.
  state.hiddenCount = from ? txs.filter((t) => t.date < from).length : 0;
  Object.assign(state, { txs: from ? txs.filter((t) => t.date >= from) : txs, accounts, imports, checks: checks.sort((a, b) => b.at - a.at) });
  recompute();
  const months = monthsPresent(state.txs);
  if (months.length && !months.includes(state.month)) state.month = months[months.length - 1];
}

export function recompute() {
  const today = todayISO();
  const recurring = detectRecurring(state.txs, { today });
  const detected = detectPayday(recurring);
  const payday = state.settings.payday ?? detected?.day ?? null;
  const budget = buildBudget(state.txs, state.settings, { today });
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
  state.settings = { ...state.settings, ...patch };
  await db.kvSet('settings', state.settings);
  recompute();
}

/** Re-run transfer pairing over everything and persist any category changes. */
export async function relinkTransfers() {
  const before = new Map(state.txs.map((t) => [t.id, t.category + '|' + (t.pairId || '')]));
  for (const t of state.txs) {
    if (t.pairId && !t.userCategory) {
      delete t.pairId;
      t.category = categorize(t.description, t.amount, state.settings.userRules);
    }
  }
  const byAcc = Object.fromEntries(state.accounts.map((a) => [a.id, a]));
  markTransfers(state.txs, byAcc);
  const changed = state.txs.filter((t) => before.get(t.id) !== t.category + '|' + (t.pairId || ''));
  if (changed.length) await db.putMany('tx', changed);
}

export async function wipeAll() {
  await Promise.all(['tx', 'accounts', 'imports', 'checks', 'kv'].map((s) => db.clear(s)));
  Object.assign(state, { txs: [], accounts: [], imports: [], checks: [], settings: { ...DEFAULT_SETTINGS } });
  recompute();
}

export const accountName = (id) => state.accounts.find((a) => a.id === id)?.name ?? 'Unknown account';
