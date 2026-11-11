import { state, saveSettings, recompute, relinkTransfers, ownerOf, personName } from '../../state.js';
import { db } from '../../lib/db.js';
import { esc, openSheet, closeSheet, confirmSheet, toast } from '../dom.js';
import { fmt, parsePrice } from '../../lib/money.js';
import { prettyDate, monthLabel } from '../../lib/dates.js';
import { canonicalBank } from '../../lib/parse/details.js';
import { catChip, emptyState } from '../common.js';
import { catName } from '../../lib/categories.js';
import { helpFor } from '../../lib/directory.js';

const SHORT_TYPE = { current: 'Current', savings: 'Savings', credit: 'Card', investment: 'Investment' };
const TYPE_LABEL = { current: 'Current / debit', savings: 'Savings', credit: 'Credit card', investment: 'Investment / pension (not counted)' };




/** What your savings actually earn, from the interest they've received. */
function savingsTip(list) {
  const year = new Date(Date.parse(state.derived.today) - 365 * 86400000).toISOString().slice(0, 10);
  const all = state.allTxs || state.txs;
  const ghosts = new Set(ghostAccounts().map((a) => a.id));
  return list.filter((a) => a.balance > 100000 && !ghosts.has(a.id)).map((a) => {
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
  const apr = (list.reduce((x, a) => x + Math.max(0, -(a.balance || 0)) * ((a.apr ?? 0.25) * 100), 0) / owed);
  return `<div class="cal-tip ${saved > owed ? '' : 'bad'}"><b>Card interest at about ${Math.round(apr)}% APR costs roughly ${fmt((owed * apr) / 100, { whole: true })} a year</b><span>${saved > owed ? `You have ${fmt(saved, { whole: true })} in savings. Clearing the ${fmt(owed, { whole: true })} from savings would cost a few pounds of savings interest and save far more in card interest. It's your call (e.g. if the savings are for a deposit), but it's usually the best return available.` : 'Pay more than the minimum on the highest-rate card first; the payoff plan shows the order and the date you\'ll be clear.'}</span>
    <div class="row gap wrap"><a class="chip sel" href="#/cards">Payoff plan ›</a><a class="chip" href="#/movebills">Move bills off cards ›</a></div></div>`;
}

const BANK_HUE = { revolut: 210, hsbc: 0, nationwide: 230, 'virgin money': 330, 'american express': 205, amex: 205, monzo: 15, starling: 270, barclays: 200, lloyds: 140, halifax: 220, natwest: 280, santander: 0, chase: 215, 'first direct': 0, 'capital one': 0, aqua: 190 };
const hueOf = (bank) => { const k = String(bank || '').toLowerCase(); const hit = Object.keys(BANK_HUE).find((b) => k.includes(b)); if (hit) return BANK_HUE[hit]; let h = 0; for (const c of k) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const shortName = (a) => { const last4 = a.ref || a.details?.last4 || (a.name.match(/(\d{4})\s*$/) || [])[1]; const prod = a.name.replace(/[•·]+\s*\d{4}\s*$/, '').replace(new RegExp(`^${String(a.bank || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '').replace(/\bBank\b/i, '').trim(); return { title: a.bank || a.name, sub: [prod, last4 ? `••${last4}` : ''].filter(Boolean).join(' ') }; };
const ageDays = (a) => (a.balanceDate ? Math.round((Date.parse(state.derived.today) - Date.parse(a.balanceDate)) / 86400000) : null);
const TABS = [['accounts', 'Accounts'], ['cards', 'Cards'], ['spending', 'Spending'], ['one', 'One place'], ['statements', 'Statements']];

function tile(a) {
  const n = shortName(a), age = ageDays(a), multi = state.settings.people.length > 1;
  const who = multi ? (ownerOf(a) === 'joint' ? 'Joint' : personName(ownerOf(a)).split(' ')[0]) : '';
  return `<button class="acc-tile" data-action="edit-account" data-id="${esc(a.id)}" style="--h:${hueOf(a.bank)}">
    <span class="at-top"><span class="at-logo">${esc((a.bank || a.name).replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase())}</span>${a.id === state.settings.mainAccountId ? '<span class="at-main">main</span>' : who ? `<span class="at-who">${esc(who)}</span>` : ''}</span>
    <span class="at-name">${esc(n.title)}</span><span class="at-sub">${esc(n.sub || SHORT_TYPE[a.type] || '')}</span>
    <span class="at-bal ${a.balance < 0 ? 'neg' : ''}">${a.balance != null ? fmt(a.balance) : '—'}</span>
    <span class="at-age ${age != null && age > 31 ? 'old' : ''}">${age == null ? 'no balance yet' : age <= 1 ? 'today' : age > 31 ? `${age} days old · update` : prettyDate(a.balanceDate)}</span></button>`;
}

function cardVisual(a) {
  const n = shortName(a), owed = Math.max(0, -(a.balance || 0)), limit = a.limit ?? a.details?.limit ?? null, age = ageDays(a);
  const use = limit ? owed / limit : null;
  return `<button class="cc" data-action="card-open" data-id="${esc(a.id)}" style="--h:${hueOf(a.bank)}">
    <span class="cc-top"><b>${esc(n.title)}</b><span>${esc(n.sub)}</span></span>
    <span class="cc-owed"><small>Owed</small>${fmt(owed)}</span>
    ${use != null ? `<span class="cc-bar"><i style="width:${Math.min(100, use * 100).toFixed(0)}%"></i></span><span class="cc-meta">${Math.round(use * 100)}% of ${fmt(limit, { whole: true })} limit${a.apr != null ? ` · ${(a.apr * 100).toFixed(1)}% APR` : ''}</span>` : `<span class="cc-meta">${a.apr != null ? `${(a.apr * 100).toFixed(1)}% APR · ` : ''}Tap to add the limit and APR</span>`}
    <span class="cc-age ${age > 31 ? 'old' : ''}">${a.balanceDate ? `as of ${prettyDate(a.balanceDate)}` : ''}</span></button>`;
}

/** Where the spending happens: by account and card, with each one's top categories. */
function spendingPanel() {
  const months = ui.span === 3 ? [0, 1, 2].map((i) => addMonthsKey(state.month, -i)) : [state.month];
  const rows = {};
  for (const t of state.txs) {
    if (t.amount >= 0 || !months.includes(t.date.slice(0, 7)) || ['transfer', 'savings', 'income', 'excluded'].includes(t.category) || t.cardRepay) continue;
    const r = (rows[t.accountId] ||= { total: 0, n: 0, cats: {} });
    r.total -= t.amount; r.n++; r.cats[t.category] = (r.cats[t.category] || 0) - t.amount;
  }
  const list = Object.entries(rows).sort((a, b) => b[1].total - a[1].total);
  const all = list.reduce((x, [, r]) => x + r.total, 0) || 1;
  const accs = state.allAccounts || state.accounts;
  return `<div class="seg two acc-span" role="radiogroup" aria-label="Period"><button role="radio" aria-checked="${ui.span !== 3}" class="${ui.span !== 3 ? 'sel' : ''}" data-action="acc-span" data-v="1">${esc(monthLabel(state.month, { short: true }))}</button><button role="radio" aria-checked="${ui.span === 3}" class="${ui.span === 3 ? 'sel' : ''}" data-action="acc-span" data-v="3">Last 3 months</button></div>
    ${list.length ? `<div class="sp-stack">${list.map(([id, r]) => `<i style="flex:${r.total};--h:${hueOf(accs.find((a) => a.id === id)?.bank)}" title="${esc(accName(id))}"></i>`).join('')}</div>
    ${list.map(([id, r]) => { const a = accs.find((x) => x.id === id); const top = Object.entries(r.cats).sort((x, y) => y[1] - x[1]).slice(0, 3); return `<a class="sp-row" href="#/transactions?acc=${encodeURIComponent(id)}" style="--h:${hueOf(a?.bank)}"><span class="at-logo">${esc(String(a?.bank || '?').replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase())}</span><span class="grow"><b>${esc(a ? shortName(a).title + ' ' + shortName(a).sub : '?')}</b><span class="sp-cats">${top.map(([c, v]) => `${catChip(c)}<small>${fmt(v, { whole: true })}</small>`).join('')}</span></span><span class="sp-amt"><b>${fmt(r.total, { whole: true })}</b><small>${Math.round((r.total / all) * 100)}% · ${r.n} payments</small></span></a>`; }).join('')}
    <p class="sub">${list.length > 2 ? `Spending is spread over ${list.length} accounts and cards. One debit card for everyday spending makes budgets easier to keep.` : 'Tap an account for its payments.'}</p>` : '<p class="sub">No spending in this period.</p>'}`;
}
const addMonthsKey = (key, n) => { const [y, m] = key.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };

/** Getting everything into one place: bills per account, and accounts you could close. */
function onePlacePanel() {
  const accs = state.accounts;
  const out = state.derived.billsOut;
  const by = {};
  for (const r of out) (by[r.accountId || ''] ||= []).push(r);
  // Your chosen main account, else the current account that already pays the most.
  const main = state.settings.mainAccountId || Object.entries(by).filter(([id]) => accs.find((a) => a.id === id && a.type === 'current')).sort((a, b) => b[1].reduce((x, r) => x + r.amount, 0) - a[1].reduce((x, r) => x + r.amount, 0))[0]?.[0] || accs.find((a) => a.type === 'current')?.id;
  const off = out.filter((r) => r.accountId !== main);
  const since = new Date(Date.parse(state.derived.today) - 60 * 86400000).toISOString().slice(0, 10);
  const quiet = accs.filter((a) => a.id !== main && a.type !== 'credit' && Math.abs(a.balance || 0) < 5000 && !by[a.id] && state.txs.filter((t) => t.accountId === a.id && t.date >= since).length <= 2);
  const total = out.reduce((x, r) => x + r.amount, 0) || 1;
  return `<div class="op-hero"><div><span class="label">Main account</span><b>${esc(main ? accName(main) : 'Not chosen')}</b></div><div><span class="label">To move</span><b class="${off.length ? 'warn-text' : 'pos'}">${off.length ? `${off.length} payments` : 'Nothing ✓'}</b></div></div>
    ${Object.entries(by).sort((a, b) => b[1].length - a[1].length).map(([id, l]) => { const sum = l.reduce((x, r) => x + r.amount, 0); const a = accs.find((x) => x.id === id); return `<div class="op-row ${id === main ? 'main' : ''}" style="--h:${hueOf(a?.bank)}"><span class="at-logo">${esc(String(a?.bank || '?').replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase())}</span><span class="grow"><b>${esc(id ? accName(id) : 'Account not known')}</b><small>${l.length} regular payment${l.length > 1 ? 's' : ''}${id === main ? ' · main' : ''}</small><span class="op-bar"><i style="width:${((sum / total) * 100).toFixed(0)}%"></i></span></span><b>${fmt(sum, { whole: true })}<small>/mo</small></b></div>`; }).join('')}
    ${quiet.length ? `<div class="cal-tip"><b>Could close: ${quiet.map((a) => esc(shortName(a).title + ' ' + shortName(a).sub)).join(', ')}</b><span>Little or no money, no regular payments and hardly used in 2 months. Fewer accounts, fewer balances to watch.</span></div>` : ''}
    <a class="btn primary full" href="#/movebills">${off.length ? `Move ${off.length} payments to one account` : 'Open Move bills'}</a>
    <a class="btn ghost full" href="#/setup">Merge or fix accounts</a>`;
}

/** What needs doing, in one place instead of separate banners. */
function attention() {
  const BANK_WORDS = ['Nationwide', 'Revolut', 'Monzo', 'Starling', 'Chase', 'HSBC', 'Barclays', 'Lloyds', 'Halifax', 'NatWest', 'Santander', 'Virgin Money', 'American Express', 'Capital One', 'Aqua', 'Barclaycard'];
  const muddled = state.accounts.filter((a) => { const named = BANK_WORDS.find((b) => a.name.toLowerCase().includes(b.toLowerCase())); return named && a.bank && canonicalBank(named) !== canonicalBank(a.bank); });
  const dups = state.derived.duplicates, suspects = state.derived.suspects, unconfirmed = state.accounts.filter((x) => !x.typeLocked);
  const items = [
    ...ghostAccounts().map((a) => `<div class="attn bad"><b>Is "${esc(a.name)}" real?</b><span>${fmt(a.balance, { whole: true })} with only a few transactions: often an investment or pension statement read as savings.</span><div class="row gap wrap"><button class="chip sel" data-action="acc-ghost-remove" data-id="${esc(a.id)}">Not real: remove</button><button class="chip" data-action="acc-ghost-count" data-id="${esc(a.id)}">Real, don't count it</button><button class="chip" data-action="acc-ghost-keep" data-id="${esc(a.id)}">Real, keep it</button></div></div>`),
    dups.length && `<div class="attn"><b>${dups.length} duplicate transaction${dups.length > 1 ? 's' : ''}</b><span>The same payment imported twice.</span><div class="row gap"><button class="chip" data-action="dup-review">Review</button><button class="chip sel" data-action="dup-remove-all">Remove ${dups.length}</button></div></div>`,
    suspects.length && `<a class="attn" href="#/setup"><b>${suspects.length} account${suspects.length > 1 ? 's look' : ' looks'} like a credit card</b><span>${suspects.map((x) => esc(x.name)).join(', ')}: confirm it ›</span></a>`,
    muddled.length && `<a class="attn bad" href="#/setup"><b>${muddled.length} account${muddled.length > 1 ? 's look' : ' looks'} muddled</b><span>${muddled.map((a) => esc(a.name)).join(', ')}: name and bank disagree ›</span></a>`,
    unconfirmed.length && `<a class="attn" href="#/setup"><b>Confirm ${unconfirmed.length} account type${unconfirmed.length > 1 ? 's' : ''}</b><span>Debit, credit card or savings: set once and it stays locked ›</span></a>`,
  ].filter(Boolean);
  return items.length ? `<div class="attn-list">${items.join('')}</div>` : '';
}

export function render() {
  if (!state.accounts.length) return emptyState({ title: 'No accounts yet', body: 'Each statement you import creates or updates an account here.' });
  const tab = ui.tab || 'accounts';
  const sum = (f) => state.accounts.filter(f).reduce((x, a) => x + (a.balance || 0), 0);
  const cash = sum((a) => !['savings', 'credit', 'investment'].includes(a.type));
  const saved = sum((a) => a.type === 'savings');
  const owed = Math.max(0, -sum((a) => a.type === 'credit'));
  const net = cash + saved - owed;
  const stale = state.accounts.filter((a) => (ageDays(a) ?? 0) > 31);
  const current = state.accounts.filter((a) => !['savings', 'credit', 'investment'].includes(a.type)).sort((a, b) => (b.id === state.settings.mainAccountId) - (a.id === state.settings.mainAccountId) || (b.balance || 0) - (a.balance || 0));
  const savings = state.accounts.filter((a) => a.type === 'savings');
  const cards = state.accounts.filter((a) => a.type === 'credit');
  const missing = state.derived.coverage.missing.length;
  const big = Math.max(cash, 0) + Math.max(saved, 0) + owed || 1;
  const panel = tab === 'cards' ? (cards.length ? `<div class="cc-list">${cards.map(cardVisual).join('')}</div>${cardsTip(cards)}<a class="btn ghost full" href="#/cards">Payoff plan</a>` : '<p class="sub">No credit cards imported.</p>')
    : tab === 'spending' ? spendingPanel()
    : tab === 'one' ? onePlacePanel()
    : tab === 'statements' ? (renderStatements() || '<p class="sub">Import a statement to see coverage.</p>')
    : `<div class="acc-grid">${current.map(tile).join('')}</div>${savings.length ? `<div class="label acc-lab">Savings & ISAs · ${fmt(saved, { whole: true })}</div><div class="acc-grid">${savings.map(tile).join('')}</div>${savingsTip(savings)}` : ''}
      ${(state.excludedAccounts || []).length ? `<div class="label acc-lab">Not counted</div><div class="row gap wrap">${state.excludedAccounts.map((a) => `<button class="chip" data-action="edit-account" data-id="${esc(a.id)}">⏸ ${esc(a.name)}</button>`).join('')}</div>` : ''}`;
  return `
  <div class="acc-headrow"><h1 class="page-title">Accounts</h1><div class="row gap"><button class="icon-btn small" data-action="import" aria-label="Import statements">⬆</button><a class="icon-btn small" href="#/setup" aria-label="Fix accounts">✎</a></div></div>
  <div class="card nw keep-open">
    <span class="label">Overall, after cards</span>
    <div class="nw-big ${net < 0 ? 'neg' : ''}">${fmt(net, { whole: true })}</div>
    <div class="nw-bar" role="img" aria-label="Current accounts, savings and cards owed"><i class="c" style="flex:${Math.max(cash, 0)}"></i><i class="s" style="flex:${Math.max(saved, 0)}"></i><i class="o" style="flex:${owed}"></i></div>
    <div class="nw-legend"><button data-action="acc-tab" data-tab="accounts"><i class="c"></i>Current<b>${fmt(cash, { whole: true })}</b></button><button data-action="acc-tab" data-tab="accounts"><i class="s"></i>Savings<b>${fmt(saved, { whole: true })}</b></button><button data-action="acc-tab" data-tab="cards"><i class="o"></i>Cards owed<b class="${owed ? 'neg' : ''}">${fmt(owed, { whole: true })}</b></button></div>
    ${stale.length || missing ? `<button class="nw-stale" data-action="acc-tab" data-tab="statements">⚠ ${[stale.length && `${stale.length} balance${stale.length > 1 ? 's' : ''} out of date`, missing && `${missing} statement${missing > 1 ? 's' : ''} missing`].filter(Boolean).join(' · ')} ›</button>` : ''}
  </div>
  ${attention()}
  <div class="sec-tabs acc-tabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" aria-selected="${tab === k}" class="sec-tab ${tab === k ? 'sel' : ''}" data-action="acc-tab" data-tab="${k}">${l}${k === 'statements' && missing ? ` <small class="dot-n">${missing}</small>` : k === 'cards' && cards.length ? ` <small class="muted">${cards.length}</small>` : ''}</button>`).join('')}</div>
  <div class="card acc-panel keep-open">${panel}</div>
  <div class="row gap acc-foot"><button class="btn ghost grow" data-action="go" data-to="transactions">Transactions</button><a class="btn ghost grow" href="#/sync">🔗 Live sync</a></div>`;
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
    <details class="imp-log"><summary><b>Import log</b> <span class="muted">· ${state.imports.length} file${state.imports.length === 1 ? '' : 's'}${state.imports.some((i) => i.validation?.level === 'fail') ? ` · <span class="neg">${state.imports.filter((i) => i.validation?.level === 'fail').length} didn't add up</span>` : ''}</span></summary>
    ${[...state.imports].sort((a, b) => b.at - a.at).slice(0, ui.logAll ? 200 : 3).map((i) => `<details class="log-row"><summary class="list-row"><span class="vbadge ${i.validation?.level || 'old'}">${{ ok: '✓', partial: '~', fail: '!', unchecked: '–' }[i.validation?.level] || '·'}</span><div class="grow"><div class="ellipsis">${esc(i.fileName)}</div><div class="sub">${esc(accName(i.accountId))}${i.periodStart ? ` · ${prettyDate(i.periodStart)}–${prettyDate(i.periodEnd)}` : ''} · ${new Date(i.at).toLocaleDateString('en-GB')}</div></div><span class="sub">${i.count} new${i.dupes ? ` · ${i.dupes} dup` : ''}</span></summary><div class="checks">${i.validation ? `<b>${esc(i.validation.summary)}</b>${i.validation.checks.map((c) => `<div class="check-line ${c.ok === true ? 'ok' : c.ok === false ? 'bad' : ''}">${c.ok === true ? '✓' : c.ok === false ? '✗' : '–'} ${esc(c.text.replace(/ ?✓/g, ''))}</div>`).join('')}` : '<span class="sub">Imported before checks were recorded. Re-import to check it.</span>'}</div></details>`).join('') || '<p class="sub">No imports yet.</p>'}
    ${state.imports.length > 3 ? `<button class="link small-link" data-action="acc-log-all">${ui.logAll ? 'Show fewer' : `Show all ${state.imports.length}`}</button>` : ''}
    <p class="sub">✓ figures agree · ~ partly checked · ! didn't add up · – nothing to check against. Tap a file for its checks.</p></details>
  </div>`;
}

const accName = (id) => state.accounts.find((a) => a.id === id)?.name ?? '?';


/** Months and interest to clear a balance paying a fixed amount each month. */
function clearIn(owed, apr, monthly) {
  let bal = owed, months = 0, interest = 0;
  while (bal > 0 && months < 600) {
    const i = Math.round(bal * (apr / 12));
    if (monthly <= i) return { months: null, interest: null };
    bal += i - monthly; interest += i; months++;
  }
  return { months, interest };
}

function cardSheet(a) {
  const today = state.derived.today;
  const all = (state.allTxs || state.txs).filter((t) => t.accountId === a.id);
  const owed = a.balance != null ? Math.max(0, -a.balance) : null;
  const limit = a.limit ?? a.details?.limit ?? null;
  const apr = a.apr ?? null;
  const aprUse = apr ?? 0.249;
  const use = limit && owed != null ? owed / limit : null;
  const monthInt = owed ? Math.round(owed * (aprUse / 12)) : 0;
  // UK minimums are usually interest + 1% of the balance, with a floor (often £25).
  const minPay = owed ? Math.min(owed, Math.max(2500, monthInt + Math.round(owed * 0.01))) : 0;
  const m = monthLabel(today.slice(0, 7), { short: true });
  const inMonth = all.filter((t) => t.date.startsWith(today.slice(0, 7)));
  const isFee = (t) => t.category === 'fees' || /\b(INTEREST|LATE|FEE|CHARGE)\b/i.test(t.description);
  const spent = inMonth.filter((t) => t.amount < 0 && t.category !== 'transfer' && !isFee(t)).reduce((x, t) => x - t.amount, 0);
  const fees3 = all.filter((t) => t.amount < 0 && isFee(t) && t.date >= new Date(Date.parse(today) - 92 * 86400000).toISOString().slice(0, 10));
  const pays = all.filter((t) => t.amount > 0 && !/REFUND/i.test(t.description)).sort((x, y) => y.date.localeCompare(x.date));
  const since = new Date(Date.parse(today) - 92 * 86400000).toISOString().slice(0, 10);
  const recent = all.filter((t) => t.amount < 0 && t.date >= since && !isFee(t) && t.category !== 'transfer');
  const byCat = {};
  for (const t of recent) byCat[t.category] = (byCat[t.category] || 0) - t.amount;
  const cats = Object.entries(byCat).sort((x, y) => y[1] - x[1]).slice(0, 5);
  const top = [...recent].sort((x, y) => x.amount - y.amount).slice(0, 5);
  const regular = state.derived.recurring.filter((r) => r.accountId === a.id && r.direction === 'out' && r.active);
  const h = helpFor(a.bank || a.name);
  const opts = owed ? [['Minimum (about)', minPay], ['+ £50 a month', minPay + 5000], ['+ £100 a month', minPay + 10000], ['+ £250 a month', minPay + 25000]].map(([l, p]) => ({ l, p, r: clearIn(owed, aprUse, p) })) : [];
  const row = (l, v, cls = '') => `<div><span class="label">${l}</span><b class="${cls}">${v}</b></div>`;
  openSheet(`<h2>${esc(a.name)}</h2>
    <p class="muted">${esc(personName(ownerOf(a)).split(' ')[0])} · ${esc(a.bank || 'Credit card')}${a.balanceDate ? ` · balance from ${prettyDate(a.balanceDate)}` : ''}</p>
    <div class="sheet-big ${owed ? 'neg' : 'pos'}">${owed == null ? 'Balance unknown' : fmt(owed)}<small> owed</small></div>
    ${use != null ? `<div class="cat-bar ${use > 1 ? 'over' : use > 0.75 ? 'warn' : ''}"><span style="width:${Math.min(100, use * 100).toFixed(1)}%"></span></div><p class="sub">${Math.round(use * 100)}% of your limit used. ${use > 0.3 ? 'Under 30% helps your credit score.' : 'Under 30%: good for your credit score.'}</p>` : ''}
    <div class="cc-stats">
      ${row('Limit', limit ? fmt(limit, { whole: true }) : '<span class="muted">not set</span>')}
      ${row('Available', limit && owed != null ? fmt(Math.max(0, limit - owed), { whole: true }) : '–')}
      ${row('APR', apr != null ? `${(apr * 100).toFixed(1)}%` : '<span class="muted">not set (24.9% assumed)</span>')}
      ${row('Interest a month', owed ? `~${fmt(monthInt, { whole: true })}` : '£0', monthInt ? 'neg' : '')}
      ${row(`Spent in ${esc(m)}`, fmt(spent, { whole: true }), spent ? 'warn-text' : 'pos')}
      ${row('Interest & fees (3 months)', fmt(fees3.reduce((x, t) => x - t.amount, 0), { whole: true }), fees3.length ? 'neg' : '')}
      ${row('Estimated minimum', owed ? `~${fmt(minPay, { whole: true })}/mo` : '–')}
      ${row('Last payment', pays[0] ? `${fmt(pays[0].amount, { whole: true })} · ${prettyDate(pays[0].date)}` : '<span class="muted">none seen</span>')}
    </div>
    ${opts.length ? `<h3>How fast can it be cleared?</h3><div class="plan-table"><div class="pt-row head three"><span>Paying</span><span>Clear in</span><span>Interest</span></div>
      ${opts.map((o) => `<div class="pt-row three"><span>${o.l}<br><small class="muted">${fmt(o.p, { whole: true })}/mo</small></span><span>${o.r.months == null ? '<span class="neg">never</span>' : o.r.months >= 12 ? `${Math.floor(o.r.months / 12)}y ${o.r.months % 12}m` : `${o.r.months} months`}</span><span>${o.r.interest == null ? '–' : fmt(o.r.interest, { whole: true })}</span></div>`).join('')}</div>
      <p class="sub">${apr == null ? 'Using 24.9% until you add this card\'s APR (on its statement). ' : ''}Paying only the minimum takes years and costs the most; every extra £50 shortens it a lot.</p>` : ''}
    ${cats.length ? `<h3>What it's used for (3 months)</h3>${cats.map(([c, v]) => `<div class="list-row">${catChip(c)}<span class="grow">${esc(catName(c))}</span><b>${fmt(v, { whole: true })}</b></div>`).join('')}` : ''}
    ${top.length ? `<h3>Biggest purchases (3 months)</h3>${top.map((t) => `<div class="list-row"><span class="grow ellipsis">${esc(t.merchant || t.description)} <small class="muted">${prettyDate(t.date)}</small></span><b>${fmt(-t.amount)}</b></div>`).join('')}` : ''}
    ${regular.length ? `<h3>Regular payments on this card</h3>${regular.map((r) => `<div class="list-row">${catChip(r.category)}<span class="grow">${esc(r.name)} <small class="muted">${prettyDate(r.nextDue)}</small></span><b>${fmt(r.amount)}</b></div>`).join('')}<p class="sub">Move these to your debit card so the card can be paid off and put away.</p>` : ''}
    <h3>Keep your credit file healthy</h3>
    <ol class="act-steps"><li>Set a Direct Debit for at least the minimum, so a payment is never missed.</li><li>Keep the balance under 30% of the limit where you can.</li><li>Don't take cash out on a credit card: it costs a fee and interest from day one.</li><li>If you can't make the minimum, call the card company before the due date and ask about a payment plan.</li></ol>
    <div class="row gap wrap"><a class="btn primary grow" href="#/cards">Payoff plan for all cards</a><button class="btn ghost grow" data-action="edit-account" data-id="${esc(a.id)}">Edit card</button></div>
    <div class="act-links"><a class="act-link" href="#/transactions">Transactions ›</a>${h ? `<a class="act-link" href="${esc(h.url)}" target="_blank" rel="noopener">${esc(h.label)} ↗</a>` : ''}<a class="act-link" href="https://www.moneyhelper.org.uk/en/everyday-money/credit-and-purchases/credit-cards-explained" target="_blank" rel="noopener">MoneyHelper: credit cards explained ↗</a></div>
    <button class="btn ghost full" data-action="close-sheet">Done</button>`, { wide: true });
}

async function removeAccount(a) {
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
  recompute();
}

/** Accounts that probably aren't real: a big balance with hardly any transactions, or the same
 *  balance as an investment you've left out (an investment statement read as savings). */
function ghostAccounts() {
  const counts = {};
  for (const t of state.allTxs || state.txs) counts[t.accountId] = (counts[t.accountId] || 0) + 1;
  const invest = (state.allAccounts || state.accounts).filter((a) => a.type === 'investment' || a.excluded).map((a) => Math.abs(a.balance || 0)).filter((v) => v > 0);
  return state.accounts.filter((a) => !a.confirmedReal && a.type !== 'credit' && Math.abs(a.balance || 0) >= 2000000
    && ((counts[a.id] || 0) <= 10 || invest.some((v) => Math.abs(v - Math.abs(a.balance)) <= v * 0.03)));
}

const ui = { logAll: false, tab: 'accounts', span: 1 };

export const actions = {
  'acc-log-all': (_, rerender) => { ui.logAll = !ui.logAll; rerender(); },
  'acc-tab': (el, rerender) => { ui.tab = el.dataset.tab; rerender(); },
  'acc-span': (el, rerender) => { ui.span = +el.dataset.v; rerender(); },
  'card-open': (el) => { const a = (state.allAccounts || state.accounts).find((x) => x.id === el.dataset.id); if (a) cardSheet(a); },
  'acc-ghost-remove': async (el, rerender) => {
    const a = state.accounts.find((x) => x.id === el.dataset.id);
    if (!a || !(await confirmSheet({ title: `Remove ${a.name}?`, body: 'Removes the account and its transactions from this phone, and stops the same statement creating it again.', ok: 'Remove', danger: true }))) return;
    await saveSettings({ blockedAccounts: [...(state.settings.blockedAccounts || []), { name: a.name, bank: a.bank || '', ref: a.ref || a.details?.last4 || null, at: state.derived.today }] });
    await removeAccount(a); rerender(); toast(`${a.name} removed`);
  },
  'acc-ghost-count': async (el, rerender) => {
    const a = state.accounts.find((x) => x.id === el.dataset.id);
    if (!a) return;
    a.excluded = true; a.typeLocked = true; await db.put('accounts', a); await relinkTransfers(); recompute(); rerender(); toast(`${a.name} is no longer counted`);
  },
  'acc-ghost-keep': async (el, rerender) => {
    const a = state.accounts.find((x) => x.id === el.dataset.id);
    if (!a) return;
    a.confirmedReal = true; await db.put('accounts', a); rerender();
  },
  'edit-account': (el, rerender) => {
    const a = (state.allAccounts || state.accounts).find((x) => x.id === el.dataset.id);
    if (!a) return;
    openSheet(`<h2>Edit account</h2>
      <label class="field"><span>Name</span><input id="ea-name" value="${esc(a.name)}"></label>
      <label class="field"><span>Bank</span><input id="ea-bank" value="${esc(a.bank || '')}"></label>
      <label class="field select"><span>Type</span><select id="ea-type">${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}" ${a.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="field"><span>${a.type === 'credit' ? 'Owed £' : 'Balance £'}</span><input id="ea-bal" inputmode="decimal" value="${a.balance != null ? (Math.abs(a.balance) / 100).toFixed(2) : ''}" placeholder="unknown"></label>
      ${a.type === 'credit' ? `<div class="plan-grid"><label class="field"><span>APR %</span><input id="ea-apr" inputmode="decimal" value="${a.apr != null ? (a.apr * 100).toFixed(1) : ''}" placeholder="e.g. 29.9"></label><label class="field"><span>Credit limit £</span><input id="ea-limit" inputmode="decimal" value="${(a.limit ?? a.details?.limit) != null ? ((a.limit ?? a.details?.limit) / 100).toFixed(0) : ''}" placeholder="e.g. 1500"></label></div><p class="sub">Both are on the card's statement or app.</p>` : ''}
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
          const aprEl = p.querySelector('#ea-apr'), limEl = p.querySelector('#ea-limit');
          if (aprEl) { const v = aprEl.value.trim(); a.apr = v === '' ? null : Math.max(0, parseFloat(v)) / 100; }
          if (limEl) { const v = parsePrice(limEl.value.trim()); a.limit = v || null; }
          a.excluded = !p.querySelector('#ea-count').checked || a.type === 'investment';
          // Credit cards store what you owe as a negative balance.
          if (a.type === 'credit' && a.balance > 0) a.balance = -a.balance;
          await db.put('accounts', a);
          await relinkTransfers();
          recompute(); closeSheet(); rerender();
        };
        p.querySelector('#ea-del').onclick = async () => {
          closeSheet();
          if (!(await confirmSheet({ title: `Delete ${a.name}?`, body: 'This removes the account and all its transactions from this phone. It won\'t be created again if the same statement is imported later.', ok: 'Delete', danger: true }))) return;
          await saveSettings({ blockedAccounts: [...(state.settings.blockedAccounts || []), { name: a.name, bank: a.bank || '', ref: a.ref || a.details?.last4 || null, at: state.derived.today }] });
          await removeAccount(a);
          rerender(); toast('Account deleted');
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
