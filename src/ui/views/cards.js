// Credit cards: get every card to £0 owed, and stop new spending on them.
import { state, saveSettings, recompute } from '../../state.js';
import { db } from '../../lib/db.js';
import { esc, toast, openSheet, closeSheet } from '../dom.js';
import { fmt, parsePrice } from '../../lib/money.js';
import { payoffPlan } from '../../lib/credit.js';
import { monthKey, monthLabel, prettyDate } from '../../lib/dates.js';
import { progressBar } from '../charts.js';
import { catChip } from '../common.js';

export function render() {
  const { cards: sum, suspects, budget } = state.derived;
  const s = state.settings;
  const suspectBox = suspects.length ? `<div class="card banner"><b>Are these credit cards?</b>
      <span class="sub">They look like cards but are filed as ${suspects.map((a) => `${esc(a.name)} (${esc(a.type)})`).join(', ')}.</span>
      <div class="chip-grid">${suspects.map((a) => `<button class="chip" data-action="mark-credit" data-id="${esc(a.id)}">💳 ${esc(a.name)} is a credit card</button>`).join('')}</div></div>` : '';
  if (!sum.cards.length) {
    return `<h1 class="page-title">Credit cards</h1>${suspectBox}
    <div class="card empty"><div class="empty-art">💳</div><h2>No credit cards yet</h2>
    <p class="muted">Import your credit card statements, or mark an existing account as a credit card in Accounts → tap the account → Type.</p>
    <a class="btn primary" href="#/setup">Set account types</a></div>`;
  }
  const monthly = state.eff.cardPayoff ?? 0;
  const plan = payoffPlan(sum.cards, monthly, { method: s.cardMethod, startMonth: monthKey(state.derived.today) });
  const progress = sum.totalAtStart ? Math.max(0, sum.totalAtStart - sum.totalOwed) : null;
  const clean = sum.monthSpend === 0;
  const streak = sum.lastPurchase ? Math.max(0, Math.round((Date.parse(state.derived.today) - Date.parse(sum.lastPurchase)) / 86400000)) : null;
  // A sensible suggestion: what's unallocated plus what's currently being paid.
  const suggestion = Math.max(0, Math.round(((budget.unallocated > 0 ? budget.unallocated : 0) + monthly) / 500) * 500) || 0;

  return `
  <h1 class="page-title">Credit cards</h1>
  ${suspectBox}
  <div class="card hero ${sum.totalOwed === 0 && !sum.unknownBalances ? 'verdict yes' : ''}">
    <div class="label">Owed across ${sum.cards.length} card${sum.cards.length > 1 ? 's' : ''} · goal £0</div>
    <div class="big ${sum.totalOwed > 0 ? 'neg' : 'pos'}">${fmt(sum.totalOwed)}</div>
    ${sum.totalAtStart ? `${progressBar(progress / sum.totalAtStart)}<div class="sub">${sum.totalOwed > sum.totalAtStart
      ? `<span class="neg">Up ${fmt(sum.totalOwed - sum.totalAtStart, { whole: true })}</span> since ${esc(monthLabel(s.trackFrom.slice(0, 7)))} (was ${fmt(sum.totalAtStart, { whole: true })})`
      : `${fmt(progress, { whole: true })} paid off since ${esc(monthLabel(s.trackFrom.slice(0, 7)))} (was ${fmt(sum.totalAtStart, { whole: true })})`}</div>` : ''}
    ${sum.unknownBalances ? `<div class="sub warn-text">${sum.unknownBalances} card${sum.unknownBalances > 1 ? 's have' : ' has'} no balance yet. Tap the card below to enter what you owe.</div>` : ''}
    ${sum.totalOwed > 0 && plan.feasible && monthly > 0 ? `<div class="sub">Debt-free by <b>${esc(monthLabel(plan.debtFreeMonth))}</b> at ${fmt(monthly, { whole: true })}/month</div>` : ''}
  </div>

  <div class="card ${clean ? '' : 'nospend-bad'}">
    <div class="row between"><h3>New spending on cards</h3><span class="status ${clean ? 'ok' : 'bad'}">${clean ? 'On track' : 'Off track'}</span></div>
    <div class="big ${clean ? 'pos' : 'neg'}">${fmt(sum.monthSpend)}</div>
    <div class="sub">${esc(monthLabel(monthKey(state.derived.today)))} so far · goal £0${streak != null ? ` · ${streak} day${streak === 1 ? '' : 's'} since last card purchase` : ''}</div>
    ${sum.cards.flatMap((c) => c.recentPurchases.map((t) => ({ ...t, card: c.account.name }))).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6).map((t) => `<div class="list-row">${catChip(t.category)}<div class="grow"><div class="ellipsis">${esc(t.description)}</div><div class="sub">${prettyDate(t.date)} · ${esc(t.card)}</div></div><b>${fmt(-t.amount)}</b></div>`).join('')}
  </div>

  <div class="card">
    <h3>Your cards</h3>
    ${sum.cards.map((c) => `<button class="list-row tap" data-action="card-edit" data-id="${esc(c.account.id)}">
      <span class="bank-badge">💳</span>
      <div class="grow"><div>${esc(c.account.name)}${c.apr != null ? ` <small class="pill">${(c.apr * 100).toFixed(1)}% APR</small>` : ''}</div>
      <div class="sub">${c.account.balanceDate ? `as of ${prettyDate(c.account.balanceDate)}` : 'balance unknown'} · this month: ${fmt(c.monthSpend, { whole: true })} spent, ${fmt(c.monthPaid, { whole: true })} paid${c.interestThisMonth ? ` · <span class="neg">${fmt(c.interestThisMonth)} interest</span>` : ''}</div></div>
      <b class="${c.owed > 0 ? 'neg' : 'pos'}">${c.owed == null ? '—' : fmt(c.owed)}</b></button>`).join('')}
    <p class="sub">Tap a card to set what you owe or its interest rate (APR, on the statement). Higher-rate cards get paid first.</p>
  </div>

  ${sum.totalOwed > 0 ? `<div class="card">
    <h3>Payoff plan</h3>
    <label class="field"><span>Pay toward cards £</span><input id="cp-amt" inputmode="decimal" value="${monthly ? (monthly / 100).toFixed(0) : ''}" placeholder="${suggestion ? (suggestion / 100).toFixed(0) : 'per month'}"></label>
    <div class="seg">
      <button class="${s.cardMethod !== 'snowball' ? 'on' : ''}" data-action="cp-method" data-m="avalanche">Highest interest first</button>
      <button class="${s.cardMethod === 'snowball' ? 'on' : ''}" data-action="cp-method" data-m="snowball">Smallest balance first</button>
    </div>
    <button class="btn primary full" data-action="cp-save">Save plan</button>
    ${monthly > 0 ? (plan.feasible ? `<div class="plan-result">
        <div class="stat-grid"><div><span class="label">Debt-free</span><b>${esc(monthLabel(plan.debtFreeMonth, { short: true }))}</b></div>
        <div><span class="label">Months</span><b>${plan.months}</b></div>
        <div><span class="label">Interest on the way</span><b>${fmt(plan.interest, { whole: true })}</b></div>
        <div><span class="label">From your budget</span><b>${fmt(monthly, { whole: true })}/mo</b></div></div>
        ${plan.payoff.map((p) => `<div class="list-row"><span class="bank-badge">✓</span><div class="grow">${esc(p.name)} cleared</div><span class="sub">${esc(monthLabel(addM(p.month), { short: true }))}</span></div>`).join('')}
      </div>` : `<div class="alert">${fmt(monthly, { whole: true })}/month doesn't beat the interest, so the balance would never reach £0. Increase it.</div>`) : ''}
    <p class="sub">This amount is set aside in your budget before fun money, like your savings goal, and "Can I afford this?" protects it. Card repayments themselves count as transfers, not spending.</p>
  </div>` : `<div class="card"><p class="good-note">✓ Nothing owed. Keep new card spending at £0 and pay any statement in full.</p></div>`}

  <div class="card tip-box"><b>Keep it at £0:</b> set each card's Direct Debit to <b>pay the full statement balance</b> (in the card's app), move subscriptions off the cards (see Insights), and use your debit card day to day.</div>`;
}

const addM = (n) => {
  const [y, m] = monthKey(state.derived.today).split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};

export const actions = {
  'mark-credit': async (el, rerender) => {
    const a = state.accounts.find((x) => x.id === el.dataset.id);
    a.type = 'credit';
    a.typeLocked = true;
    if (a.balance != null && a.balance > 0) a.balance = -a.balance; // owed is stored as negative
    await db.put('accounts', a);
    recompute(); rerender();
    toast(`${a.name} is now tracked as a credit card`);
  },
  'cp-method': async (el, rerender) => { await saveSettings({ cardMethod: el.dataset.m }); rerender(); },
  'cp-save': async (_, rerender) => {
    const raw = document.getElementById('cp-amt').value || document.getElementById('cp-amt').placeholder;
    const v = parsePrice(raw);
    if (v == null) return toast('Enter a monthly amount', { error: true });
    await saveSettings({ cardPayoff: v });
    rerender(); toast(`${fmt(v, { whole: true })}/month set aside for your cards`);
  },
  'card-edit': (el, rerender) => {
    const c = state.derived.cards.cards.find((x) => x.account.id === el.dataset.id);
    const a = c.account;
    openSheet(`<h2>💳 ${esc(a.name)}</h2>
      <label class="field"><span>Owed now £</span><input id="ce-owed" inputmode="decimal" value="${c.owed != null ? (c.owed / 100).toFixed(2) : ''}" placeholder="from the card's app"></label>
      <label class="field"><span>APR %</span><input id="ce-apr" inputmode="decimal" value="${c.apr != null ? (c.apr * 100).toFixed(1) : ''}" placeholder="e.g. 24.9 (0 for 0% deals)"></label>
      <p class="sub">"Owed now" is the current balance in the card's app, not the available credit.</p>
      <button class="btn primary full" id="ce-save">Save</button>`, {
      onMount(p) {
        p.querySelector('#ce-save').onclick = async () => {
          const owed = parsePrice(p.querySelector('#ce-owed').value);
          const aprRaw = p.querySelector('#ce-apr').value.trim();
          if (owed != null) { a.balance = -owed; a.balanceDate = state.derived.today; }
          a.apr = aprRaw === '' ? null : Math.max(0, parseFloat(aprRaw)) / 100;
          await db.put('accounts', a);
          recompute(); closeSheet(); rerender();
        };
      },
    });
  },
};
