import { state, saveSettings, recompute, relinkTransfers, ownerOf, personName } from '../../state.js';
import { db } from '../../lib/db.js';
import { esc, openSheet, closeSheet, confirmSheet, toast } from '../dom.js';
import { fmt, parsePrice } from '../../lib/money.js';
import { consolidationPlan } from '../../lib/consolidate.js';
import { prettyDate, monthLabel } from '../../lib/dates.js';
import { catChip, emptyState } from '../common.js';

const TYPE_LABEL = { current: 'Current / debit', savings: 'Savings', credit: 'Credit card' };

export function render() {
  if (!state.accounts.length) return emptyState({ title: 'No accounts yet', body: 'Each statement you import creates or updates an account here.' });
  const { recurring } = state.derived;
  const mainId = state.settings.mainAccountId;
  const plan = mainId ? consolidationPlan({ accounts: state.accounts, recurring, mainAccountId: mainId, done: state.settings.consolidationDone }) : null;
  const counts = {};
  for (const t of state.txs) counts[t.accountId] = (counts[t.accountId] || 0) + 1;
  const outRec = recurring.filter((r) => r.direction === 'out' && r.active);

  const dups = state.derived.duplicates;
  const suspects = state.derived.suspects;
  return `
  <h1 class="page-title">Accounts</h1>
  ${state.accounts.some((x) => !x.typeLocked) ? `<a class="card setup-cta" href="#/setup"><div><b>Confirm account types &amp; balances</b><div class="sub">${state.accounts.filter((x) => !x.typeLocked).length} not confirmed yet: set debit, credit card or savings once and it stays locked</div></div><span class="banner-go">›</span></a>` : ''}
  ${suspects.length ? `<a class="card banner" href="#/setup"><b>${suspects.length} account${suspects.length > 1 ? 's look' : ' looks'} like a credit card</b><span class="sub">${suspects.map((x) => esc(x.name)).join(', ')}: confirm so the app tracks what you owe.</span><span class="banner-go">Fix ›</span></a>` : ''}
  ${dups.length ? `<div class="card banner"><b>${dups.length} duplicate transaction${dups.length > 1 ? 's' : ''} found</b>
    <span class="sub">The same payment imported twice (from overlapping statements, or a PDF and CSV of the same month).</span>
    <div class="row gap"><button class="btn ghost grow" data-action="dup-review">Review</button><button class="btn primary grow" data-action="dup-remove-all">Remove ${dups.length}</button></div></div>` : ''}
  <div class="card">
    ${state.accounts.map((a) => `<button class="list-row tap" data-action="edit-account" data-id="${esc(a.id)}">
      <span class="bank-badge" style="${state.settings.people.length > 1 ? `box-shadow: inset 0 -3px 0 ${state.settings.people.find((p) => p.id === ownerOf(a))?.color || 'var(--muted)'}` : ''}">${a.type === 'credit' ? '💳' : esc((a.bank || a.name).slice(0, 2).toUpperCase())}</span>
      <div class="grow"><div>${esc(a.name)} ${a.id === mainId ? '<small class="pill">main</small>' : ''}</div>
      <div class="sub">${state.settings.people.length > 1 ? `<b>${esc(personName(ownerOf(a)))}</b> · ` : ''}${a.typeLocked ? '🔒 ' : ''}${[a.bank, TYPE_LABEL[a.type] || a.type].filter(Boolean).map(esc).join(' · ')} · ${counts[a.id] || 0} transactions${a.lastImport ? ' · updated ' + prettyDate(a.lastImport) : ''}</div></div>
      <div class="bal"><b class="${a.balance < 0 ? 'neg' : ''}">${a.balance != null ? (a.type === 'credit' ? `${fmt(Math.max(0, -a.balance))} owed` : fmt(a.balance)) : '—'}</b>${a.balanceDate ? `<small class="sub">${a.balanceDate === state.derived.today ? 'today' : 'on ' + prettyDate(a.balanceDate)}</small>` : ''}</div></button>`).join('')}
    <div class="row gap"><button class="btn primary grow" data-action="import">Import</button><button class="btn ghost grow" data-action="go" data-to="transactions">Transactions</button><a class="btn ghost grow" href="#/cards">💳 Cards</a></div>
    <a class="link small-link" href="#/setup">Edit types, balances or merge accounts ›</a>
    <a class="link small-link" href="#/sync">🔗 Live bank sync ›</a>
  </div>

  ${renderStatements()}

  <div class="card">
    <h3>Regular payments (${outRec.length}) · ${fmt(outRec.reduce((a, r) => a + r.amount, 0), { whole: true })}/mo</h3>
    ${outRec.map((r) => `<div class="list-row">${catChip(r.category)}<div class="grow">${esc(r.name)}<div class="sub">${esc(r.type)} · ${esc(accName(r.accountId))} · next ${prettyDate(r.nextDue)}${r.priceChange > 0 ? ` · <span class="neg">up ${fmt(r.priceChange)}</span>` : ''}</div></div><b>${fmt(r.amount)}</b></div>`).join('') || '<p class="muted">Payments that repeat monthly show up here once two months of statements are imported.</p>'}
    ${outRec.length ? '<a class="btn ghost full" href="#/bills">Calendar &amp; cancel list</a>' : ''}
  </div>

  <div class="card">
    <h3>Consolidation plan</h3>
    <p class="muted">Pick the one account you want everything to run through. I'll list every bill and payment that needs to move, and how to move it.</p>
    <label class="field select"><select data-change="set-main"><option value="">Choose main account…</option>
      ${state.accounts.filter((a) => a.type !== 'credit').map((a) => `<option value="${esc(a.id)}" ${a.id === mainId ? 'selected' : ''}>${esc(a.name)} (${esc(a.bank || '')})</option>`).join('')}</select></label>
    ${plan ? renderPlan(plan) : ''}
  </div>

  <div class="card">
    <h3>Live bank connection</h3>
    <p class="muted">Not connected yet. UK banks share data through <b>Open Banking</b>. You approve read-only access in each bank's own app, and you never type your bank password into this app. That needs a regulated provider (TrueLayer, GoCardless or Yapily) and a small server to hold its secret key, so it isn't part of this on-device version. Until then, export each month's statement from your bank apps and import it here.</p>
    <a class="btn ghost full" href="https://github.com/praisemaku7-sudo/practice/blob/main/docs/BANK_LINKING.md" target="_blank" rel="noopener">How live linking would work</a>
  </div>`;
}

// First month expected for an account (its first row in the grid).
const c0 = (id) => state.derived.coverage.accounts.find((c) => c.account.id === id)?.months[0];

function renderStatements() {
  const { coverage } = state.derived;
  const rows = coverage.accounts.filter((c) => c.months.length);
  if (!rows.length) return '';
  const missingCount = coverage.missing.length;
  const dismissed = state.settings.coverageDismissed || {};
  return `<div class="card" id="statements">
    <h3>Statements ${missingCount ? `<small class="pill warn">${missingCount} missing</small>` : '<small class="pill ok">all in ✓</small>'}</h3>
    <p class="muted">Tracking from <b>${state.settings.trackFrom ? esc(monthLabel(state.settings.trackFrom.slice(0, 7))) : 'the start of your history'}</b> (<a href="#/settings">change</a>). Each box is a month. ✓ imported · ! missing · – no statement expected (tap ! to mark it). Same file twice is caught automatically.</p>
    ${rows.map((c) => `<div class="cov-row"><div class="cov-name ellipsis">${c.account.type === 'credit' ? '💳 ' : ''}${esc(c.account.name)}${state.settings.people.length > 1 ? `<small class="muted"> ${esc(personName(ownerOf(c.account)).split(' ')[0])}</small>` : ''}</div><div class="cov-months">
      ${c.months.map((m) => {
        const key = `${c.account.id}|${m}`;
        const has = c.covered.has(m);
        const miss = c.missing.some((x) => x.month === m);
        const dis = dismissed[key];
        const label = monthLabel(m, { short: true }).split(' ')[0].slice(0, 3);
        if (has) return `<span class="cov ok" title="${esc(monthLabel(m))}: imported">${label}</span>`;
        if (dis) return `<button class="cov dis" data-action="cov-toggle" data-key="${esc(key)}" title="${esc(monthLabel(m))}: no statement expected">${label}</button>`;
        if (miss) return `<button class="cov miss" data-action="cov-toggle" data-key="${esc(key)}" title="${esc(monthLabel(m))}: missing">${label}</button>`;
        return `<span class="cov wait" title="${esc(monthLabel(m))}: not due yet">${label}</span>`;
      }).join('')}</div></div>`).join('')}
    ${missingCount ? `<div class="list-gap"></div>${coverage.missing.map((m) => `<div class="list-row"><span class="bank-badge warn">!</span><div class="grow"><b>${esc(m.accountName)}</b> · ${esc(monthLabel(m.month))}<div class="sub">${m.reason === 'latest' ? 'Latest statement should be ready in the bank app' : m.reason === 'start' ? 'Needed from your tracking start month' : 'Gap between imported statements'}</div></div><div class="cov-btns"><button class="link" data-action="cov-toggle" data-key="${esc(m.accountId + '|' + m.month)}">No statement</button>${m.reason === 'start' && m.month === c0(m.accountId) ? `<button class="link" data-action="acc-started" data-id="${esc(m.accountId)}">Opened later</button>` : ''}</div></div>`).join('')}
      <button class="btn primary full" data-action="import">Import missing statements</button>` : ''}
    <h4>Import log</h4>
    ${[...state.imports].sort((a, b) => b.at - a.at).slice(0, 10).map((i) => `<div class="list-row"><div class="grow"><div class="ellipsis">${esc(i.fileName)}</div><div class="sub">${esc(accName(i.accountId))}${i.periodStart ? ` · ${prettyDate(i.periodStart)}–${prettyDate(i.periodEnd)}` : ''} · ${new Date(i.at).toLocaleDateString('en-GB')}</div></div><span class="sub">${i.count} new${i.dupes ? ` · ${i.dupes} dup` : ''}</span></div>`).join('') || '<p class="sub">No imports yet.</p>'}
  </div>`;
}

const accName = (id) => state.accounts.find((a) => a.id === id)?.name ?? '?';

function renderPlan(plan) {
  if (!plan.steps.length) return '<p class="good-note">✓ Nothing left to move. Every regular payment already runs through your main account.</p>';
  return `<div class="plan-progress">${plan.doneItems}/${plan.totalItems} moved</div>
    ${plan.steps.map((s) => `<div class="plan-step">
      <h4>From ${esc(s.accountName)} → ${esc(plan.main.name)}</h4>
      ${s.switchSuggested ? `<div class="tip-box"><b>Easiest: a full switch.</b> If you're closing ${esc(s.accountName)}, ask ${esc(plan.main.bank || 'your main bank')} for a <b>Current Account Switch</b> (CASS). It moves all Direct Debits, standing orders and incoming payments for you in 7 working days, redirects any stragglers for 3 years, and closes the old account. It does not move subscriptions paid by card. Update those yourself (below).</div>` : ''}
      ${s.items.map((i) => `<label class="check-row ${i.done ? 'done' : ''}">
        <input type="checkbox" data-change="plan-toggle" data-key="${esc(i.doneKey)}" ${i.done ? 'checked' : ''}>
        <div class="grow"><div><b>${esc(i.name)}</b> · ${fmt(i.amount)} · ${esc(i.type === 'income' ? 'incoming' : i.type)}</div><div class="sub">${esc(i.how)}</div></div></label>`).join('')}
    </div>`).join('')}`;
}

export const actions = {
  'edit-account': (el, rerender) => {
    const a = state.accounts.find((x) => x.id === el.dataset.id);
    if (!a) return;
    openSheet(`<h2>Edit account</h2>
      <label class="field"><span>Name</span><input id="ea-name" value="${esc(a.name)}"></label>
      <label class="field"><span>Bank</span><input id="ea-bank" value="${esc(a.bank || '')}"></label>
      <label class="field select"><span>Type</span><select id="ea-type">${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}" ${a.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="field"><span>${a.type === 'credit' ? 'Owed £' : 'Balance £'}</span><input id="ea-bal" inputmode="decimal" value="${a.balance != null ? (Math.abs(a.balance) / 100).toFixed(2) : ''}" placeholder="unknown"></label>
      <p class="sub">Credit card? Set Type to Credit card and enter what you owe. Debit cards belong to your current account.</p>
      <div class="row gap"><button class="btn danger grow" id="ea-del">Delete</button><button class="btn primary grow" id="ea-save">Save</button></div>`, {
      onMount(p) {
        p.querySelector('#ea-save').onclick = async () => {
          a.name = p.querySelector('#ea-name').value.trim() || a.name;
          a.bank = p.querySelector('#ea-bank').value.trim();
          a.type = p.querySelector('#ea-type').value;
          const raw = p.querySelector('#ea-bal').value.trim();
          const neg = raw.startsWith('-');
          const bal = parsePrice(raw.replace(/^-/, ''));
          if (raw && bal != null) { a.balance = neg ? -bal : bal; a.balanceDate = state.derived.today; }
          a.typeLocked = true;
          // Credit cards store what you owe as a negative balance.
          if (a.type === 'credit' && a.balance > 0) a.balance = -a.balance;
          await db.put('accounts', a);
          await relinkTransfers();
          recompute(); closeSheet(); rerender();
        };
        p.querySelector('#ea-del').onclick = async () => {
          closeSheet();
          if (!(await confirmSheet({ title: `Delete ${a.name}?`, body: 'This removes the account and all its transactions from this phone.', ok: 'Delete', danger: true }))) return;
          const gone = (await db.all('tx')).filter((t) => t.accountId === a.id);
          await Promise.all(gone.map((t) => db.del('tx', t.id)));
          await db.del('accounts', a.id);
          const imps = state.imports.filter((i) => i.accountId === a.id);
          await Promise.all(imps.map((i) => db.del('imports', i.id)));
          state.imports = state.imports.filter((i) => i.accountId !== a.id);
          state.txs = state.txs.filter((t) => t.accountId !== a.id);
          state.accounts = state.accounts.filter((x) => x.id !== a.id);
          if (state.settings.mainAccountId === a.id) await saveSettings({ mainAccountId: null });
          await relinkTransfers();
          recompute(); rerender(); toast('Account deleted');
        };
      },
    });
  },
};

async function removeDuplicates(pairs) {
  const ids = new Set(pairs.map((p) => p.remove.id));
  await Promise.all([...ids].map((id) => db.del('tx', id)));
  state.txs = state.txs.filter((t) => !ids.has(t.id));
  await relinkTransfers();
  recompute();
  return ids.size;
}

actions['dup-remove-all'] = async (_, rerender) => {
  const n = await removeDuplicates(state.derived.duplicates);
  rerender(); toast(`Removed ${n} duplicate${n > 1 ? 's' : ''}`);
};

actions['dup-review'] = (_, rerender) => {
  const pairs = state.derived.duplicates;
  openSheet(`<h2>Duplicates</h2><p class="muted">Each pair is the same payment imported twice. The second line will be removed; the first is kept.</p>
    <div class="preview tall">${pairs.map((p, i) => `<div class="dup-pair">
      <div class="pv-row"><span>${prettyDate(p.keep.date)}</span><span class="ellipsis grow">✓ ${esc(p.keep.description)}</span><b>${fmt(p.keep.amount)}</b></div>
      <div class="pv-row struck"><span>${prettyDate(p.remove.date)}</span><span class="ellipsis grow">✕ ${esc(p.remove.description)}</span><b>${fmt(p.remove.amount)}</b></div>
      <div class="row between"><span class="sub">${esc(accName(p.keep.accountId))}</span><button class="link" data-dup="${i}">Remove this one</button></div></div>`).join('')}</div>
    <button class="btn primary full" id="dup-all">Remove all ${pairs.length}</button>`, {
    onMount(panel) {
      panel.querySelectorAll('[data-dup]').forEach((b) => { b.onclick = async () => { await removeDuplicates([pairs[+b.dataset.dup]]); b.closest('.dup-pair').remove(); rerender(); }; });
      panel.querySelector('#dup-all').onclick = async () => { const n = await removeDuplicates(pairs); closeSheet(); rerender(); toast(`Removed ${n} duplicates`); };
    },
  });
};

actions['acc-started'] = async (el, rerender) => {
  // Account opened after the tracking start: expect statements only from its first imported month.
  const a = state.accounts.find((x) => x.id === el.dataset.id);
  const first = state.txs.filter((t) => t.accountId === a.id).map((t) => t.date).sort()[0];
  const firstImp = state.imports.filter((i) => i.accountId === a.id && i.periodStart).map((i) => i.periodStart).sort()[0];
  a.trackFrom = [first, firstImp].filter(Boolean).sort()[0];
  if (!a.trackFrom) return;
  await db.put('accounts', a);
  recompute(); rerender();
  toast(`${a.name}: statements expected from ${monthLabel(a.trackFrom.slice(0, 7))}`);
};

actions['cov-toggle'] = async (el, rerender) => {
  const d = { ...(state.settings.coverageDismissed || {}) };
  if (d[el.dataset.key]) delete d[el.dataset.key]; else d[el.dataset.key] = true;
  await saveSettings({ coverageDismissed: d });
  rerender();
};

export const changes = {
  'set-main': async (el, rerender) => { await saveSettings({ mainAccountId: el.value || null }); rerender(); },
  'plan-toggle': async (el, rerender) => {
    const done = { ...state.settings.consolidationDone, [el.dataset.key]: el.checked };
    await saveSettings({ consolidationDone: done }); rerender();
  },
};
