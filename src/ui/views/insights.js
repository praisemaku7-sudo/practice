import { state, saveSettings, applyMerchantCategory, recompute } from '../../state.js';
import { otherMerchants, suggestCategory } from '../../lib/catsuggest.js';
import { CATEGORIES } from '../../lib/categories.js';
import { HELP } from '../../lib/directory.js';
import { addDays } from '../../lib/dates.js';
import { db } from '../../lib/db.js';
import { openInsight } from '../insight-actions.js';
import { esc, toast, closeSheet } from '../dom.js';
import { fmt } from '../../lib/money.js';
import { buildInsights } from '../../lib/insights.js';
import { compareMonths } from '../../lib/analysis.js';
import { catName } from '../../lib/categories.js';
import { monthLabel } from '../../lib/dates.js';
const aiMonthlyReport = async (...a) => (await import('../../lib/ai.js')).aiMonthlyReport(...a);
const aiAsk = async (...a) => (await import('../../lib/ai.js')).aiAsk(...a);
import { monthSwitcher, emptyState, hideable } from '../common.js';

const reports = {}; // month -> report (cache of kv)
let loadingReport = false;
let saved = {};
const ui = { filter: 'todo', ask: null, asking: false, showDone: false };

export async function preload() {
  const key = 'report:' + state.month;
  if (!(state.month in reports)) reports[state.month] = await db.kvGet(key, null);
  saved = (await db.kvGet('catSuggest', {})) || {};
}

/** Done / snoozed / dismissed, remembered per insight. Done and snoozed come back after 30 days. */
function statusOf(i) {
  const st = (state.settings.insightState || {})[i.id];
  if (!st) return 'todo';
  if (st.status === 'dismiss') return 'dismiss';
  if (st.until && st.until <= state.derived.today) return 'todo';
  return st.status;
}

/** A realistic total: one figure per category (the biggest), nothing that's a target rather than a saving. */
function realisticSaving(list) {
  const by = {};
  for (const i of list) {
    if (!(i.saving > 0) || i.level === 'good' || ['rate', 'card-spend', 'consolidate'].includes(i.id)) continue;
    const key = i.category || i.id.replace(/^(over|up)-/, '') || i.id;
    const k = ['subs', 'streaming', 'music'].includes(i.id) ? 'subscriptions' : i.id === 'food' ? 'eating_out' : key;
    by[k] = Math.max(by[k] || 0, i.saving);
  }
  return { total: Object.values(by).reduce((a, v) => a + v, 0), n: Object.keys(by).length };
}

const PICKABLE = CATEGORIES.filter((c) => !['transfer', 'excluded', 'interest', 'other'].includes(c.id));
function sortOtherCard() {
  const groups = otherMerchants(state.txs);
  if (!groups.length) return '';
  const all = state.allTxs || state.txs;
  const n = groups.reduce((a, g) => a + g.txs.length, 0), total = groups.reduce((a, g) => a + g.total, 0);
  const sugs = groups.map((g) => ({ g, s: suggestCategory(g, all, { userRules: state.settings.userRules, saved }) }));
  const ready = sugs.filter(({ s }) => s && s.confidence !== 'low');
  return `<div class="card sort-card"><h3>Sort out "Other" first <small class="pill warn">${n}</small></h3>
    <p class="sub">${fmt(total, { whole: true })} across ${n} payments isn't in a category, so the insights below can't see where it goes. Biggest first: tap a suggestion, or pick a category. It applies to every payment from that merchant.</p>
    ${sugs.slice(0, 6).map(({ g, s }) => `<div class="sort-row"><div class="grow"><b class="ellipsis">${esc(g.merchant)}</b><div class="sub">${g.txs.length}× · ${fmt(g.total, { whole: true })}${s ? ` · ${esc(s.reason)}` : ''}</div></div>
      <div class="sort-acts">${s ? `<button class="chip sel" data-action="ins-sort" data-merchant="${esc(g.merchant)}" data-dir="${g.txs.every((t) => t.amount > 0) ? 'in' : 'out'}" data-cat="${s.category}">${esc(catName(s.category))} ✓</button>` : ''}<select class="cat-select" data-change="ins-sort-pick" data-merchant="${esc(g.merchant)}" data-dir="${g.txs.every((t) => t.amount > 0) ? 'in' : 'out'}" aria-label="Choose a category for ${esc(g.merchant)}"><option value="">${s ? 'Other…' : 'Choose…'}</option>${PICKABLE.map((c) => `<option value="${c.id}">${c.icon} ${esc(c.name)}</option>`).join('')}<option value="transfer">↔️ Transfer between my accounts</option></select></div></div>`).join('')}
    <div class="row gap wrap">${ready.length ? `<button class="btn primary grow" data-action="ins-sort-all">Accept ${ready.length} confident suggestion${ready.length === 1 ? '' : 's'}</button>` : ''}<a class="btn ghost grow" href="#/categories">${groups.length === 1 ? 'Open Categories' : `All ${groups.length} merchants`}${state.settings.apiKey ? ' · look up with Claude' : ''}</a></div></div>`;
}

function askCard() {
  const a = ui.ask;
  return `<div class="card ask-card"><h3>Ask about your money</h3>
    <div class="ask-row"><input id="ins-q" placeholder="e.g. How can we cut £300 a month?" value="${esc(a?.q || '')}" enterkeyhint="send"><button class="btn primary" data-action="ins-ask" ${ui.asking ? 'disabled' : ''}>${ui.asking ? '…' : 'Ask'}</button></div>
    <div class="cal-filters">${['Where is most of our money going?', 'How do we stop going over each month?', 'What should we cut first?', 'Can we afford to save for a house deposit?'].map((q) => `<button class="chip" data-action="ins-ask-q" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
    ${a?.r ? `<div class="ask-answer"><p>${esc(a.r.answer)}</p>${a.r.steps?.length ? `<ol class="act-steps">${a.r.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}</div>` : ''}
    <p class="sub">${state.settings.apiKey ? 'Claude sees this month\'s totals by category, your regular payments and top merchants: never raw transactions, names or account numbers.' : '<a href="#/settings">Add your Claude key in Settings</a> to ask questions.'}</p></div>`;
}

const SEC_ICONS = {
  cards: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h3"/>',
  spend: '<path d="M4 7h16v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M8 7V5a4 4 0 0 1 8 0v2"/>',
  bills: '<path d="M7 3h10v18l-2.5-1.5L12 21l-2.5-1.5L7 21z"/><path d="M10 8h4M10 12h4"/>',
  save: '<path d="M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10z"/>',
};
const SECTIONS = [
  ['cards', 'Credit cards', (i) => /^card-/.test(i.id) || i.id === 'fees'],
  ['spend', 'Spending', (i) => /^(over|up|down)-/.test(i.id) || ['food', 'small'].includes(i.id)],
  ['bills', 'Bills & subscriptions', (i) => ['subs', 'streaming', 'music', 'consolidate'].includes(i.id) || /^(rise|new)-/.test(i.id)],
  ['save', 'Saving', () => true],
];
const secIcon = (k) => `<span class="sec-ic ${k}"><svg viewBox="0 0 24 24" aria-hidden="true">${SEC_ICONS[k]}</svg></span>`;

/** Credit cards at a glance for the month on screen: owed, new spending, interest and fees, each card. */
function cardsSummary() {
  const credit = state.accounts.filter((a) => a.type === 'credit');
  if (!credit.length) return '';
  const m = state.month;
  const cs = state.derived.cards;
  const inM = state.txs.filter((t) => t.date.startsWith(m) && credit.some((a) => a.id === t.accountId));
  const isFee = (t) => t.category === 'fees' || /\b(INTEREST|LATE|FEE|CHARGE)\b/i.test(t.description);
  const spend = inM.filter((t) => t.amount < 0 && t.category !== 'transfer' && !isFee(t)).reduce((a, t) => a - t.amount, 0);
  const fees = inM.filter((t) => t.amount < 0 && isFee(t)).reduce((a, t) => a - t.amount, 0);
  const paid = inM.filter((t) => t.amount > 0 && (t.category === 'transfer' || /PAYMENT/i.test(t.description))).reduce((a, t) => a + t.amount, 0);
  const rows = cs.cards.map((c) => {
    const a = c.account;
    const lim = a.limit || null;
    const use = lim && c.owed != null ? c.owed / lim : null;
    const ms = inM.filter((t) => t.accountId === a.id && t.amount < 0 && t.category !== 'transfer' && !isFee(t)).reduce((x, t) => x - t.amount, 0);
    return `<a class="cc-row" href="#/cards"><div class="grow"><b class="ellipsis">${esc(a.name)}</b><div class="sub">${ms ? `${fmt(ms, { whole: true })} spent this month` : 'Nothing new this month ✓'}${c.apr ? ` · ${c.apr}% APR` : ''}${lim ? ` · limit ${fmt(lim, { whole: true })}` : ''}</div>
      ${use != null ? `<div class="cat-bar ${use > 1 ? 'over' : use > 0.75 ? 'warn' : ''}"><span style="width:${Math.min(100, use * 100).toFixed(1)}%"></span></div>` : ''}</div>
      <div class="cc-owed"><b class="${c.owed > 0 ? 'neg' : 'pos'}">${c.owed == null ? '?' : fmt(c.owed, { whole: true })}</b><small>${use != null ? `${Math.round(use * 100)}% used` : 'owed'}</small></div></a>`;
  }).join('');
  return `<div class="card cc-card">
    <div class="cc-stats">
      <div><span class="label">Owed now</span><b class="${cs.totalOwed > 0 ? 'neg' : 'pos'}">${fmt(cs.totalOwed, { whole: true })}</b></div>
      <div><span class="label">New spending</span><b class="${spend > 0 ? 'warn-text' : 'pos'}">${fmt(spend, { whole: true })}</b></div>
      <div><span class="label">Interest & fees</span><b class="${fees > 0 ? 'neg' : ''}">${fmt(fees, { whole: true })}</b></div>
      <div><span class="label">Paid off</span><b class="pos">${fmt(paid, { whole: true })}</b></div>
    </div>
    ${fees > 0 ? `<p class="sub neg">You paid ${fmt(fees, { whole: true })} in interest and fees in ${esc(monthLabel(m, { short: true }))}: about ${fmt(fees * 12, { whole: true })} a year for nothing.</p>` : ''}
    ${rows}
    <div class="row gap wrap cc-actions"><a class="btn primary grow" href="#/cards">Payoff plan</a><a class="btn ghost grow" href="#/movebills">Move bills off cards</a></div>
  </div>`;
}

function sections(shown, card) {
  if (!shown.length && ui.filter !== 'todo' && ui.filter !== 'all') return `<p class="muted center">${ui.filter === 'done' ? 'Nothing marked done yet.' : 'Nothing here this month.'}</p>`;
  const used = new Set();
  const out = SECTIONS.map(([k, title, test]) => {
    const items = shown.filter((x) => !used.has(x.n) && test(x.i));
    items.forEach((x) => used.add(x.n));
    const summary = k === 'cards' && (ui.filter === 'todo' || ui.filter === 'all') ? cardsSummary() : '';
    if (!items.length && !summary) return '';
    return `<section class="ins-sec-wrap"><div class="ins-sec">${secIcon(k)}<h2>${title}</h2>${items.length ? `<small>${items.length}</small>` : ''}</div>${summary}${items.map(card).join('')}</section>`;
  }).join('');
  return out || '<p class="muted center">Nothing to flag this month. 👏</p>';
}

function supportCard() {
  const items = [HELP.stepchange, HELP.nationaldebtline, HELP.moneyhelper, { name: 'Citizens Advice: money and debt', url: 'https://www.citizensadvice.org.uk/debt-and-money/', tel: '0800 144 8848' },
    { name: 'Breathing Space: 60 days\' pause on interest and debt action (through a debt adviser)', url: 'https://www.gov.uk/government/publications/debt-respite-scheme-breathing-space-guidance' },
    HELP.benefitsCheck, { name: 'Turn2us: grants and benefits search', url: 'https://www.turn2us.org.uk/' }, { name: 'Maternity Action: maternity pay and rights', url: 'https://maternityaction.org.uk/' }];
  return `<div class="card"><h3>Free help and support</h3><p class="sub">Free, confidential, and they won't judge. Worth a call if bills or card balances are getting on top of you.</p>
    <div class="act-links">${items.map((h) => `<a class="act-link" href="${esc(h.url)}" target="_blank" rel="noopener">${esc(h.name)} ↗</a>${h.tel ? `<a class="act-tel" href="tel:${esc(h.tel.replace(/\s+/g, ''))}">📞 ${esc(h.tel)}</a>` : ''}`).join('')}</div></div>`;
}

export function render() {
  if (!state.txs.length) return emptyState({ title: 'Suggestions appear here', body: 'Each month I compare your spending with your usual, check your budget, and look for subscriptions, fees and price rises.' });
  const { budget, recurring, months } = state.derived;
  const list = buildInsights({ txs: state.txs, key: state.month, budget, recurring, accounts: state.accounts, today: state.derived.today, incomplete: state.derived.incomplete });
  const st = list.map((i) => statusOf(i));
  const vis = list.map((i, n) => ({ i, n, st: st[n] })).filter((x) => x.st !== 'dismiss');
  const todo = vis.filter((x) => x.st === 'todo' && x.i.level !== 'good');
  const good = vis.filter((x) => x.i.level === 'good' && x.st === 'todo');
  const saving = vis.filter((x) => x.st === 'todo' && x.i.saving > 0 && x.i.level !== 'good');
  const done = vis.filter((x) => x.st === 'done' || x.st === 'snooze');
  const shown = { todo, saving, good, done, all: vis }[ui.filter] || todo;
  const real = realisticSaving(todo.map((x) => x.i));
  const report = reports[state.month];
  lastList = list;
  const card = ({ i, n, st: s2 }) => `<div class="card insight lvl-${i.level} ${s2 !== 'todo' ? 'is-done' : ''}">
    <button class="ins-main" data-action="ins-open" data-n="${n}"><span class="lvl-tag ${i.level}">${{ alert: 'Needs action', warn: 'Worth a look', tip: 'Tip', good: 'Good news' }[i.level] || 'Tip'}</span><div class="insight-title">${s2 === 'done' ? '✓ ' : s2 === 'snooze' ? '💤 ' : ''}${esc(i.title)}</div><div class="sub">${esc(i.detail)}</div></button>
    <div class="ins-foot">${i.saving > 0 && i.level !== 'good' ? `<span class="pill save">~${fmt(i.saving, { whole: true })}/mo</span>` : '<span></span>'}
      <span class="ins-acts">${s2 === 'todo' ? `<button class="ins-act" data-action="ins-state" data-id="${esc(i.id)}" data-s="done" aria-label="Mark done">✓ Done</button><button class="ins-act" data-action="ins-state" data-id="${esc(i.id)}" data-s="snooze" aria-label="Snooze for 30 days">Snooze</button><button class="ins-act" data-action="ins-state" data-id="${esc(i.id)}" data-s="dismiss" aria-label="Not relevant">✕</button>` : `<button class="ins-act" data-action="ins-state" data-id="${esc(i.id)}" data-s="todo">Undo</button>`}
      <button class="ins-go" data-action="ins-open" data-n="${n}">What to do ›</button></span></div></div>`;
  const dismissed = list.filter((_, n) => st[n] === 'dismiss').length;
  return `
  ${monthSwitcher(state.month, months)}
  ${hideable('missing-ins:' + state.month, state.derived.coverage.missing.filter((m) => m.month === state.month).length, state.derived.coverage.missing.some((m) => m.month === state.month) ? `<div class="card banner"><b>This month is missing a statement</b><span class="sub">Suggestions may be off until it's imported. See Accounts → Statements.</span></div>` : '')}
  <div class="ins-sum">
    <div><span class="label">To do</span><b>${todo.length}</b></div>
    <div><span class="label">Realistic saving</span><b class="pos">${fmt(real.total, { whole: true })}<small>/mo</small></b></div>
    <div><span class="label">Done</span><b>${done.length}</b></div>
  </div>
  ${real.total ? `<a class="plan-link" href="#/track">Turn these into a plan you can tick off ›</a>` : ''}
  ${sortOtherCard()}
  <div class="cal-filters ins-filters" role="radiogroup" aria-label="Show">${[['todo', `To do · ${todo.length}`], ['saving', `Saving ideas · ${saving.length}`], ['good', `Good news · ${good.length}`], ['done', `Done · ${done.length}`], ['all', 'All']].map(([v, l]) => `<button class="chip ${ui.filter === v ? 'sel' : ''}" role="radio" aria-checked="${ui.filter === v}" data-action="ins-filter" data-f="${v}">${l}</button>`).join('')}</div>
  ${sections(shown, card)}
  ${dismissed ? `<button class="link small-link" data-action="ins-undismiss">Show ${dismissed} dismissed</button>` : ''}
  ${askCard()}
  <div class="card ai-card">
    <div class="row between"><h3>Monthly review by Claude</h3>${report ? `<button class="link" data-action="ai-report">Refresh</button>` : ''}</div>
    ${report ? renderReport(report) : `<p class="muted">A written review of ${esc(monthLabel(state.month))}: what changed, what to fix, and a plan for next month. Only totals are sent, never your raw transactions.</p>
      <button class="btn primary full" data-action="ai-report" ${loadingReport ? 'disabled' : ''}>${loadingReport ? 'Writing your review…' : state.settings.apiKey ? 'Write my monthly review' : 'Add API key in Settings first'}</button>`}
  </div>
  ${supportCard()}`;
}

function renderReport(r) {
  const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  const sec = (title, items) => (list(items).length ? `<h4>${title}</h4><ul>${list(items).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
  return `<p class="report-headline">${esc(r.headline)}</p>
    ${sec('What changed', r.what_changed)}${sec('Wins', r.wins)}${sec('Concerns', r.concerns)}
    ${list(r.actions).length ? `<h4>Do this next month</h4><ol class="actions">${list(r.actions).map((a) => `<li><b>${esc(a.title)}</b>${a.monthly_saving_gbp > 0 ? ` <span class="pill save">~£${Math.round(a.monthly_saving_gbp)}/mo</span>` : ''}<div class="sub">${esc(a.detail)}</div></li>`).join('')}</ol>` : ''}
    ${r.next_month_focus ? `<div class="focus">🎯 ${esc(r.next_month_focus)}</div>` : ''}`;
}

function summaryForAI(month) {
  const { budget, recurring } = state.derived;
  const cmp = compareMonths(state.txs, month);
  const p = (v) => Math.round(v) / 100;
  return {
    month: monthLabel(month),
    income: p(cmp.cur.income),
    spent: p(cmp.cur.spend),
    moved_to_savings: p(cmp.cur.saved),
    savings_goal: p(budget.savingsTarget),
    categories: cmp.rows.filter((r) => r.current || r.average).map((r) => ({
      category: catName(r.category), this_month: p(r.current), last_month: p(r.previous), three_month_avg: p(r.average),
      budget: budget.byCategory[r.category] ? p(budget.byCategory[r.category].budget) : null,
    })),
    top_merchants: cmp.cur.merchants.slice(0, 12).map((m) => ({ name: m.name, total: p(m.total), payments: m.count, category: catName(m.category) })),
    new_merchants: cmp.newMerchants.map((m) => ({ name: m.name, total: p(m.total) })),
    recurring_payments: recurring.filter((r) => r.direction === 'out' && r.active).map((r) => ({ name: r.name, monthly: p(r.amount), type: r.type, category: catName(r.category), price_change: r.priceChange ? p(r.priceChange) : 0 })),
    number_of_accounts: state.accounts.length,
  };
}

let lastList = [];
async function setState(id, status) {
  const all = { ...(state.settings.insightState || {}) };
  if (status === 'todo') delete all[id];
  else all[id] = { status, at: state.derived.today, until: status === 'dismiss' ? null : addDays(state.derived.today, 30) };
  await saveSettings({ insightState: all });
}
async function ask(q, rerender) {
  if (!state.settings.apiKey) { location.hash = '#/settings'; return; }
  if (!q) return toast('Type a question', { error: true });
  ui.asking = true; ui.ask = { q }; rerender();
  try {
    const r = await aiAsk({ apiKey: state.settings.apiKey, model: state.settings.model, question: q, context: { ...summaryForAI(state.month), monthly_income_expected: Math.round((state.derived.budget.income || 0)) / 100 } });
    ui.ask = { q, r };
  } catch (e) { toast(e.message, { error: true }); }
  ui.asking = false; rerender();
}

export const changes = {
  'ins-sort-pick': async (el, rerender) => {
    if (!el.value) return;
    const n = await applyMerchantCategory(el.dataset.merchant, el.value, { direction: el.dataset.dir || 'out' });
    recompute(); toast(`${n} payment${n === 1 ? '' : 's'} moved to ${catName(el.value)}`); rerender();
  },
};

export const actions = {
  'ins-filter': (el, rerender) => { ui.filter = el.dataset.f; rerender(); },
  'ins-state': async (el, rerender) => {
    await setState(el.dataset.id, el.dataset.s);
    toast({ done: 'Marked done: it comes back in 30 days if it still applies', snooze: 'Snoozed for 30 days', dismiss: 'Dismissed', todo: 'Back on your list' }[el.dataset.s]);
    rerender();
  },
  'ins-undismiss': async (_, rerender) => {
    const all = { ...(state.settings.insightState || {}) };
    for (const [k, v] of Object.entries(all)) if (v.status === 'dismiss') delete all[k];
    await saveSettings({ insightState: all }); rerender();
  },
  'ins-sort': async (el, rerender) => {
    const n = await applyMerchantCategory(el.dataset.merchant, el.dataset.cat, { direction: el.dataset.dir || 'out' });
    recompute(); toast(`${n} payment${n === 1 ? '' : 's'} moved to ${catName(el.dataset.cat)}`); rerender();
  },
  'ins-sort-all': async (_, rerender) => {
    const all = state.allTxs || state.txs;
    const ready = otherMerchants(state.txs).map((g) => [g, suggestCategory(g, all, { userRules: state.settings.userRules, saved })]).filter(([, x]) => x && x.confidence !== 'low');
    let n = 0;
    for (const [g, x] of ready) n += await applyMerchantCategory(g.merchant, x.category, { direction: g.txs.every((t) => t.amount > 0) ? 'in' : 'out' });
    recompute(); toast(`${n} payments sorted into categories`); rerender();
  },
  'ins-ask': (_, rerender) => ask(document.getElementById('ins-q')?.value.trim(), rerender),
  'ins-ask-q': async (el, rerender) => { closeSheet(); await ask(el.dataset.q, rerender); document.querySelector('.ask-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  'ins-open': (el) => { const i = lastList[+el.dataset.n]; if (i) openInsight(i); },
  'ai-report': async (_, rerender) => {
    if (!state.settings.apiKey) { location.hash = '#/settings'; return; }
    const month = state.month;
    loadingReport = true; reports[month] = null; rerender();
    try {
      const r = await aiMonthlyReport({ apiKey: state.settings.apiKey, model: state.settings.model, summary: summaryForAI(month) });
      reports[month] = r;
      await db.kvSet('report:' + month, r);
    } catch (e) { toast(e.message, { error: true }); }
    loadingReport = false;
    rerender();
  },
};
