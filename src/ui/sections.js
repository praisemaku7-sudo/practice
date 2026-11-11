// Sections as tabs: instead of one long page of folding cards, each page's sections become a row of
// tabs under its summary, and one section shows at a time. The tab you last opened is remembered per
// page. Cards marked keep-open (summaries, heroes) always show; pages with one section stay as they are.
const KEY = 'pl-tabs';

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
function save(map) {
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* private mode: just not remembered */ }
}

/** The card's heading element: an h3 first child, or a first-child row that holds an h3. */
function headOf(card) {
  const first = card.firstElementChild;
  if (!first) return null;
  if (first.tagName === 'H3') return first;
  if (first.classList.contains('row') && first.querySelector(':scope > h3')) return first;
  return null;
}

const idFor = (view, title) => `${view}|${title}`.replace(/\s+/g, ' ').replace(/\d[\d,.£%]*/g, '#').trim().slice(0, 80);
/** A short tab label: the heading's own words, without counts, pills or amounts. */
function labelOf(head, max = 20) {
  const h3 = head.tagName === 'H3' ? head : head.querySelector('h3');
  const own = [...h3.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ');
  const text = (own.trim() || h3.textContent).replace(/^\d+\.\s*/, '').replace(/[·:–-]\s*$/, '').replace(/\s*[·(].*$/, '').replace(/£[\d,.]+.*$/, '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  // Cut at a word, not mid-word.
  const cut = text.slice(0, max + 1).replace(/\s+\S*$/, '').replace(/[,:;–-]$/, '');
  return cut || text.slice(0, max);
}

// Short tab names, and related sections that share one tab (shown together).
const TAB_NAMES = {
  bills: { 'What changed': 'To do', 'What to do': 'To do', 'New regular payments?': 'To do', 'Balance forecast': 'Forecast', 'Subscription audit': 'Subscriptions', 'Paying twice for the same thing?': 'Subscriptions', Subscriptions: 'Subscriptions', Bills: 'All payments', 'Other regular payments': 'All payments', Income: 'All payments', Hidden: 'All payments', 'What each account needs': 'Accounts', 'Who pays what into the joint account': 'Accounts', 'Yearly bills pot': 'Yearly', 'Regular payments over the year': 'Trends' },
  track: { 'What moves the number most': 'Levers', 'Living on one income': 'One income', 'Stress test': 'Stress test', 'Can our income carry our commitments?': 'Commitments', 'How much rent or mortgage can we carry?': 'Housing', 'Budgets this month': 'Budgets', 'Back-on-track plan': 'Plan', 'Credit health': 'Credit', 'Monthly routine': 'Routine' },
  budget: { 'Your month on paper': 'Month', 'Payday plan': 'Payday', 'Bills & commitments': 'Bills', 'Fun money': 'Fun', 'Emergency fund': 'Safety net', 'Yearly bills pot': 'Yearly' },
  audit: { 'Your name on transfers': 'Your name', 'Biggest money in, counted as income': 'Money in', 'Biggest spending': 'Spending', 'Treated as transfers': 'Transfers' },
  categories: { 'Check categories with Claude': 'Claude check' },
  insights: { 'Free help and support': 'Free help' },
  plan: { 'Buying and your deposit': 'Buying', 'Mortgage readiness': 'Readiness', 'Your mortgage': 'Mortgage' },
  cards: { 'New spending on cards': 'New spending' },
  settings: { 'Auto-log Apple Pay': 'Apple Pay' },
  home: { 'What changed vs last month': 'Changes', 'Where it went': 'Categories', 'Top merchants': 'Merchants', 'Balance to payday': 'To payday' },
};
// Step-by-step pages read top to bottom, so they keep their layout.
const NO_TABS = new Set(['movebills', 'setup', 'import', 'add', 'sync', 'checkin']);

/** Run after every render. */
export function enhanceSections(main, view) {
  if (NO_TABS.has(view)) return;
  const cards = [...main.querySelectorAll(':scope > .card')].filter((c) => !c.classList.contains('keep-open') && (c.dataset.tab || (headOf(c) && c.children.length >= 2)));
  const names = TAB_NAMES[view] || {};
  const tabs = [];
  for (const card of cards) {
    const full = headOf(card) ? labelOf(headOf(card), 80) : '';
    const key = Object.keys(names).find((k) => full === k || full.startsWith(k)) ;
    const label = card.dataset.tab || (key ? names[key] : labelOf(headOf(card)));
    let t = tabs.find((x) => x.label === label);
    if (!t) { t = { label, id: idFor(view, label), cards: [] }; tabs.push(t); }
    t.cards.push(card);
  }
  if (tabs.length < 2) return;
  const saved = load()[view];
  const cur = tabs.find((t) => t.id === saved) || tabs[0];
  // A single section whose heading just repeats the tab name doesn't need the heading.
  for (const t of tabs) if (t.cards.length === 1) { const h = headOf(t.cards[0]); if (h && h.tagName === 'H3' && labelOf(h, 80).toLowerCase() === t.label.toLowerCase() && !h.querySelector('small, .pill, button, a')) h.classList.add('tab-dup-head'); }
  tabs.forEach((t, i) => t.cards.forEach((card) => { card.classList.add('tab-panel'); card.dataset.tp = String(i); card.setAttribute('role', 'tabpanel'); card.hidden = t !== cur; }));
  const bar = document.createElement('div');
  bar.className = 'sec-tabs';
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', 'Sections');
  bar.innerHTML = tabs.map((t, i) => `<button role="tab" class="sec-tab ${t === cur ? 'sel' : ''}" aria-selected="${t === cur}" data-tp="${i}" data-action="sec-tab" data-view="${view}" data-tab="${t.id.replace(/"/g, '&quot;')}">${t.label.replace(/</g, '&lt;')}${t.cards.length > 1 ? ` <small>${t.cards.length}</small>` : ''}</button>`).join('');
  cards[0].before(bar);
  requestAnimationFrame(() => bar.querySelector('.sel')?.scrollIntoView({ inline: 'center', block: 'nearest' }));
}

export const sectionActions = {
  'sec-tab': (el) => {
    const bar = el.closest('.sec-tabs');
    const map = load();
    map[el.dataset.view] = el.dataset.tab;
    save(map);
    bar.querySelectorAll('.sec-tab').forEach((b) => { const on = b === el; b.classList.toggle('sel', on); b.setAttribute('aria-selected', String(on)); });
    document.querySelectorAll('#main > .tab-panel').forEach((p) => { p.hidden = p.dataset.tp !== el.dataset.tp; });
    el.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    // Bring the section into view if the page was scrolled past the tabs.
    if (bar.getBoundingClientRect().top < 0) bar.scrollIntoView({ block: 'start', behavior: 'smooth' });
  },
  // Kept so older links and tests that used folding still do nothing harmful.
  'sec-all': () => {},
  'sec-toggle': () => {},
};
