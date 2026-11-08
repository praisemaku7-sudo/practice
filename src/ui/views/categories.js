// Categories: where the money goes (breakdown and key figures), sort out everything in "Other"
// with suggested categories, and have Claude check every category against what the business is.
import { state, applyMerchantCategory } from '../../state.js';
import { db } from '../../lib/db.js';
import { esc, toast } from '../dom.js';
import { fmt } from '../../lib/money.js';
import { CATEGORIES, CAT, catName, catKind, isSpendCategory } from '../../lib/categories.js';
import { monthKey, monthLabel, addMonths } from '../../lib/dates.js';
import { otherMerchants, merchantGroups, suggestCategory } from '../../lib/catsuggest.js';
import { catChip } from '../common.js';

const ai = () => import('../../lib/ai.js');
const ui = { period: '3m', open: null, busy: null, showAllOther: false };
let saved = {};      // merchant -> {category, business, confidence, at}: Claude's online look-ups
let check = null;    // {at, items: [{merchant, current, suggested, business, confidence}]}

export async function preload() {
  saved = (await db.kvGet('catSuggest', {})) || {};
  check = await db.kvGet('catCheck', null);
}

const PICKABLE = CATEGORIES.filter((c) => !['transfer', 'excluded'].includes(c.id));
const select = (id, current) => `<select class="cat-select" data-change="cat-pick" data-merchant="${esc(id)}" aria-label="Choose a category">
  <option value="">Choose…</option>${PICKABLE.map((c) => `<option value="${c.id}" ${c.id === current ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('')}</select>`;

/** The months a period covers, and the same length of time just before it. */
function periodMonths() {
  const now = monthKey(state.derived.today);
  if (ui.period === 'month') return { months: [state.month || now], label: monthLabel(state.month || now) };
  if (ui.period === '3m') {
    const last = addMonths(now, -1);
    const months = [addMonths(last, -2), addMonths(last, -1), last];
    return { months, label: `${monthLabel(months[0], { short: true })} – ${monthLabel(last, { short: true })}` };
  }
  const all = state.derived.months.filter((m) => m <= now);
  return { months: all, label: all.length ? `${monthLabel(all[0], { short: true })} – ${monthLabel(all[all.length - 1], { short: true })}` : 'All' };
}

function spendByCategory(txs) {
  const by = {};
  for (const t of txs) {
    if (!isSpendCategory(t.category)) continue;
    by[t.category] = (by[t.category] || 0) - t.amount; // refunds (money in) reduce the category
  }
  return by;
}

export function render() {
  if (!state.txs.length) return '<h1 class="page-title">Categories</h1><div class="card"><p class="muted">Import a statement to see where your money goes.</p></div>';
  const { months, label } = periodMonths();
  const set = new Set(months);
  const prevSet = new Set(months.map((m) => addMonths(m, -months.length)));
  const txs = state.txs.filter((t) => set.has(monthKey(t.date)));
  const prevTxs = state.txs.filter((t) => prevSet.has(monthKey(t.date)));
  const by = spendByCategory(txs), prev = spendByCategory(prevTxs);
  const total = Object.values(by).reduce((a, v) => a + Math.max(0, v), 0);
  const n = Math.max(1, months.length);
  const spendTxs = txs.filter((t) => isSpendCategory(t.category) && t.amount < 0);
  const otherTotal = Math.max(0, by.other || 0);
  const rows = Object.entries(by).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const top = rows[0]?.[1] || 1;
  const kinds = { fixed: 0, essential: 0, personal: 0 };
  for (const [c, v] of rows) if (kinds[catKind(c)] != null) kinds[catKind(c)] += v;
  const movers = rows.map(([c, v]) => [c, v - (prev[c] || 0)]).filter(([c]) => prev[c] != null).sort((a, b) => b[1] - a[1]);
  const up = movers[0] && movers[0][1] > 500 ? movers[0] : null;
  const down = movers.length && movers[movers.length - 1][1] < -500 ? movers[movers.length - 1] : null;
  const merchants = merchantGroups(spendTxs).sort((a, b) => b.total - a.total);

  // "Other" to sort out (the whole tracked period, so nothing is missed).
  const others = otherMerchants(state.txs);
  const all = state.allTxs || state.txs;
  const withSug = others.map((g) => ({ ...g, sug: suggestCategory(g, all, { userRules: state.settings.userRules, saved }) }));
  const ready = withSug.filter((g) => g.sug && g.sug.confidence !== 'low');
  const shownOthers = ui.showAllOther ? withSug : withSug.slice(0, 15);
  const pending = (check?.items || []).filter((i) => !i.done);

  const kindBar = total ? `<div class="kind-bar">${[['fixed', 'Bills & fixed'], ['essential', 'Essentials'], ['personal', 'Lifestyle']].map(([k, l]) => `<span class="kb-${k}" style="width:${((kinds[k] / total) * 100).toFixed(1)}%" title="${l}"></span>`).join('')}</div>
    <div class="kind-legend">${[['fixed', 'Bills & fixed'], ['essential', 'Essentials'], ['personal', 'Lifestyle']].map(([k, l]) => `<span><i class="kb-${k}"></i>${l} ${Math.round((kinds[k] / total) * 100)}%</span>`).join('')}</div>` : '';

  return `<h1 class="page-title">Categories</h1>
  <div class="seg three period-seg">${[['month', 'Month'], ['3m', 'Last 3 months'], ['all', 'Since tracking']].map(([k, l]) => `<button class="${ui.period === k ? 'on' : ''}" data-action="cat-period" data-p="${k}">${l}</button>`).join('')}</div>

  <div class="card hero">
    <div class="label">Spending · ${esc(label)}</div>
    <div class="big">${fmt(total, { whole: true })}</div>
    <div class="stat-grid mi-grid">
      <div><span class="label">Per month</span><b>${fmt(Math.round(total / n), { whole: true })}</b></div>
      <div><span class="label">Payments</span><b>${spendTxs.length}</b></div>
      <div><span class="label">Average payment</span><b>${fmt(spendTxs.length ? Math.round(total / spendTxs.length) : 0)}</b></div>
      <div><span class="label">Sorted into categories</span><b class="${otherTotal / Math.max(total, 1) > 0.1 ? 'neg' : 'pos'}">${total ? Math.round(100 - (otherTotal / total) * 100) : 100}%</b></div>
    </div>
    ${kindBar}
    ${up || down ? `<div class="sub mi-movers">${up ? `▲ <b>${esc(catName(up[0]))}</b> up ${fmt(up[1], { whole: true })}` : ''}${up && down ? ' · ' : ''}${down ? `▼ <b>${esc(catName(down[0]))}</b> down ${fmt(-down[1], { whole: true })}` : ''} <span class="muted">vs the ${months.length > 1 ? `${months.length} months` : 'month'} before</span></div>` : ''}
  </div>

  ${others.length ? `<div class="card" id="other">
    <div class="row between"><h3>Sort out "Other"</h3><span class="pill warn">${others.length} merchant${others.length === 1 ? '' : 's'} · ${fmt(others.reduce((a, g) => a + g.total, 0), { whole: true })}</span></div>
    <p class="sub">Pick a category once and every payment to that merchant moves, now and in future imports.</p>
    ${ready.length ? `<button class="btn primary full" data-action="cat-accept-all">Accept ${ready.length} suggestion${ready.length === 1 ? '' : 's'}</button>` : ''}
    ${shownOthers.map((g) => `<div class="other-row">
      <div class="row between"><b class="grow">${esc(g.merchant)}</b><b>${fmt(g.total)}</b></div>
      <div class="sub">${g.txs.length} payment${g.txs.length === 1 ? '' : 's'} · "${esc(String(g.sample).slice(0, 60))}"</div>
      ${g.sug ? `<div class="sug ${g.sug.confidence}">Suggested: ${catChip(g.sug.category)} <b>${esc(catName(g.sug.category))}</b> <span class="muted">· ${esc(g.sug.reason)}</span></div>` : '<div class="sub">No suggestion yet. Choose one, or ask Claude to look it up.</div>'}
      <div class="row gap">${g.sug ? `<button class="btn primary" data-action="cat-accept" data-merchant="${esc(g.merchant)}" data-cat="${g.sug.category}">Accept</button>` : ''}${select(g.merchant, '')}</div>
    </div>`).join('')}
    ${withSug.length > 15 && !ui.showAllOther ? `<button class="btn ghost full" data-action="cat-more">Show all ${withSug.length}</button>` : ''}
  </div>` : '<div class="card"><b>✓ Nothing in "Other"</b><div class="sub">Every payment has a category.</div></div>'}

  <div class="card ai-card">
    <h3>Check categories with Claude</h3>
    <p class="sub">Claude looks up merchants it doesn't know online (local shops, company names) and says which category fits. Only merchant names, one statement line and a typical amount are sent. Uses your Claude credit: roughly 20–40p per batch of 30 merchants.</p>
    ${state.settings.apiKey ? `<div class="row gap wrap-sm">
      <button class="btn ${others.length ? 'primary' : 'ghost'} grow" data-action="cat-ai" data-scope="other" ${ui.busy || !others.length ? 'disabled' : ''}>${ui.busy === 'other' ? 'Looking up…' : `Look up "Other" (${Math.min(others.length, 60)})`}</button>
      <button class="btn ghost grow" data-action="cat-ai" data-scope="all" ${ui.busy ? 'disabled' : ''}>${ui.busy === 'all' ? 'Checking…' : 'Check all categories'}</button></div>` : '<a class="btn ghost full" href="#/settings">Add your Claude API key in Settings first</a>'}
    ${check ? `<p class="sub">Last checked ${new Date(check.at).toLocaleDateString('en-GB')}: ${check.checked || 0} merchants, ${check.items.length} looked wrong${pending.length ? `, ${pending.length} still to review` : ''}.</p>` : ''}
    ${pending.length ? `${pending.filter((i) => i.confidence === 'high').length ? `<button class="btn primary full" data-action="cat-check-all">Fix the ${pending.filter((i) => i.confidence === 'high').length} Claude is sure about</button>` : ''}
      ${pending.map((i) => `<div class="other-row">
        <div class="row between"><b class="grow">${esc(i.merchant)}</b><span class="pill ${i.confidence === 'high' ? 'ok' : ''}">${esc(i.confidence)}</span></div>
        <div class="sub">${esc(i.business)}</div>
        <div class="sug">${catChip(i.current)} ${esc(catName(i.current))} → ${catChip(i.suggested)} <b>${esc(catName(i.suggested))}</b></div>
        <div class="row gap"><button class="btn primary" data-action="cat-check-ok" data-merchant="${esc(i.merchant)}">Change it</button><button class="btn ghost" data-action="cat-check-keep" data-merchant="${esc(i.merchant)}">Keep ${esc(catName(i.current))}</button></div>
      </div>`).join('')}` : ''}
  </div>

  <div class="card">
    <h3>By category</h3>
    ${rows.map(([c, v]) => {
      const p = prev[c];
      const diff = p != null ? v - p : null;
      const open = ui.open === c;
      const tops = open ? merchants.filter((m) => m.category === c).slice(0, 8) : [];
      return `<button class="cat-row" data-action="cat-open" data-cat="${c}">
        <div class="row between">${catChip(c)}<span class="grow"><b>${esc(catName(c))}</b><small class="muted"> · ${Math.round((v / Math.max(total, 1)) * 100)}%</small></span><b>${fmt(v, { whole: true })}</b></div>
        <div class="cat-bar"><span style="width:${((v / top) * 100).toFixed(1)}%;background:${CAT[c]?.color || 'var(--muted)'}"></span></div>
        <div class="sub">${spendTxs.filter((t) => t.category === c).length} payments · ${fmt(Math.round(v / n), { whole: true })}/month${diff != null && Math.abs(diff) >= 100 ? ` · <span class="${diff > 0 ? 'neg' : 'pos'}">${diff > 0 ? '▲' : '▼'} ${fmt(Math.abs(diff), { whole: true })}</span>` : ''}</div>
      </button>
      ${open ? `<div class="cat-detail">${tops.map((m) => `<div class="row between"><span class="grow">${esc(m.merchant)} <small class="muted">${m.txs.length}×</small></span><b>${fmt(m.total)}</b></div>
        <div class="row gap cat-move"><small class="muted grow">Wrong category?</small>${select(m.merchant, c)}</div>`).join('') || '<p class="sub">No payments.</p>'}</div>` : ''}`;
    }).join('') || '<p class="muted">No spending in this period.</p>'}
  </div>

  <div class="card">
    <h3>Top merchants</h3>
    ${merchants.slice(0, 10).map((m) => `<div class="list-row">${catChip(m.category)}<div class="grow"><div>${esc(m.merchant)}</div><div class="sub">${esc(catName(m.category))} · ${m.txs.length}×</div></div><b>${fmt(m.total, { whole: true })}</b></div>`).join('')}
  </div>`;
}

async function runCheck(scope, rerender) {
  const all = state.txs;
  let groups;
  if (scope === 'other') groups = otherMerchants(all).slice(0, 60);
  else groups = merchantGroups(all.filter((t) => isSpendCategory(t.category) && t.category !== 'other' && t.amount < 0)).sort((a, b) => b.total - a.total).slice(0, 60);
  if (!groups.length) return toast('Nothing to check');
  ui.busy = scope; rerender();
  try {
    const { aiCategorizeMerchants } = await ai();
    const current = scope === 'all' ? Object.fromEntries(groups.map((g) => [g.merchant, g.category])) : {};
    const asInput = (g) => ({ merchant: g.merchant, sample: String(g.sample).slice(0, 80), direction: g.txs.every((t) => t.amount < 0) ? 'money out' : 'money in', typical: Math.round(g.total / g.txs.length / 100), count: g.txs.length });
    const batches = [];
    for (let i = 0; i < groups.length; i += 30) batches.push(groups.slice(i, i + 30));
    const results = (await Promise.all(batches.map((b) => aiCategorizeMerchants({ apiKey: state.settings.apiKey, model: state.settings.model, merchants: b.map(asInput), current })))).flat();
    const at = Date.now();
    for (const r of results) if (r?.merchant && CAT[r.category]) saved[r.merchant] = { category: r.category, business: r.business, confidence: r.confidence, at };
    await db.kvSet('catSuggest', saved);
    if (scope === 'all') {
      const items = results.filter((r) => current[r.merchant] && CAT[r.category] && r.category !== current[r.merchant] && r.confidence !== 'low')
        .map((r) => ({ merchant: r.merchant, current: current[r.merchant], suggested: r.category, business: r.business, confidence: r.confidence }));
      check = { at, checked: results.length, items };
      await db.kvSet('catCheck', check);
      toast(items.length ? `${items.length} look wrong: review them below` : `All ${results.length} look right ✓`);
    } else {
      toast(`Looked up ${results.length} merchant${results.length === 1 ? '' : 's'}: suggestions updated`);
    }
  } catch (e) { toast(e.message, { error: true }); }
  ui.busy = null; rerender();
}

async function apply(merchant, cat, rerender, quiet = false) {
  const n = await applyMerchantCategory(merchant, cat, { direction: 'out' });
  if (!quiet) toast(`${n} payment${n === 1 ? '' : 's'} → ${catName(cat)}`);
  rerender();
  return n;
}

export const actions = {
  'cat-period': (el, rerender) => { ui.period = el.dataset.p; ui.open = null; rerender(); },
  'cat-open': (el, rerender) => { ui.open = ui.open === el.dataset.cat ? null : el.dataset.cat; rerender(); },
  'cat-more': (_, rerender) => { ui.showAllOther = true; rerender(); },
  'cat-accept': (el, rerender) => apply(el.dataset.merchant, el.dataset.cat, rerender),
  'cat-accept-all': async (_, rerender) => {
    const all = state.allTxs || state.txs;
    const ready = otherMerchants(state.txs).map((g) => [g, suggestCategory(g, all, { userRules: state.settings.userRules, saved })]).filter(([, s]) => s && s.confidence !== 'low');
    let n = 0;
    for (const [g, s] of ready) n += await applyMerchantCategory(g.merchant, s.category, { direction: 'out' });
    toast(`${n} payments sorted into categories`); rerender();
  },
  'cat-ai': (el, rerender) => runCheck(el.dataset.scope, rerender),
  'cat-check-ok': async (el, rerender) => {
    const item = check.items.find((i) => i.merchant === el.dataset.merchant);
    if (!item) return;
    item.done = true; await db.kvSet('catCheck', check);
    await apply(item.merchant, item.suggested, rerender);
  },
  'cat-check-keep': async (el, rerender) => {
    const item = check.items.find((i) => i.merchant === el.dataset.merchant);
    if (!item) return;
    item.done = true; await db.kvSet('catCheck', check);
    await apply(item.merchant, item.current, rerender, true); // remember your choice so it isn't flagged again
    toast(`Kept ${catName(item.current)}`);
  },
  'cat-check-all': async (_, rerender) => {
    let n = 0;
    for (const item of check.items.filter((i) => !i.done && i.confidence === 'high')) { item.done = true; n += await applyMerchantCategory(item.merchant, item.suggested, { direction: 'out' }); }
    await db.kvSet('catCheck', check);
    toast(`${n} payments moved`); rerender();
  },
};

export const changes = {
  'cat-pick': async (el, rerender) => { if (el.value) await apply(el.dataset.merchant, el.value, rerender); },
};
