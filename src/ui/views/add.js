// Quick add, built for an iPhone Shortcuts "Transaction" automation: every Apple Pay payment
// opens …/#/add?amount=[Amount]&merchant=[Merchant]&card=[Card] and is logged instantly.
// It's replaced by the real transaction when the statement or bank sync arrives.
import { state, recompute } from '../../state.js';
import { db } from '../../lib/db.js';
import { esc, toast } from '../dom.js';
import { fmt, parsePrice } from '../../lib/money.js';
import { categorize, merchantKey } from '../../lib/categorize.js';
import { catName } from '../../lib/categories.js';
import { todayISO } from '../../lib/dates.js';

let last = null; // the transaction just logged, for the confirmation screen

function accountFor(card) {
  const c = String(card || '').toLowerCase();
  const all = state.allAccounts || state.accounts;
  const words = c.split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  return all.find((a) => c && (a.name.toLowerCase().includes(c) || c.includes(a.name.toLowerCase())))
    || all.find((a) => words.some((w) => `${a.name} ${a.bank || ''}`.toLowerCase().includes(w)))
    || all.find((a) => a.id === state.settings.mainAccountId)
    || all.find((a) => a.type === 'current');
}

/** Save one Apple Pay purchase as a quick entry (swapped for the real one when it arrives). */
export async function logPurchase({ amount, merchant = 'Apple Pay', card = '', date = todayISO(), id = null }) {
  const pence = parsePrice(String(amount).replace(/[^\d.,-]/g, '').replace(/^-/, ''));
  if (!pence) return null;
  const txId = id ? `ap-${id}` : `sc-${Date.now().toString(36)}`;
  if (state.txs.some((t) => t.id === txId) || (await db.get('tx', txId))) return null;
  const acc = accountFor(card);
  const tx = {
    id: txId, accountId: acc?.id || 'manual', importId: null, source: 'shortcut', manual: true,
    date, description: merchant.slice(0, 80), merchant: merchantKey(merchant), amount: -pence, balance: null,
    category: categorize(merchant, -pence, state.settings.userRules),
  };
  state.txs.push(tx);
  await db.put('tx', tx);
  return { tx, account: acc?.name || 'your account' };
}

export async function applyParams(params) {
  const raw = params.get('amount');
  if (!raw) return;
  const pence = parsePrice(String(raw).replace(/[^\d.,-]/g, '').replace(/^-/, ''));
  const merchant = (params.get('merchant') || params.get('name') || 'Apple Pay').slice(0, 80);
  const card = params.get('card') || '';
  if (!pence) { toast("Couldn't read the amount from the Shortcut", { error: true }); return; }
  // The same Shortcut run opening twice must not log twice.
  const key = `${pence}|${merchant}|${card}|${new Date().toISOString().slice(0, 16)}`;
  const seen = (await db.kvGet('shortcutSeen', [])).slice(-50);
  history.replaceState(null, '', '#/add');
  if (seen.includes(key)) return;
  await db.kvSet('shortcutSeen', [...seen, key]);
  const acc = accountFor(card);
  const tx = {
    id: 'sc-' + Date.now().toString(36), accountId: acc?.id || 'manual', importId: null, source: 'shortcut', manual: true,
    date: todayISO(), description: merchant, merchant: merchantKey(merchant), amount: -pence, balance: null,
    category: categorize(merchant, -pence, state.settings.userRules),
  };
  if (tx.category === 'income' || tx.category === 'other') tx.category = categorize(merchant, -pence, state.settings.userRules);
  state.txs.push(tx);
  await db.put('tx', tx);
  recompute();
  last = { tx, account: acc?.name || 'your account' };
}

export function render() {
  if (!last) {
    return `<h1 class="page-title">Quick add</h1><div class="card"><p class="muted">This page logs Apple Pay purchases automatically. Set it up once in Settings → Auto-log Apple Pay.</p><a class="btn primary full" href="#/settings">Set it up</a></div>`;
  }
  const { tx, account } = last;
  return `<h1 class="page-title">Logged ✓</h1>
  <div class="card hero feature">
    <div class="label">${esc(tx.description)} · ${esc(account)}</div>
    <div class="big">${fmt(-tx.amount)}</div>
    <div class="sub">${esc(catName(tx.category))} · ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
  </div>
  <p class="sub center">It'll be swapped for the real transaction when your statement or bank sync arrives. You can close the app.</p>
  <div class="row gap"><button class="btn ghost grow" data-action="add-undo">Undo</button><a class="btn primary grow" href="#/home">Overview</a></div>`;
}

export const actions = {
  'add-undo': async () => {
    if (!last) return;
    await db.del('tx', last.tx.id);
    state.txs = state.txs.filter((t) => t.id !== last.tx.id);
    recompute();
    last = null;
    toast('Removed');
    location.hash = '#/home';
  },
};
