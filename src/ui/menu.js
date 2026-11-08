// The ☰ menu: every page in one place, grouped, with a search box, whose money to show,
// and Light / Dark / Auto appearance. Drops down from the top bar.
import { state, saveSettings } from '../state.js';
import { esc } from './dom.js';

export const PAGES = [
  ['Everyday', [
    ['home', '🏠', 'Overview', 'This month at a glance'],
    ['transactions', '🧾', 'Transactions', 'Search, filter, recategorise'],
    ['bills', '📅', 'Bills & subscriptions', 'Calendar and cancel list'],
    ['due', '⏰', 'Due soon', 'Payments in the next days'],
    ['checkin', '✅', 'Monthly check-in', 'Four-step monthly routine'],
    ['history', '📊', 'Monthly record', 'Month by month'],
  ]],
  ['Plan', [
    ['track', '📈', 'On track', 'Will we have enough? Your path'],
    ['budget', '🎯', 'Budget', 'Limits per category'],
    ['income', '💷', 'Income', 'Payslips, maternity, benefits'],
    ['plan', '🏡', 'Future planning', 'Mortgage, deposit, buying costs'],
    ['goals', '🐷', 'Savings goals', 'Pots and targets'],
    ['afford', '❓', 'Can I afford it?', 'Check a purchase'],
  ]],
  ['Understand', [
    ['insights', '💡', 'Insights', 'What to change, with links'],
    ['categories', '🏷️', 'Categories', 'Breakdown and fixes'],
    ['cards', '💳', 'Credit cards', 'Payoff plan'],
    ['audit', '🔍', 'Check my numbers', 'Balances vs statements'],
  ]],
  ['Accounts', [
    ['accounts', '🏦', 'Accounts', 'Balances and owners'],
    ['import', '⬆️', 'Import statements', 'PDF, CSV, screenshots, payslips'],
    ['movebills', '🔀', 'Move bills', 'One main account'],
    ['setup', '🛠️', 'Fix accounts', 'Names, owners, duplicates'],
    ['add', '➕', 'Quick add', 'Cash or a missing payment'],
    ['settings', '⚙️', 'Settings', 'People, AI key, backup, lock'],
  ]],
];

// ----- Appearance -----
export function applyTheme(t = state.settings?.theme || 'auto') {
  const root = document.documentElement;
  if (t === 'light' || t === 'dark') root.dataset.theme = t; else delete root.dataset.theme;
  const dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.setAttribute('content', dark ? '#0f1311' : '#f4f5f2'); m.removeAttribute('media'); });
  try { localStorage.setItem('pl-theme', t); } catch { /* not remembered before load: fine */ }
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme());

let open = false;
const GKEY = 'pl-menu-groups', MKEY = 'pl-menu-mode';
const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* not remembered */ } };
/** Which groups are open, and whether several can be open at once ('many') or one ('one', like a drop-down). */
const groupMode = () => readJSON(MKEY, 'one');
function openGroups() {
  const saved = readJSON(GKEY, null);
  if (saved) return saved;
  const mine = PAGES.find(([, items]) => items.some(([v]) => v === current));
  return [mine ? mine[0] : PAGES[0][0]];
}
let current = 'home';

function menuHtml() {
  const s = state.settings;
  const theme = s.theme || 'auto';
  const mode = groupMode();
  const opened = openGroups();
  const multi = s.people.length > 1 || state.allAccounts?.some((a) => a.owner === 'joint');
  const scopes = [['all', '🏠 Household'], ...s.people.map((p) => [p.id, p.name.split(' ')[0]]), ...(state.allAccounts?.some((a) => a.owner === 'joint') ? [['joint', '👥 Joint']] : [])];
  return `<div class="menu-backdrop" data-action="menu-close"></div>
  <div class="menu-panel" role="dialog" aria-modal="true" aria-label="All pages">
    <label class="menu-search"><span aria-hidden="true">⌕</span><input id="menu-q" type="search" placeholder="Find a page" autocomplete="off" data-input="menu-q" enterkeyhint="go"></label>
    <div class="menu-row">
      <div class="seg" role="radiogroup" aria-label="Appearance">${[['auto', '◐ Auto'], ['light', '☀︎ Light'], ['dark', '☾ Dark']].map(([v, l]) => `<button role="radio" aria-checked="${theme === v}" class="${theme === v ? 'sel' : ''}" data-action="theme-set" data-theme="${v}">${l}</button>`).join('')}</div>
    </div>
    ${multi ? `<div class="menu-row"><div class="seg scroll" role="radiogroup" aria-label="Whose money">${scopes.map(([id, l]) => `<button role="radio" aria-checked="${s.scope === id}" class="${s.scope === id ? 'sel' : ''}" data-action="scope-set" data-scope="${esc(id)}">${esc(l)}</button>`).join('')}</div></div>` : ''}
    <div class="menu-row menu-mode"><span class="sub">Sections</span><div class="seg" role="radiogroup" aria-label="How sections open">${[['one', 'One at a time'], ['many', 'Several open']].map(([v, l]) => `<button role="radio" aria-checked="${mode === v}" class="${mode === v ? 'sel' : ''}" data-action="menu-mode" data-mode="${v}">${l}</button>`).join('')}</div></div>
    <nav class="menu-groups">
      ${PAGES.map(([group, items]) => { const isOpen = opened.includes(group); const hasCur = items.some(([v]) => v === current); return `<div class="menu-group ${isOpen ? 'open' : ''}" data-group="${esc(group)}">
        <button class="menu-gh" data-action="menu-group" data-group="${esc(group)}" aria-expanded="${isOpen}"><span class="grow">${group}</span>${hasCur && !isOpen ? '<span class="mi-dot" aria-hidden="true"></span>' : ''}<small>${items.length}</small><span class="mg-chev" aria-hidden="true">›</span></button>
        <div class="menu-items">${items.map(([v, ic, label, sub]) => `<a class="menu-item ${v === current ? 'cur' : ''}" href="#/${v}" data-action="menu-go" data-to="${v}" data-q="${esc((label + ' ' + sub + ' ' + group).toLowerCase())}"${v === current ? ' aria-current="page"' : ''}><span class="mi-ic" aria-hidden="true">${ic}</span><span class="grow"><b>${esc(label)}</b><small>${esc(sub)}</small></span>${v === current ? '<span class="mi-dot" aria-hidden="true"></span>' : ''}</a>`).join('')}</div></div>`; }).join('')}
      <p class="menu-empty sub" hidden>No page matches.</p>
    </nav>
  </div>`;
}

export function setMenuCurrent(view) { current = view; }

export function openMenu() {
  const el = document.getElementById('menu');
  el.innerHTML = menuHtml();
  el.classList.add('open'); open = true;
  document.getElementById('menu-btn')?.setAttribute('aria-expanded', 'true');
  document.body.classList.add('menu-open');
}
export function closeMenu() {
  if (!open) return;
  const el = document.getElementById('menu');
  el.classList.remove('open'); open = false;
  document.getElementById('menu-btn')?.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('menu-open');
  setTimeout(() => { if (!open) el.innerHTML = ''; }, 200);
}
export const menuIsOpen = () => open;

export const menuActions = {
  'menu-toggle': () => (open ? closeMenu() : openMenu()),
  'menu-close': () => closeMenu(),
  'menu-group': (el) => {
    const g = el.dataset.group;
    let opened = openGroups();
    const wasOpen = opened.includes(g);
    if (groupMode() === 'one') opened = wasOpen ? [] : [g];
    else opened = wasOpen ? opened.filter((x) => x !== g) : [...opened, g];
    writeJSON(GKEY, opened);
    document.querySelectorAll('.menu-group').forEach((box) => {
      const on = opened.includes(box.dataset.group);
      box.classList.toggle('open', on);
      box.querySelector('.menu-gh').setAttribute('aria-expanded', String(on));
    });
  },
  'menu-mode': (el) => {
    writeJSON(MKEY, el.dataset.mode);
    // Going back to one-at-a-time keeps just the first open section.
    if (el.dataset.mode === 'one') writeJSON(GKEY, openGroups().slice(0, 1));
    openMenu();
  },
  'menu-go': (el) => { closeMenu(); location.hash = '#/' + el.dataset.to; },
  'theme-set': async (el) => {
    applyTheme(el.dataset.theme);
    await saveSettings({ theme: el.dataset.theme });
    document.querySelectorAll('[data-action=theme-set]').forEach((b) => { const on = b.dataset.theme === el.dataset.theme; b.classList.toggle('sel', on); b.setAttribute('aria-checked', String(on)); });
  },
};

export const menuInputs = {
  'menu-q': (el) => {
    const q = el.value.trim().toLowerCase();
    let shown = 0;
    document.querySelectorAll('.menu-group').forEach((g) => {
      let any = false;
      g.querySelectorAll('.menu-item').forEach((a) => { const hit = !q || a.dataset.q.includes(q); a.hidden = !hit; if (hit) { any = true; shown++; } });
      g.hidden = !any;
      g.classList.toggle('searching', !!q);
    });
    const empty = document.querySelector('.menu-empty');
    if (empty) empty.hidden = shown > 0;
  },
};
