import { state, saveSettings, recompute, relinkTransfers, ownerOf, personName } from '../../state.js';
import { db } from '../../lib/db.js';
import { esc, openSheet, closeSheet, confirmSheet, toast } from '../dom.js';
import { fmt, parsePrice } from '../../lib/money.js';
import { prettyDate, monthLabel } from '../../lib/dates.js';
import { canonicalBank } from '../../lib/parse/details.js';
import { catChip, emptyState } from '../common.js';

const SHORT_TYPE = { current: 'Current', savings: 'Savings', credit: 'Card', investment: 'Investment' };
const TYPE_LABEL = { current: 'Current / debit', savings: 'Savings', credit: 'Credit card', investment: 'Investment / pension (not counted)' };

const ACC_ICONS = {
  current: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10 12 4l9 6M5 10v8M10 10v8M14 10v8M19 10v8M3 20h18"/></svg>',
  savings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10z"/></svg>',
  credit: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h3"/></svg>',
  investment: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>',
};
const GROUPS = [['current', 'Current accounts', ACC_ICONS.current], ['savings', 'Savings & ISAs', ACC_ICONS.savings], ['credit', 'Credit cards', ACC_ICONS.credit], ['investment', 'Investments', ACC_ICONS.investment]];

function accountRow(a) {
  const mainId = state.settings.mainAccountId;
  const counts = state.txs.filter((t) => t.accountId === a.id).length;
  const old = a.balanceDate ? Math.round((Date.parse(state.derived.today) - Date.parse(a.balanceDate)) / 86400000) : null;
  const lim = a.type === 'credit' && a.limit && a.balance != null ? Math.max(0, -a.balance) / a.limit : null;
  return `<button class="list-row tap acc-row" data-action="edit-account" data-id="${esc(a.id)}">
    <span class="bank-badge" style="${state.settings.people.length > 1 ? `box-shadow: inset 0 -3px 0 ${state.settings.people.find((p) => p.id === ownerOf(a))?.color || 'var(--muted)'}` : ''}">${esc((a.bank || a.name).slice(0, 2).toUpperCase())}</span>
    <div class="grow"><div class="acc-name">${esc(a.name)} ${a.id === mainId ? '<small class="pill">main</small>' : ''}</div>
    <div class="sub one-line">${state.settings.people.length > 1 ? `<b>${esc(personName(ownerOf(a)).split(' ')[0])}</b> · ` : ''}${a.typeLocked ? '🔒 ' : ''}${esc(a.bank || '')}${a.apr ? ` · ${a.apr}% APR` : ''} · ${counts} tx</div>
    ${lim != null ? `<div class="cat-bar ${lim > 1 ? 'over' : lim > 0.75 ? 'warn' : ''}"><span style="width:${Math.min(100, lim * 100).toFixed(1)}%"></span></div><div class="sub">${Math.round(lim * 100)}% of ${fmt(a.limit, { whole: true })} limit</div>` : ''}
    ${!a.typeLocked && a.type !== 'credit' && /\bCARD\b/i.test(a.name) && !/DEBIT/i.test(a.name) ? '<div class="sub warn-text">Called a card but set as a current account: tap to check the type</div>' : ''}</div>
    <div class="bal"><b class="${a.type === 'credit' && a.balance < 0 ? 'neg' : a.balance < 0 ? 'neg' : ''}">${a.balance != null ? (a.type === 'credit' ? `${fmt(Math.max(0, -a.balance))}` : fmt(a.balance)) : a.balanceUnverified ? `<span class="muted">${fmt(Math.abs(a.balanceUnverified.amount))}?</span>` : '—'}</b>${a.type === 'credit' && a.balance != null ? '<small class="sub">owed</small>' : ''}${a.balanceDate ? `<small class="sub ${old > 31 ? 'warn-text' : ''}">${a.balanceDate === state.derived.today ? 'today' : `${old > 31 ? '⚠ ' : ''}on ${prettyDate(a.balanceDate)}`}</small>` : ''}</div></button>`;
}

/** Cash, savings, cards owed and what that adds up to. */
function positionCard() {
  const sum = (f) => state.accounts.filter(f).reduce((x, a) => x + (a.balance || 0), 0);
  const cash = sum((a) => !['savings', 'credit', 'investment'].includes(a.type));
  const saved = sum((a) => a.type === 'savings');
  const owed = Math.max(0, -sum((a) => a.type === 'credit'));
  const stale = state.accounts.filter((a) => a.balanceDate && (Date.parse(state.derived.today) - Date.parse(a.balanceDate)) / 86400000 > 31).length;
  return `<div class="card pos-card"><div class="pos-grid">
    <div><span class="label">Current accounts</span><b>${fmt(cash, { whole: true })}</b></div>
    <div><span class="label">Savings</span><b class="pos">${fmt(saved, { whole: true })}</b></div>
    <div><span class="label">Cards owed</span><b class="${owed ? 'neg' : ''}">${fmt(owed, { whole: true })}</b></div>
    <div><span class="label">Overall</span><b class="${cash + saved - owed < 0 ? 'neg' : 'pos'}">${fmt(cash + saved - owed, { whole: true })}</b></div></div>
    <p class="sub">From each account's latest imported statement${stale ? `. <span class="warn-text">${stale} balance${stale > 1 ? 's are' : ' is'} over a month old</span>: import newer statements for a true picture` : ''}. Investments aren't included.</p></div>`;
}

/** What your savings actually earn, from the interest they've received. */
function savingsTip(list) {
  const year = new Date(Date.parse(state.derived.today) - 365 * 86400000).toISOString().slice(0, 10);
  const all = state.allTxs || state.txs;
  return list.filter((a) => a.balance > 100000).map((a) => {
    const intr = all.filter((t) => t.accountId === a.id && t.amount > 0 && t.date >= year && (t.category === 'interest' || /INTEREST/i.test(t.description)));
    if (!intr.length) return '';
    const months = new Set(intr.map((t) => t.date.slice(0, 7))).size;
    const yearly = (intr.reduce((x, t) => x + t.amount, 0) / months) * 12;
    const rate = (yearly / a.balance) * 100;
    if (rate >= 3) return `<p class="sub pos">${esc(a.name)} earns about ${rate.toFixed(1)}% a year (${fmt(yearly, { whole: true })}).</p>`;
    const at4 = a.balance * 0.04;
    return `<div class="cal-tip"><b>${esc(a.name)} earns about ${rate.toFixed(1)}% a year</b><span>That's about ${fmt(yearly, { whole: true })} a year on ${fmt(a.balance, { whole: true })}. At 4% it would be about ${fmt(at4, { whole: true })}, roughly ${fmt(at4 - yearly, { whole: true })} more. Rates change often: compare easy-access accounts and ISAs (keep within the £85,000 FSCS protection per person, per banking group).</span>
      <div class="act-links"><a class="act-link" href="https://www.moneysavingexpert.com/savings/savings-accounts-best-buys/" target="_blank" rel="noopener">MoneySavingExpert: top savings rates ↗</a><a class="act-link" href="https://www.moneyhelper.org.uk/en/savings/types-of-savings/savings-accounts-explained" target="_blank" rel="noopener">MoneyHelper: savings accounts explained ↗</a></div></div>`;
  }).join('');
}

/** Card debt vs savings: what clearing it would save. */
function cardsTip(list) {
  const owed = list.reduce((x, a) => x + Math.max(0, -(a.balance || 0)), 0);
  if (!owed) return '';
  const saved = state.accounts.filter((a) => a.type === 'savings').reduce((x, a) => x + (a.balance || 0), 0);
  const apr = list.filter((a) => a.apr).length ? list.reduce((x, a) => x + Math.max(0, -(a.balance || 0)) * (a.apr || 25), 0) / owed : 25;
  return `<div class="cal-tip ${saved > owed ? '' : 'bad'}"><b>Card interest at about ${Math.round(apr)}% APR costs roughly ${fmt((owed * apr) / 100, { whole: true })} a year</b><span>${saved > owed ? `You have ${fmt(saved, { whole: true })} in savings. Clearing the ${fmt(owed, { whole: true })} from savings would cost a few pounds of savings interest and save far more in card interest. It's your call (e.g. if the savings are for a deposit), but it's usually the best return available.` : 'Pay more than the minimum on the highest-rate card first; the payoff plan shows the order and the date you\'ll be clear.'}</span>
    <div class="row gap wrap"><a class="chip sel" href="#/cards">Payoff plan ›</a><a class="chip" href="#/movebills">Move bills off cards ›</a></div></div>`;
}

export function render() {
  if (!state.accounts.length) return emptyState({ title: 'No accounts yet', body: 'Each statement you import creates or updates an account here.' });
  const { recurring } = state.derived;
  const mainId = state.settings.mainAccountId;
  const counts = {};
  for (const t of state.txs) counts[t.accountId] = (counts[t.accountId] || 0) + 1;
  const outRec = recurring.filter((r) => r.direction === 'out' && r.active);

  // Accounts whose name and bank disagree (left over from earlier misfiled imports).
  const BANK_WORDS = ['Nationwide', 'Revolut', 'Monzo', 'Starling', 'Chase', 'HSBC', 'Barclays', 'Lloyds', 'Halifax', 'NatWest', 'Santander', 'Virgin Money', 'American Express', 'Capital One', 'Aqua', 'Barclaycard'];
  const muddled = state.accounts.filter((a) => {
    const named = BANK_WORDS.find((b) => a.name.toLowerCase().includes(b.toLowerCase()));
    return named && a.bank && canonicalBank(named) !== canonicalBank(a.bank);
  });
  const dups = state.derived.duplicates;
  const suspects = state.derived.suspects;
  return `
  <h1 class="page-title">Accounts</h1>
  ${muddled.length ? `<div class="card banner bad"><b>${muddled.length} account${muddled.length > 1 ? 's look' : ' looks'} muddled</b><span class="sub">${muddled.map((a) => `${esc(a.name)} (bank: ${esc(a.bank)})`).join(', ')}. Usually left over from earlier wrong imports. The cleanest fix: start fresh and re-import (people, income and goals are kept; files already read are free).</span><button class="btn primary full" data-action="st-fresh">Start fresh &amp; re-import</button></div>` : ''}
  ${state.accounts.some((x) => !x.typeLocked) ? `<a class="card setup-cta" href="#/setup"><div><b>Confirm account types &amp; balances</b><div class="sub">${state.accounts.filter((x) => !x.typeLocked).length} not confirmed yet: set debit, credit card or savings once and it stays locked</div></div><span class="banner-go">›</span></a>` : ''}
  ${suspects.length ? `<a class="card banner" href="#/setup"><b>${suspects.length} account${suspects.length > 1 ? 's look' : ' looks'} like a credit card</b><span class="sub">${suspects.map((x) => esc(x.name)).join(', ')}: confirm so the app tracks what you owe.</span><span class="banner-go">Fix ›</span></a>` : ''}
  ${dups.length ? `<div class="card banner"><b>${dups.length} duplicate transaction${dups.length > 1 ? 's' : ''} found</b>
    <span class="sub">The same payment imported twice (from overlapping statements, or a PDF and CSV of the same month).</span>
    <div class="row gap"><button class="btn ghost grow" data-action="dup-review">Review</button><button class="btn primary grow" data-action="dup-remove-all">Remove ${dups.length}</button></div></div>` : ''}
  ${positionCard()}
  ${GROUPS.map(([type, title, icon]) => {
    const list = state.accounts.filter((a) => (type === 'current' ? !['savings', 'credit', 'investment'].includes(a.type) : a.type === type));
    if (!list.length) return '';
    const total = list.reduce((x, a) => x + (a.balance || 0), 0);
    return `<div class="card acc-group"><div class="acc-head"><span class="sec-ic ${type}">${icon}</span><h3>${title}</h3><b class="${type === 'credit' && total < 0 ? 'neg' : ''}">${type === 'credit' ? `${fmt(Math.max(0, -total), { whole: true })} owed` : fmt(total, { whole: true })}</b></div>
      ${list.map((a) => accountRow(a)).join('')}
      ${type === 'savings' ? savingsTip(list) : ''}${type === 'credit' ? cardsTip(list) : ''}</div>`;
  }).join('')}
  <div class="card">
    ${(state.excludedAccounts || []).length ? `<h4 class="muted">Not counted</h4>${state.excludedAccounts.map((a) => `<button class="list-row tap muted" data-action="edit-account" data-id="${esc(a.id)}"><span class="bank-badge">⏸</span><div class="grow"><div>${esc(a.name)}</div><div class="sub">${esc([a.bank, TYPE_LABEL[a.type] || a.type].filter(Boolean).join(' · '))} · left out of all totals · tap to change</div></div><div class="bal"><b>${a.balance != null ? fmt(Math.abs(a.balance)) : '—'}</b></div></button>`).join('')}` : ''}
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

  <a class="card setup-cta" href="#/movebills"><div><b>🔀 Move bills to one account</b><div class="sub">Step by step: each Direct Debit, standing order and card payment, where it comes from now and how to move it.</div></div><span class="banner-go">›</span></a>

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
    <h4>Import log: how each statement checked out</h4>
    ${[...state.imports].sort((a, b) => b.at - a.at).slice(0, 15).map((i) => `<details class="log-row"><summary class="list-row"><span class="vbadge ${i.validation?.level || 'old'}">${{ ok: '✓', partial: '~', fail: '!', unchecked: '–' }[i.validation?.level] || '·'}</span><div class="grow"><div class="ellipsis">${esc(i.fileName)}</div><div class="sub">${esc(accName(i.accountId))}${i.periodStart ? ` · ${prettyDate(i.periodStart)}–${prettyDate(i.periodEnd)}` : ''} · ${new Date(i.at).toLocaleDateString('en-GB')}</div></div><span class="sub">${i.count} new${i.dupes ? ` · ${i.dupes} dup` : ''}</span></summary><div class="checks">${i.validation ? `<b>${esc(i.validation.summary)}</b>${i.validation.checks.map((c) => `<div class="check-line ${c.ok === true ? 'ok' : c.ok === false ? 'bad' : ''}">${c.ok === true ? '✓' : c.ok === false ? '✗' : '–'} ${esc(c.text.replace(/ ?✓/g, ''))}</div>`).join('')}` : '<span class="sub">Imported before checks were recorded. Re-import to check it.</span>'}</div></details>`).join('') || '<p class="sub">No imports yet.</p>'}
    <p class="sub">✓ the statement's own figures agree · ~ partly checked · ! didn't add up · – nothing printed to check against. Tap a file to see each check.</p>
  </div>`;
}

const accName = (id) => state.accounts.find((a) => a.id === id)?.name ?? '?';


export const actions = {
  'edit-account': (el, rerender) => {
    const a = (state.allAccounts || state.accounts).find((x) => x.id === el.dataset.id);
    if (!a) return;
    openSheet(`<h2>Edit account</h2>
      <label class="field"><span>Name</span><input id="ea-name" value="${esc(a.name)}"></label>
      <label class="field"><span>Bank</span><input id="ea-bank" value="${esc(a.bank || '')}"></label>
      <label class="field select"><span>Type</span><select id="ea-type">${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}" ${a.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="field"><span>${a.type === 'credit' ? 'Owed £' : 'Balance £'}</span><input id="ea-bal" inputmode="decimal" value="${a.balance != null ? (Math.abs(a.balance) / 100).toFixed(2) : ''}" placeholder="unknown"></label>
      <label class="check-row"><input type="checkbox" id="ea-count" ${a.excluded ? '' : 'checked'}> <span><b>Count this account</b><br><small class="sub">Untick for money that isn't part of your day-to-day finances: investments, a pot held for someone else, a deposit fund. It stays here but is left out of every total.</small></span></label>
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
          a.excluded = !p.querySelector('#ea-count').checked || a.type === 'investment';
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
};
