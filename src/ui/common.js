import { esc } from './dom.js';
import { monthLabel } from '../lib/dates.js';
import { CAT } from '../lib/categories.js';
import { fmt } from '../lib/money.js';

export function monthSwitcher(month, months) {
  const i = months.indexOf(month);
  const prev = i > 0 ? months[i - 1] : null;
  const next = i >= 0 && i < months.length - 1 ? months[i + 1] : null;
  return `<div class="month-switch">
    <button class="icon-btn" data-action="set-month" data-month="${prev || ''}" ${prev ? '' : 'disabled'} aria-label="Previous month">‹</button>
    <span>${esc(monthLabel(month))}</span>
    <button class="icon-btn" data-action="set-month" data-month="${next || ''}" ${next ? '' : 'disabled'} aria-label="Next month">›</button>
  </div>`;
}

export function catChip(id) {
  const c = CAT[id] || CAT.other;
  return `<span class="cat-dot" style="--c:${c.color}">${c.icon}</span>`;
}

export function delta(pence, { invert = false } = {}) {
  if (!pence) return '<span class="delta flat">same</span>';
  const up = pence > 0;
  const bad = invert ? !up : up;
  return `<span class="delta ${bad ? 'bad' : 'good'}">${up ? '▲' : '▼'} ${fmt(Math.abs(pence), { whole: true })}</span>`;
}

export function emptyState({ title, body, cta = true }) {
  return `<div class="empty card">
    <div class="empty-art">📄</div>
    <h2>${esc(title)}</h2>
    <p class="muted">${esc(body)}</p>
    ${cta ? `<button class="btn primary" data-action="import">Import a statement</button>
    <button class="btn ghost" data-action="load-demo">Try with sample data</button>` : ''}
  </div>`;
}
