import './styles.css';
import { state, load, recompute, relinkTransfers } from './state.js';
import { db, requestPersistence } from './lib/db.js';
import { toTransactions } from './lib/importer.js';
import { demoData } from './lib/demo.js';
import { monthKey } from './lib/dates.js';
import { $, closeSheet, toast, confirmSheet } from './ui/dom.js';
import { pickFiles, importFiles } from './ui/import.js';
import * as home from './ui/views/home.js';
import * as budget from './ui/views/budget.js';
import * as afford from './ui/views/afford.js';
import * as insights from './ui/views/insights.js';
import * as accounts from './ui/views/accounts.js';
import * as transactions from './ui/views/transactions.js';
import * as settings from './ui/views/settings.js';

const VIEWS = { home, budget, afford, insights, accounts, transactions, settings };
const TITLES = { home: 'Overview', budget: 'Budget', afford: 'Afford?', insights: 'Insights', accounts: 'Accounts', transactions: 'Transactions', settings: 'Settings' };
let current = 'home';

function parseHash() {
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
  return { view: VIEWS[path] ? path : 'home', params: new URLSearchParams(query || '') };
}

async function render() {
  const view = VIEWS[current];
  if (view.preload) await view.preload();
  const main = $('#main');
  main.innerHTML = view.render();
  document.title = `${TITLES[current]} · Pocket Ledger`;
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.view === current || (current === 'transactions' && a.dataset.view === 'home')));
}

async function route() {
  const { view, params } = parseHash();
  const changed = view !== current;
  current = view;
  VIEWS[view].applyParams?.(params);
  closeSheet();
  await render();
  if (changed) window.scrollTo(0, 0);
}

const globalActions = {
  'close-sheet': () => closeSheet(),
  'set-month': (el) => { if (el.dataset.month) { state.month = el.dataset.month; render(); } },
  go: (el) => {
    const q = el.dataset.cat ? `?cat=${el.dataset.cat}` : '';
    location.hash = `#/${el.dataset.to}${q}`;
  },
  import: () => pickFiles(render),
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
let inputTimer;
document.addEventListener('input', (ev) => {
  const el = ev.target.closest('[data-input]');
  const fn = el && allInputs[el.dataset.input];
  if (!fn) return;
  clearTimeout(inputTimer);
  inputTimer = setTimeout(() => fn(el, render), 200);
});
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeSheet(); });

// Let files dropped onto the page (desktop) import directly.
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const files = [...(e.dataTransfer?.files || [])];
  if (files.length) importFiles(files, render);
});

window.addEventListener('hashchange', route);

(async function boot() {
  try {
    await load();
  } catch (e) {
    $('#main').innerHTML = `<div class="card alert">Storage is unavailable (${e.message}). Private Browsing blocks it. Open in normal Safari.</div>`;
    return;
  }
  requestPersistence();
  await route();
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
