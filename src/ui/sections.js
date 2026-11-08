// Collapsible sections: any card that starts with a heading can be folded away by tapping the
// heading. Your choice is remembered per section; very long sections start folded.
const KEY = 'pl-sections';
const LONG = 620;
// Sections already shown open while the app is open: they never fold themselves later (e.g. when
// results appear after you tap a button inside them). Only your own taps fold them.
const shownOpen = new Set(); // px: taller than about one and a half screens of content starts folded

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

const idFor = (view, head) => `${view}|${head.querySelector('h3')?.textContent || head.textContent}`.replace(/\s+/g, ' ').replace(/\d[\d,.£%]*/g, '#').trim().slice(0, 80);

/** Run after every render. */
export function enhanceSections(main, view) {
  const state = load();
  const cards = [...main.querySelectorAll(':scope > .card')];
  cards.forEach((card, i) => {
    const head = headOf(card);
    if (!head || card.children.length < 2) return;
    // A heading that also holds a link or a form control isn't made tappable (it would swallow those taps).
    if (head.querySelector('input, select, textarea, label, a[href]:not([data-action])')) return;
    const id = idFor(view, head);
    card.classList.add('collapsible');
    head.classList.add('card-head');
    head.dataset.action = 'sec-toggle';
    head.dataset.sec = id;
    head.setAttribute('role', 'button');
    head.tabIndex = 0;
    // Remembered choice, else fold sections that are very long (never the first one on the page).
    const folded = id in state ? state[id] : !card.classList.contains('keep-open') && !shownOpen.has(id) && i > 0 && card.offsetHeight > LONG
      // Sections you type into (API key, amounts, names) never fold themselves.
      && !card.querySelector('input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea');
    if (!folded) shownOpen.add(id);
    card.classList.toggle('collapsed', folded);
    head.setAttribute('aria-expanded', String(!folded));
  });
}

export const sectionActions = {
  'sec-toggle': (el) => {
    const card = el.closest('.card');
    if (!card) return;
    const folded = !card.classList.contains('collapsed');
    card.classList.toggle('collapsed', folded);
    el.setAttribute('aria-expanded', String(!folded));
    const map = load();
    map[el.dataset.sec] = folded;
    save(map);
    if (!folded) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  },
};
