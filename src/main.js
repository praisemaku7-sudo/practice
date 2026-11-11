import './styles.css';
import { state, load, recompute, relinkTransfers, saveSettings, removeSummaryLines, setScope, scopeLabel, ownerOf } from './state.js';
import { db, requestPersistence } from './lib/db.js';
import { toTransactions } from './lib/importer.js';
import { runMigrations } from './migrations.js';
import { demoData } from './lib/demo.js';
import { monthKey } from './lib/dates.js';
import { $, closeSheet, toast, confirmSheet, openSheet, esc } from './ui/dom.js';
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
import * as due from './ui/views/due.js';
import * as goals from './ui/views/goals.js';
import { initLock, lockActions } from './ui/lock.js';
import { enhanceSections, sectionActions } from './ui/sections.js';
import { insightActions } from './ui/insight-actions.js';
import { dashActions } from './ui/dashboard.js';
import { alertActions, updateBell } from './ui/alerts.js';
import { extrasActions } from './ui/overview-extras.js';
import { affordActions, affordChanges } from './ui/afford-extras.js';
import { billsExtraActions, billsExtraInputs } from './ui/bills-extras.js';
import { movePlanActions } from './ui/move-plan.js';
import { cockpitActions } from './ui/cockpit.js';
import { menuActions, menuInputs, closeMenu, menuIsOpen, setMenuCurrent, applyTheme } from './ui/menu.js';
import * as sync from './ui/views/sync.js';
import * as add from './ui/views/add.js';
import * as plan from './ui/views/plan.js';
import * as categories from './ui/views/categories.js';
import * as track from './ui/views/track.js';
import * as income from './ui/views/income.js';
import * as movebills from './ui/views/movebills.js';
import * as spending from './ui/views/spending.js';
import * as numbers from './ui/views/numbers.js';

const VIEWS = { home, budget, afford, insights, accounts, transactions, settings, history, import: importer, checkin, bills, cards, setup, audit, due, goals, sync, add, plan, categories, track, income, movebills, spending, numbers };
// Which tab each sub-page belongs to: highlights that tab, and is where Back goes with no history.
const PARENT = { transactions: 'home', history: 'home', checkin: 'home', bills: 'home', import: 'home', cards: 'home', audit: 'home', due: 'home', goals: 'home', settings: 'home', add: 'home', setup: 'accounts', sync: 'accounts', plan: 'track', categories: 'insights', budget: 'track', income: 'track', movebills: 'accounts', spending: 'home', numbers: 'home' };
const ROOTS = new Set(['home', 'track', 'afford', 'insights', 'accounts']);
// Pages visited inside the app this session, so Back returns to where you were (not out of the app).
let navDepth = 0, goingBack = false;
const TITLES = { home: 'Overview', budget: 'Budget', afford: 'Afford?', insights: 'Insights', accounts: 'Accounts', transactions: 'Transactions', settings: 'Settings', history: 'Monthly record', import: 'Import', checkin: 'Monthly check-in', bills: 'Bills & subscriptions', cards: 'Credit cards', setup: 'Fix accounts', audit: 'Check my numbers', due: 'Due soon', goals: 'Savings goals', sync: 'Bank sync', add: 'Quick add', plan: 'Future planning', categories: 'Categories', track: 'On track', income: 'Income', movebills: 'Move bills', spending: 'Spending', numbers: 'Your numbers' };
let current = 'home';

function parseHash() {
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
  return { view: VIEWS[path] ? path : 'home', params: new URLSearchParams(query || '') };
}

// Each page says, in one line under its title, what it's for.
const PURPOSE = {
  spending: 'Where your money goes, and how it compares.',
  bills: 'Every regular payment: when it leaves, what it costs, what to cancel.',
  due: 'What leaves your accounts in the next few days.',
  track: 'Whether your income covers everything, now and after the move.',
  budget: 'What each part of your month is allowed.',
  income: 'What comes in each month, and when it changes.',
  plan: 'Your mortgage: the deal, the dates, and being ready.',
  goals: 'What you are saving for, and when you will get there.',
  afford: 'Check a purchase before you make it.',
  insights: 'The changes that would make the most difference.',
  categories: 'How your spending is sorted, and fixing what isn\'t.',
  cards: 'What you owe on cards, and the fastest way to clear it.',
  audit: 'Make sure every figure in the app is right.',
  accounts: 'Every account and card, and getting them into one place.',
  transactions: 'Every payment in and out. Search, filter, recategorise.',
  history: 'Each month side by side.',
  numbers: 'Every figure as a tile. Tap one for its chart.',
  movebills: 'Get every bill paid from one account.',
  settings: 'People, privacy, backups and connections.',
  import: 'Add statements, payslips and screenshots.',
  checkin: 'A ten-minute routine once a month.',
};
function addPurpose(main, view) {
  const h1 = main.querySelector('h1.page-title');
  if (!h1 || !PURPOSE[view] || main.querySelector('.page-purpose')) return;
  const p = document.createElement('p');
  p.className = 'page-purpose';
  p.textContent = PURPOSE[view];
  (h1.closest('.acc-headrow') || h1).after(p);
}

let pendingRender = false;
async function render() {
  const view = VIEWS[current];
  if (view.preload) await view.preload();
  const main = $('#main');
  main.innerHTML = view.render();
  addPurpose(main, current);
  enhanceSections(main, current);
  const sb = $('#scope-btn');
  if (sb) {
    const multi = state.settings.people.length > 1 || state.allAccounts?.some((a) => a.owner === 'joint');
    sb.hidden = !multi;
    const p = state.settings.people.find((x) => x.id === state.settings.scope);
    sb.textContent = state.settings.scope === 'all' ? '🏠' : state.settings.scope === 'joint' ? '👥' : (p?.name || '?').slice(0, 1).toUpperCase();
    sb.title = state.settings.scope === 'all' ? 'Household' : state.settings.scope === 'joint' ? 'Joint' : p?.name || '';
    sb.setAttribute('aria-label', `Showing: ${sb.title}. Change`);
    sb.style.setProperty('--pc', p?.color || 'var(--accent)');
  }
  main.dataset.view = current;
  updateBell();
  setMenuCurrent(current);
  document.title = `${TITLES[current]} · Pocket Ledger`;
  // Which tab is highlighted for pages that aren't tabs themselves.
  const back = $('#back-btn');
  if (back) { const root = ROOTS.has(current); back.hidden = root; document.body.classList.toggle('sub-page', !root); back.setAttribute('aria-label', `Back to ${TITLES[PARENT[current] || 'home']}`); }
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.view === (PARENT[current] || current)));
}

async function route(e) {
  if (e?.type === 'hashchange') { if (goingBack) { goingBack = false; navDepth = Math.max(0, navDepth - 1); } else navDepth++; }
  const { view, params } = parseHash();
  const changed = view !== current;
  current = view;
  await VIEWS[view].applyParams?.(params);
  closeSheet(); closeMenu();
  // Importing and fixing accounts always work on the whole household, so nothing is hidden.
  if (['import', 'setup', 'income'].includes(view) && state.settings.scope !== 'all') {
    await setScope('all');
    toast('Showing the whole household while you import or fix accounts');
  }
  const main = $('#main');
  if (changed) { main.classList.add('enter'); setTimeout(() => main.classList.remove('enter'), 300); }
  await render();
  if (changed) window.scrollTo(0, 0);
}

const globalActions = {
  'close-sheet': () => closeSheet(),
  'nav-back': () => {
    if (navDepth > 0) { goingBack = true; window.history.back(); } else location.hash = '#/' + (PARENT[current] || 'home');
  },
  'scope-pick': () => {
    const opts = [['all', '🏠 Household', 'Everyone together'], ...state.settings.people.map((p) => [p.id, `● ${p.name}`, 'Only their accounts']),
      ...(state.allAccounts?.some((a) => a.owner === 'joint') ? [['joint', '👥 Joint', 'Joint accounts only']] : [])];
    openSheet(`<h2>Whose money?</h2><p class="muted">Every screen (overview, budget, insights, cards, bills, history) follows this.</p>
      ${opts.map(([id, label, sub]) => `<button class="list-row tap scope-opt ${state.settings.scope === id ? 'sel' : ''}" data-action="scope-set" data-scope="${esc(id)}"><div class="grow"><b>${esc(label)}</b><div class="sub">${esc(sub)} · ${(state.allAccounts || []).filter((a) => id === 'all' || ownerOf(a) === id).length} accounts</div></div>${state.settings.scope === id ? '✓' : ''}</button>`).join('')}
      <a class="btn ghost full" href="#/settings" data-action="close-sheet-go" data-to="settings">Add or rename people</a>`);
  },
  'scope-set': async (el) => { closeSheet(); closeMenu(); await setScope(el.dataset.scope); render(); toast(`Showing ${scopeLabel()}`); },
  'close-sheet-go': (el) => { closeSheet(); location.hash = '#/' + el.dataset.to; },
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

const allActions = Object.assign({}, globalActions, lockActions, sectionActions, insightActions, menuActions, dashActions, alertActions, extrasActions, affordActions, billsExtraActions, movePlanActions, cockpitActions, ...Object.values(VIEWS).map((v) => v.actions || {}));
const allChanges = Object.assign({}, affordChanges, ...Object.values(VIEWS).map((v) => v.changes || {}));
const allInputs = Object.assign({}, menuInputs, billsExtraInputs, ...Object.values(VIEWS).map((v) => v.inputs || {}));

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
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') { closeSheet(); closeMenu(); }
  // Enter in "Find a page" opens the first match.
  if (ev.key === 'Enter' && ev.target.id === 'menu-q') {
    ev.preventDefault();
    const q = ev.target.value.trim().toLowerCase();
    const hit = [...document.querySelectorAll('.menu-item')].find((a) => !q || a.dataset.q.includes(q));
    if (hit) { closeMenu(); location.hash = '#/' + hit.dataset.to; }
  }
});

// Swipe in from the left edge to go back on sub-pages (like Safari's back gesture).
let edge = null;
document.addEventListener('touchstart', (e) => {
  const t = e.touches[0];
  edge = e.touches.length === 1 && t.clientX < 28 && document.body.classList.contains('sub-page') && !menuIsOpen() && !document.querySelector('.sheet.open') ? { x: t.clientX, y: t.clientY } : null;
}, { passive: true });
document.addEventListener('touchend', (e) => {
  if (!edge) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - edge.x, dy = Math.abs(t.clientY - edge.y);
  edge = null;
  if (dx > 70 && dy < 60) globalActions['nav-back']();
}, { passive: true });

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
    applyTheme();
  } catch (e) {
    $('#main').innerHTML = `<div class="card alert">Storage is unavailable (${e.message}). Private Browsing blocks it. Open in normal Safari.</div>`;
    return;
  }
  await initLock();
  requestPersistence();
  await runMigrations(render);
  await route();
  sync.autoSync().then(() => render());
  // Warm up the PDF engine in the background so the first import starts instantly.
  setTimeout(() => (window.requestIdleCallback || ((f) => f()))(() => import('./lib/parse/pdf.js')), 4000);
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
