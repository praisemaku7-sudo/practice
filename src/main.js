import './styles.css';
import { state, load, recompute, relinkTransfers, saveSettings, removeSummaryLines } from './state.js';
import { db, requestPersistence } from './lib/db.js';
import { toTransactions } from './lib/importer.js';
import { demoData } from './lib/demo.js';
import { monthKey } from './lib/dates.js';
import { $, closeSheet, toast, confirmSheet } from './ui/dom.js';
import { pickFiles, addFiles, onQueueChange } from './ui/import.js';
import * as home from './ui/views/home.js';
import * as budget from './ui/views/budget.js';
import * as afford from './ui/views/afford.js';
import * as insights from './ui/views/insights.js';
import * as accounts from './ui/views/accounts.js';
import * as transactions from './ui/views/transactions.js';
import * as settings from './ui/views/settings.js';
import * as history from './ui/views/history.js';
import * as importer from './ui/views/importer.js';
import * as checkin from './ui/views/checkin.js';
import * as bills from './ui/views/bills.js';
import * as cards from './ui/views/cards.js';
import * as setup from './ui/views/setup.js';
import * as audit from './ui/views/audit.js';

const VIEWS = { home, budget, afford, insights, accounts, transactions, settings, history, import: importer, checkin, bills, cards, setup, audit };
const TITLES = { home: 'Overview', budget: 'Budget', afford: 'Afford?', insights: 'Insights', accounts: 'Accounts', transactions: 'Transactions', settings: 'Settings', history: 'Monthly record', import: 'Import', checkin: 'Monthly check-in', bills: 'Bills & subscriptions', cards: 'Credit cards', setup: 'Fix accounts', audit: 'Check my numbers' };
let current = 'home';

function parseHash() {
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
  return { view: VIEWS[path] ? path : 'home', params: new URLSearchParams(query || '') };
}

let pendingRender = false;
async function render() {
  const view = VIEWS[current];
  if (view.preload) await view.preload();
  const main = $('#main');
  main.innerHTML = view.render();
  main.dataset.view = current;
  document.title = `${TITLES[current]} · Pocket Ledger`;
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.view === current || (['transactions', 'history', 'checkin', 'bills', 'import', 'cards', 'audit'].includes(current) && a.dataset.view === 'home') || (current === 'setup' && a.dataset.view === 'accounts')));
}

async function route() {
  const { view, params } = parseHash();
  const changed = view !== current;
  current = view;
  VIEWS[view].applyParams?.(params);
  closeSheet();
  const main = $('#main');
  if (changed) { main.classList.add('enter'); setTimeout(() => main.classList.remove('enter'), 300); }
  await render();
  if (changed) window.scrollTo(0, 0);
}

const globalActions = {
  'close-sheet': () => closeSheet(),
  'banner-hide': async (el) => {
    await saveSettings({ hiddenBanners: { ...(state.settings.hiddenBanners || {}), [el.dataset.key]: el.dataset.sig } });
    render();
  },
  'set-month': (el) => { if (el.dataset.month) { state.month = el.dataset.month; render(); } },
  go: (el) => {
    const q = el.dataset.cat ? `?cat=${el.dataset.cat}` : '';
    location.hash = `#/${el.dataset.to}${q}`;
  },
  import: () => pickFiles(),
  'load-demo': async () => {
    if (state.txs.length && !(await confirmSheet({ title: 'Load sample data?', body: 'Adds 5 months of made-up transactions across 4 sample accounts. You can delete them later from Accounts.', ok: 'Load' }))) return;
    const { accounts: accs, rows, balances } = demoData(state.derived.today);
    const txs = [];
    for (const a of accs) {
      a.balance = balances[a.id];
      a.balanceDate = state.derived.today;
      txs.push(...toTransactions(rows.filter((r) => r.accountId === a.id), { accountId: a.id, importId: 'demo', source: 'demo', userRules: state.settings.userRules }));
    }
    await db.putMany('accounts', accs);
    await db.putMany('tx', txs);
    await load();
    await relinkTransfers();
    recompute();
    state.month = monthKey(state.derived.today);
    toast('Sample data loaded');
    render();
  },
};

const allActions = Object.assign({}, globalActions, ...Object.values(VIEWS).map((v) => v.actions || {}));
const allChanges = Object.assign({}, ...Object.values(VIEWS).map((v) => v.changes || {}));
const allInputs = Object.assign({}, ...Object.values(VIEWS).map((v) => v.inputs || {}));

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = allActions[el.dataset.action];
  if (!fn) return;
  ev.preventDefault();
  Promise.resolve(fn(el, render)).catch((e) => { console.error(e); toast(e.message || String(e), { error: true }); });
});
document.addEventListener('change', (ev) => {
  const el = ev.target.closest('[data-change]');
  const fn = el && allChanges[el.dataset.change];
  if (fn) Promise.resolve(fn(el, render)).catch((e) => toast(e.message, { error: true }));
});
// Debounce per field, so typing quickly across several fields never drops one.
const inputTimers = new Map();
document.addEventListener('input', (ev) => {
  const el = ev.target.closest('[data-input]');
  const fn = el && allInputs[el.dataset.input];
  if (!fn) return;
  const key = `${el.dataset.input}|${el.dataset.id || ''}`;
  clearTimeout(inputTimers.get(key));
  inputTimers.set(key, setTimeout(() => { inputTimers.delete(key); fn(el, render); }, 200));
});
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeSheet(); });

// Let files dropped onto the page (desktop) import directly.
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const files = [...(e.dataTransfer?.files || [])];
  if (files.length) addFiles(files);
});

window.addEventListener('hashchange', route);

// Live import progress: redraw the Import page as files finish, but never while you're typing.
let raf = 0;
onQueueChange(() => {
  if (current !== 'import') return;
  const el = document.activeElement;
  if (el && el.tagName === 'INPUT' && $('#main').contains(el)) { pendingRender = true; return; }
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => render());
});
document.addEventListener('focusout', () => { if (pendingRender) { pendingRender = false; setTimeout(render, 0); } });

(async function boot() {
  try {
    await load();
  } catch (e) {
    $('#main').innerHTML = `<div class="card alert">Storage is unavailable (${e.message}). Private Browsing blocks it. Open in normal Safari.</div>`;
    return;
  }
  requestPersistence();
  // One-off: re-run transfer detection on existing data when the rules improve.
  if ((state.settings.junkCleanVersion || 0) < 1) {
    const junk = await removeSummaryLines();
    await saveSettings({ junkCleanVersion: 1 });
    if (junk.length) {
      recompute();
      setTimeout(() => toast(`Removed ${junk.length} statement summary line${junk.length > 1 ? 's' : ''} (e.g. "${junk[0].description.slice(0, 24)}") that were wrongly counted as payments`), 600);
    }
  }
  if (state.txs.length && (state.settings.transferRulesVersion || 1) < 2) {
    await relinkTransfers();
    await saveSettings({ transferRulesVersion: 2 });
  }
  await route();
  // Warm up the PDF engine in the background so the first import starts instantly.
  (window.requestIdleCallback || ((f) => setTimeout(f, 1500)))(() => import('./lib/parse/pdf.js'));
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
