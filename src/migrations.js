// One-off data upgrades. Each runs once, when a phone's saved data predates a fix to how statements
// are read or sorted, and records its version in settings so it never runs again. Kept (not deleted)
// so an older backup can still be restored and brought up to date.
import { state, load, recompute, relinkTransfers, saveSettings, removeSummaryLines } from './state.js';
import { db } from './lib/db.js';
import { categorize } from './lib/categorize.js';
import { toast } from './ui/dom.js';

/** Run any upgrades this phone's data hasn't had yet. `render` redraws the page after big fixes. */
export async function runMigrations(render) {
  // One-off: re-run transfer detection on existing data when the rules improve.
  if ((state.settings.junkCleanVersion || 0) < 2) {
    const junk = await removeSummaryLines();
    await saveSettings({ junkCleanVersion: 2 });
    if (junk.length) {
      recompute();
      setTimeout(() => toast(`Removed ${junk.length} statement summary line${junk.length > 1 ? 's' : ''} (e.g. "${junk[0].description.slice(0, 24)}") that were wrongly counted as payments`), 600);
    }
  }
  if (state.txs.length && (state.settings.transferRulesVersion || 1) < 6) {
    // Moves between your own money ("MB STARLING", Revolut pockets) were counted as spending, and
    // could even have been accepted as bills. They're transfers whatever was chosen before.
    const all6 = await db.all('tx');
    const moved = [];
    const rules = { ...(state.settings.userRules || {}) };
    for (const t of all6) {
      if (t.category === 'transfer' || categorize(t.description, t.amount, {}) !== 'transfer') continue;
      t.category = 'transfer'; t.userCategory = false; moved.push(t);
      if (t.merchant && rules[t.merchant] && rules[t.merchant] !== 'transfer') delete rules[t.merchant];
    }
    if (moved.length) { await db.putMany('tx', moved); await saveSettings({ userRules: rules }); setTimeout(() => toast(`${moved.length} moves between your own accounts (bank-app transfers, pockets) are no longer counted as spending`), 900); }
  }
  if (state.txs.length && (state.settings.transferRulesVersion || 1) < 6) {
    // Re-sort anything still "Other" with the improved rules (e.g. rent to letting agents), then
    // re-check transfers (names, aliases, savings, card repayments). Your own choices are kept.
    const all = await db.all('tx');
    const fixed = [];
    for (const t of all) {
      if (t.category !== 'other' || t.userCategory) continue;
      const c = categorize(t.description, t.amount, state.settings.userRules);
      if (c !== 'other') { t.category = c; fixed.push(t); }
    }
    if (fixed.length) await db.putMany('tx', fixed);
    await relinkTransfers();
    await saveSettings({ transferRulesVersion: 6 });
  }
  if (state.txs.length && (state.settings.transferRulesVersion || 1) < 7) {
    // Card repayments ("OBP AMERICAN EXP") counted as spending even though the card statement is
    // imported (purchases counted twice). Applies even where a suggested category was accepted.
    const all7 = await db.all('tx');
    const accs = Object.fromEntries((await db.all('accounts')).map((a) => [a.id, a]));
    const { cardWordsFor, isCardRepayment, CARD_ALIASES_PUBLIC } = await import('./lib/analysis.js');
    const words = cardWordsFor(accs, CARD_ALIASES_PUBLIC);
    const fixed = [];
    for (const t of all7) if (accs[t.accountId]?.type !== 'credit' && isCardRepayment(t, words)) { t.category = 'transfer'; t.userCategory = false; t.autoTransfer = true; t.cardRepay = true; fixed.push(t); }
    if (fixed.length) { await db.putMany('tx', fixed); setTimeout(() => toast(`${fixed.length} credit card repayments no longer counted as spending (the card purchases already are)`), 1200); }
    await relinkTransfers();
    await saveSettings({ transferRulesVersion: 7 });
  }
  if (state.txs.length && (state.settings.transferRulesVersion || 1) < 8) {
    // Savings interest stays in savings: not spendable household income (re-checked by relink).
    await relinkTransfers();
    await saveSettings({ transferRulesVersion: 8 });
  }
  if (state.txs.length && (state.settings.transferRulesVersion || 1) < 9) {
    // Improved rules (e.g. "SAINSBURYS"): re-sort anything still in Other that you haven't chosen yourself.
    const all9 = await db.all('tx');
    const fixed9 = [];
    for (const t of all9) {
      if (t.category !== 'other' || t.userCategory) continue;
      const c = categorize(t.description, t.amount, state.settings.userRules);
      if (c !== 'other') { t.category = c; fixed9.push(t); }
    }
    if (fixed9.length) { await db.putMany('tx', fixed9); setTimeout(() => toast(`${fixed9.length} payments moved out of Other into proper categories`), 1500); }
    await relinkTransfers();
    await saveSettings({ transferRulesVersion: 9 });
  }
  if (state.txs.length && (state.settings.transferRulesVersion || 1) < 10) {
    // Reading fixes (Nov 2026): foreign-currency lines ("Revolut Rate … 2,561.00 TRY") were saved as
    // sterling payments, and a statement could create a second copy of an account typed differently.
    const all10 = await db.all('tx');
    const fx = all10.filter((t) => !t.manual && /\b(REVOLUT RATE|ECB RATE\*?)\b/i.test(t.description));
    for (const t of fx) await db.del('tx', t.id);
    const accs = await db.all('accounts');
    const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const key = (a) => (a.ref || a.details?.last4) && a.bank ? `${norm(a.bank)}|${a.ref || a.details?.last4}` : null;
    const groups = {};
    for (const a of accs) { const k = key(a); if (k) (groups[k] ||= []).push(a); }
    let merged = 0;
    const left = all10.filter((t) => !fx.includes(t));
    for (const list of Object.values(groups)) {
      if (list.length < 2) continue;
      const count = (a) => left.filter((t) => t.accountId === a.id).length;
      const keep = list.find((a) => a.typeLocked) || list.sort((x, y) => count(y) - count(x))[0];
      for (const dup of list.filter((a) => a !== keep && !a.typeLocked)) {
        const moved = left.filter((t) => t.accountId === dup.id);
        const have = new Set(left.filter((t) => t.accountId === keep.id).map((t) => `${t.date}|${t.amount}|${t.description}`));
        for (const t of moved) { if (have.has(`${t.date}|${t.amount}|${t.description}`)) await db.del('tx', t.id); else { t.accountId = keep.id; await db.put('tx', t); } }
        for (const i of state.imports.filter((x) => x.accountId === dup.id)) { i.accountId = keep.id; await db.put('imports', i); }
        await db.del('accounts', dup.id); merged++;
      }
    }
    // "BP <payee>" (HSBC bill payment) was read as BP fuel: re-sort rows with a bank payment code
    // that you haven't categorised yourself.
    const all10b = await db.all('tx');
    const resorted = [];
    for (const t of all10b) {
      if (t.userCategory || t.pairId || t.autoTransfer || !/^\s*(BP|CR|DR|DD|SO|STO|VIS|\)\)\)|OBP|TFR)\s/i.test(t.description)) continue;
      const c = categorize(t.description, t.amount, state.settings.userRules);
      if (c !== t.category) { t.category = c; resorted.push(t); }
    }
    if (resorted.length) await db.putMany('tx', resorted);
    await saveSettings({ transferRulesVersion: 10 });
    if (fx.length || merged) { await load(); setTimeout(() => toast(`Fixed: ${fx.length} foreign-currency lines that were counted as payments removed${merged ? `, ${merged} duplicate account${merged > 1 ? 's' : ''} merged` : ''}. Re-import statements listed on the Import page.`), 1800); }
    await relinkTransfers();
  }
  if (state.txs.length && (state.settings.categoryRulesVersion || 0) < 1) {
    // Better category rules (Nov 2026): re-sort everything you haven't categorised yourself, so
    // existing rows benefit too (e.g. workplace cafés, venues, "My O2" bills, a pub called Under Water).
    const all = await db.all('tx');
    const resorted = [];
    for (const t of all) {
      if (t.userCategory || t.pairId || t.autoTransfer || t.cardRepay || ['transfer', 'savings', 'excluded'].includes(t.category)) continue;
      const c = categorize(t.description, t.amount, state.settings.userRules);
      if (c !== t.category && c !== 'transfer') { t.category = c; resorted.push(t); }
    }
    if (resorted.length) await db.putMany('tx', resorted);
    await saveSettings({ categoryRulesVersion: 1 });
    if (resorted.length) await load();
  }
}
