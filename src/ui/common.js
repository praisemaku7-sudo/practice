import { esc } from './dom.js';
import { monthLabel } from '../lib/dates.js';
import { CAT } from '../lib/categories.js';
import { fmt } from '../lib/money.js';
import { state } from '../state.js';
import { accountChecks } from '../lib/checks.js';

function accountChecksFor() {
  const byId = new Map(state.accounts.map((a) => [a.id, a]));
  return accountChecks({ accounts: state.accounts, txs: state.allTxs || state.txs, today: state.derived.today }).map((c) => ({ ...c, account: byId.get(c.accountId) }));
}

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
  const scope = state.settings.scope;
  if (scope !== 'all' && (state.allAccounts || []).length) {
    // Viewing one person, but the household has data: say so instead of "No accounts yet".
    const who = scope === 'joint' ? 'joint accounts' : state.settings.people.find((p) => p.id === scope)?.name || 'this person';
    return `<div class="empty card">
      <div class="empty-art">👤</div>
      <h2>Nothing for ${esc(who)} yet</h2>
      <p class="muted">You're viewing ${esc(who)} only. ${(state.allAccounts || []).length === 1 ? 'Your 1 account belongs' : `Your ${(state.allAccounts || []).length} accounts belong`} to someone else in the household. Give ${esc(who)} their accounts, or go back to the whole household.</p>
      <button class="btn primary" data-action="scope-set" data-scope="all">Show the whole household</button>
      <a class="btn ghost" href="#/setup">Choose whose account is whose</a>
    </div>`;
  }
  return `<div class="empty card">
    <div class="empty-art">📄</div>
    <h2>${esc(title)}</h2>
    <p class="muted">${esc(body)}</p>
    ${cta ? `<button class="btn primary" data-action="import">Import a statement</button>
    <button class="btn ghost" data-action="load-demo">Try with sample data</button>` : ''}
  </div>`;
}

/**
 * A banner you can close with ×. It stays hidden until its situation changes
 * (the signature differs), e.g. a new missing statement appears.
 */
export function hideable(key, sig, html) {
  if (!html) return '';
  if ((state.settings.hiddenBanners || {})[key] === String(sig)) return '';
  return `<div class="hideable">${html}<button class="banner-x" data-action="banner-hide" data-key="${esc(key)}" data-sig="${esc(String(sig))}" aria-label="Hide this">×</button></div>`;
}

/** "Sense checks" card: where an account's numbers disagree with its statements or look odd. */
export function checksBox({ only = null, title = 'Sense checks' } = {}) {
  const all = accountChecksFor().filter((c) => !only || only(c.account));
  if (!all.length) return '';
  const icon = { bad: '⚠️', warn: '❓', info: 'ℹ️' };
  return `<div class="card banner"><b>${esc(title)}</b>
    ${all.map((c) => `<div class="list-row"><div class="grow"><div>${icon[c.level]} <b>${esc(c.account.name)}</b>: ${esc(c.title)}</div><div class="sub">${esc(c.detail)}</div>
      ${c.fix ? `<div class="chip-grid"><button class="chip" data-action="chk-use" data-id="${esc(c.accountId)}">Use the statement's ${fmt(Math.abs(c.fix.amount))}</button></div>` : ''}</div></div>`).join('')}</div>`;
}
