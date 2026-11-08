// On track: will we have enough this month and in the months ahead, budget alerts, the back-on-track
// plan (from your spreadsheet or your own spending), credit health and a monthly routine.
import { state, personName } from '../../state.js';
import { esc, toast } from '../dom.js';
import { fmt } from '../../lib/money.js';
import { CAT, catName, catKind } from '../../lib/categories.js';
import { monthKey, monthLabel, prettyDate, daysBetween } from '../../lib/dates.js';
import { monthOutlook, budgetAlerts, history, outlook } from '../../lib/forecast.js';
import { suggestBudget, isTemporary, planStage, targetFor, realityCheck, debtOrder } from '../../lib/plan.js';
import { creditChecks } from '../../lib/creditreport.js';
import { creditReports, togglePlanItem, applyStage } from '../../lib/ontrack-store.js';
import { saveSettings, recompute, incomeFor } from '../../state.js';
import { checkinStatus, targetMonth } from './checkin.js';
import { catChip } from '../common.js';

let reports = [];
const ui = { showAllSavings: false };
export async function preload() { reports = await creditReports(); }

const statusWord = { ok: ['On track', 'pos'], tight: ['Tight', 'warn-text'], short: ['Short', 'neg'] };
const bar = (pct, cls = '') => `<div class="cat-bar ${cls}"><span style="width:${Math.max(0, Math.min(100, pct * 100)).toFixed(1)}%"></span></div>`;

/** Last 6 months and the next 6 as little bars: left over each month (green) or short (red). */
function trendChart(past, ahead) {
  const all = [...past.map((m) => ({ ...m, future: false })), ...ahead.map((m) => ({ month: m.month, left: m.left, future: true }))];
  if (!all.length) return '';
  const max = Math.max(1, ...all.map((m) => Math.abs(m.left)));
  const W = 320, H = 110, mid = H / 2, bw = W / all.length;
  const bars = all.map((m, i) => {
    const h = Math.max(2, (Math.abs(m.left) / max) * (mid - 12));
    const y = m.left >= 0 ? mid - h : mid;
    return `<rect x="${(i * bw + 3).toFixed(1)}" y="${y.toFixed(1)}" width="${(bw - 6).toFixed(1)}" height="${h.toFixed(1)}" rx="3" class="${m.left >= 0 ? 'tb-pos' : 'tb-neg'} ${m.future ? 'tb-future' : ''}"><title>${esc(monthLabel(m.month))}: ${m.left >= 0 ? '' : '−'}£${Math.round(Math.abs(m.left) / 100)}</title></rect>
      <text x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 1}" text-anchor="middle" class="tb-label">${esc(monthLabel(m.month, { short: true }).split(' ')[0].slice(0, 1))}</text>`;
  }).join('');
  const split = past.length * bw;
  return `<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="Left over each month">
    <line x1="0" x2="${W}" y1="${mid}" y2="${mid}" class="tb-axis"/>${past.length && ahead.length ? `<line x1="${split}" x2="${split}" y1="4" y2="${H - 12}" class="tb-split"/>` : ''}${bars}</svg>
    <div class="kind-legend"><span><i class="tb-key pos"></i>Left over</span><span><i class="tb-key neg"></i>Short</span><span><i class="tb-key future"></i>Forecast</span></div>`;
}

export function render() {
  const { budget, recurring, today, cards } = state.derived;
  if (!state.txs.length) return `<h1 class="page-title">On track</h1><div class="card"><p class="muted">Import your statements first. Then this page shows whether you'll have enough each month, your budgets, your plan and your credit health.</p><button class="btn primary full" data-action="import">Import statements</button></div>`;
  const s = state.settings;
  const mo = monthOutlook({ txs: state.txs, today, budget, recurring });
  const alerts = budgetAlerts({ txs: state.txs, today, budget });
  const over = alerts.filter((a) => a.status === 'over'), heading = alerts.filter((a) => a.status === 'heading');
  const housingNow = budget.lines.find((l) => l.category === 'housing')?.hist || 0;
  const mort = s.mortgage?.principal || (s.mortgage?.price && s.mortgage?.deposit != null) ? { ...s.mortgage, principal: s.mortgage.principal ?? s.mortgage.price - s.mortgage.deposit } : null;
  const ahead = outlook({ txs: state.txs, today, budget, months: 6, mortgage: mort, housingNow, incomeFor });
  const past = history({ txs: state.txs, today, n: 6 });
  const [word, wcls] = statusWord[mo.status];
  const plan = s.plan;

  // Back-on-track plan: from the spreadsheet if you imported one, else from your spending.
  let planHtml;
  if (plan) {
    // Your real income (payslips, maternity pay, Child Benefit), not the spreadsheet's figure.
    const income = budget.income || plan.income.reduce((a, x) => a + x.monthly, 0);
    const sheetIncome = plan.income.reduce((a, x) => a + x.monthly, 0);
    const stage = planStage(plan, monthKey(today));
    const staged = plan.budget.some((l) => l.stages);
    const nowTotal = plan.budget.reduce((a, l) => a + (l.now || 0), 0), sugTotal = plan.budget.reduce((a, l) => a + (targetFor(l, stage) || 0), 0);
    const doneSave = plan.savings.filter((x) => x.done).reduce((a, x) => a + (x.saving || 0), 0), allSave = plan.savings.reduce((a, x) => a + (x.saving || 0), 0);
    const tempRelief = plan.savings.filter(isTemporary).reduce((a, x) => a + (x.saving || 0), 0);
    const steps = plan.steps.flatMap((st) => st.items), stepsDone = steps.filter((x) => x.done).length;
    const debts = debtOrder(plan.debts);
    // Reality check against what you actually spend (from your statements).
    const actual = {};
    for (const l of budget.lines) actual[l.category] = l.hist;
    const unreal = realityCheck(plan, actual, stage);
    const flagged = plan.regular.filter((r) => /CANCEL|REVIEW|BOUNC/.test(r.status));
    const savings = ui.showAllSavings ? plan.savings : plan.savings.slice(0, 8);
    planHtml = `
    <div class="card">
      <h3>Back-on-track plan</h3>
      <div class="stat-grid"><div><span class="label">Each month now</span><b class="${income - nowTotal < 0 ? 'neg' : 'pos'}">${fmt(income - nowTotal, { whole: true, sign: true })}</b></div>
        <div><span class="label">${staged ? `On month ${stage + 1} targets` : 'On the suggested budget'}</span><b class="${income - sugTotal < 0 ? 'neg' : 'pos'}">${fmt(income - sugTotal, { whole: true, sign: true })}</b></div>
        <div><span class="label">Savings actions done</span><b>${fmt(doneSave, { whole: true })} <small class="muted">of ${fmt(allSave, { whole: true })}/mo</small></b></div>
        <div><span class="label">Steps done</span><b>${stepsDone}/${steps.length}</b></div></div>
      ${tempRelief ? `<div class="alert"><b>${fmt(tempRelief, { whole: true })}/month of this is temporary relief</b> (payment holidays, lowered or paused payments). When it ends you'd be at <b>${fmt(income - sugTotal - tempRelief, { whole: true, sign: true })}</b> a month: plan for that date now.</div>` : ''}
      ${unreal.length ? `<div class="tip-box"><b>Reality check</b>${unreal.map((u) => `<div class="sub">• ${esc(u.label)}: you actually spend ${fmt(u.actual, { whole: true })}/month; ${fmt(u.target, { whole: true })} is a ${u.cut}% cut in one go. Step it down over 2–3 months instead.</div>`).join('')}</div>` : ''}
      ${staged ? `<p class="sub">Stepped plan: month ${stage + 1} targets now${(plan.appliedStage || 0) !== stage ? '.' : ' (in your budgets).'}</p>${(plan.appliedStage || 0) !== stage ? `<button class="btn primary full" data-action="tr-stage" data-stage="${stage}">Use month ${stage + 1} targets as my budgets</button>` : ''}` : ''}
      <p class="sub">Income ${fmt(income, { whole: true })}/month from <a href="#/income">your Income page</a>${sheetIncome && Math.abs(sheetIncome - income) >= 100 ? ` (the spreadsheet said ${fmt(sheetIncome, { whole: true })})` : ''}. Budget lines from your spreadsheet (imported ${new Date(plan.importedAt).toLocaleDateString('en-GB')}).</p>
    </div>
    ${plan.steps.length ? `<div class="card"><h3>Action plan <small class="muted">${stepsDone}/${steps.length}</small></h3>
      ${plan.steps.map((st, i) => `<div class="plan-step"><b>Step ${i + 1}: ${esc(st.title)}</b>${st.items.map((it, j) => `<label class="check-row"><input type="checkbox" data-change="tr-step" data-i="${i}" data-j="${j}" ${it.done ? 'checked' : ''}><span class="${it.done ? 'done-text' : ''}">${esc(it.text)}</span></label>`).join('')}</div>`).join('')}
      ${plan.notes.map((n) => `<p class="sub">${esc(n)}</p>`).join('')}</div>` : ''}
    ${plan.savings.length ? `<div class="card"><h3>Savings plan <small class="muted">${fmt(doneSave, { whole: true })} of ${fmt(allSave, { whole: true })}/mo</small></h3>
      ${savings.map((x) => { const i = plan.savings.indexOf(x); return `<label class="check-row"><input type="checkbox" data-change="tr-save" data-i="${i}" ${x.done ? 'checked' : ''}><span class="grow ${x.done ? 'done-text' : ''}"><b>${esc(x.item)}</b>: ${esc(x.action)}<br><small class="sub">${x.now != null ? `${fmt(x.now)} → ${fmt(x.after || 0)}` : ''}${x.note ? ` · ${esc(x.note)}` : ''}</small></span><b class="pos">${fmt(x.saving || 0, { whole: true })}</b></label>`; }).join('')}
      ${plan.savings.length > 8 && !ui.showAllSavings ? `<button class="btn ghost full" data-action="tr-more">Show all ${plan.savings.length}</button>` : ''}</div>` : ''}
    ${debts.length ? `<div class="card"><h3>Debts: clear in this order</h3>
      <p class="sub">Anything over its limit first (it's reported to the credit agencies every month), then highest interest (every £ there saves the most). Always pay every minimum.</p>
      ${debts.map((d, i) => `<div class="list-row"><span class="bank-badge">${i + 1}</span><div class="grow"><div>${esc(d.name)}</div><div class="sub one-line">${d.apr ? `${(d.apr * 100).toFixed(1)}% APR · ` : ''}${d.min ? `min ${fmt(d.min, { whole: true })}/mo` : ''}${d.limit ? ` · limit ${fmt(d.limit, { whole: true })}` : ''}${d.limit && d.balance > d.limit ? ' · <span class="neg">over limit</span>' : ''}</div></div><b>${fmt(d.balance, { whole: true })}</b></div>`).join('')}
      <a class="link small-link" href="#/cards">Card payoff calculator ›</a></div>` : ''}
    ${flagged.length ? `<div class="card"><h3>Regular payments to sort <small class="muted">${fmt(flagged.reduce((a, r) => a + r.monthly, 0), { whole: true })}/mo</small></h3>
      ${flagged.map((r) => `<div class="list-row"><span class="pill ${/BOUNC|CANCEL/.test(r.status) ? 'warn' : ''}">${esc(r.status.toLowerCase())}</span><div class="grow"><div>${esc(r.item)}</div><div class="sub one-line">${esc(r.account || r.category)}</div></div><b>${fmt(r.monthly)}</b></div>`).join('')}</div>` : ''}`;
  } else {
    const avg = {};
    for (const l of budget.lines) avg[l.category] = l.hist;
    const sb = suggestBudget({ avgByCategory: avg, income: budget.income, savingsTarget: 0 });
    const changes = sb.lines.filter((l) => l.suggested < l.now);
    planHtml = `<div class="card">
      <h3>Back-on-track plan</h3>
      <div class="stat-grid"><div><span class="label">Each month now</span><b class="${sb.leftNow < 0 ? 'neg' : 'pos'}">${fmt(sb.leftNow, { whole: true, sign: true })}</b></div>
        <div><span class="label">On this budget</span><b class="${sb.leftSuggested < 0 ? 'neg' : 'pos'}">${fmt(sb.leftSuggested, { whole: true, sign: true })}</b></div></div>
      ${changes.length ? `<p class="sub">Keeps rent and bills, trims everyday spending a little and lifestyle spending more:</p>
        ${changes.map((l) => `<div class="list-row">${catChip(l.category)}<div class="grow"><div>${esc(catName(l.category))}</div><div class="sub">${fmt(l.now, { whole: true })} → <b>${fmt(l.suggested, { whole: true })}</b></div></div><b class="pos">−${fmt(l.now - l.suggested, { whole: true })}</b></div>`).join('')}
        <button class="btn primary full" data-action="tr-apply">Use these as my budgets</button>` : '<p class="sub">Your income covers your average spending. Keep it that way with the budgets above.</p>'}
      <p class="sub">Got a household spreadsheet with a plan (suggested budget, debts, savings, steps)? Import the .xlsx and it appears here.</p>
      <button class="btn ghost full" data-action="import">Import my spreadsheet</button>
    </div>`;
  }

  // Credit health: the latest report for each person.
  const people = s.people;
  const latest = people.map((p) => ({ p, list: reports.filter((r) => r.owner === p.id) })).filter((x) => x.list.length);
  const cardInfo = cards.cards.map((c) => ({ name: c.account.name, owed: c.owed, limit: c.account.limit || null }));
  const creditHtml = `<div class="card">
    <h3>Credit health</h3>
    ${latest.length ? latest.map(({ p, list }) => {
      const r = list[0], prev = list[1];
      const checks = creditChecks(r, { today, cards: people.length > 1 ? [] : cardInfo });
      const age = r.date ? daysBetween(r.date, today) : null;
      return `<div class="credit-person">
        <div class="row between"><b class="grow">${esc(personName(p.id))}</b>${r.score != null ? `<span class="score-badge">${r.score}${prev?.score != null && prev.score !== r.score ? ` <small class="${r.score > prev.score ? 'pos' : 'neg'}">${r.score > prev.score ? '▲' : '▼'}${Math.abs(r.score - prev.score)}</small>` : ''}</span>` : ''}</div>
        <div class="sub">${esc(r.provider)}${r.date ? ` · ${prettyDate(r.date)} ${r.date.slice(0, 4)}` : ''}${age > 90 ? ' · <span class="warn-text">over 3 months old: check for a new one</span>' : ''}</div>
        ${checks.map((c) => `<div class="check-line ${c.level === 'good' ? 'ok' : c.level === 'bad' ? 'bad' : ''}">${c.level === 'good' ? '✓' : c.level === 'bad' ? '✗' : '!'} <b>${esc(c.title)}</b><div class="sub">${esc(c.detail)}</div></div>`).join('')}
      </div>`;
    }).join('') : '<p class="sub">Import a credit report PDF (Checkmyfile, ClearScore and similar) for each of you. The app checks credit use, late payments, over-limit cards and recent applications. It\'s read on your phone and stays there.</p>'}
    <p class="sub">Protect your score: pay at least the minimum on time every month (a Direct Debit is safest), stay under each limit, keep card use under 30%, and leave 3+ months between credit applications.</p>
    <button class="btn ghost full" data-action="import">Import a credit report</button>
  </div>`;

  // Monthly routine.
  // Bounced Direct Debits and late fees hurt both your money and your credit file.
  const bounced = state.txs.filter((t) => daysBetween(t.date, today) <= 62 && /\b(REFER TO PAYER|RETURNED|UNPAID|BOUNCED|LATE (PAYMENT )?FEE|LATE PAYMENT|RETURNED DD|DD RETURN|UNPAID ITEM|PAID ITEM FEE)\b/i.test(t.description || ''));
  const ci = checkinStatus(targetMonth());
  const missing = state.derived.coverage.missing.length;
  const oldest = latest.length ? Math.max(...latest.map(({ list }) => (list[0].date ? daysBetween(list[0].date, today) : 999))) : null;
  const routine = [
    [missing === 0, `Import last month's statements${missing ? ` (${missing} missing)` : ''}`, '#/accounts'],
    [ci.complete || ci.done === 4, `Monthly check-in for ${monthLabel(targetMonth())} (${ci.done}/4)`, '#/checkin'],
    [over.length === 0, over.length ? `${over.length} budget${over.length > 1 ? 's' : ''} over: adjust or cut back` : 'Every budget on track', '#/budget'],
    [!bounced.length, bounced.length ? `${bounced.length} bounced or late-payment charge${bounced.length > 1 ? 's' : ''} in the last 2 months: fund every Direct Debit` : 'No bounced payments or late fees in the last 2 months', '#/transactions'],
    [oldest != null && oldest <= 92, oldest == null ? 'Check your credit reports (every 3 months)' : `Credit reports checked ${oldest} days ago`, '#/track'],
  ];

  return `<h1 class="page-title">On track</h1>
  <div class="card hero">
    <div class="label">${esc(monthLabel(mo.key))} at today's pace · day ${mo.day} of ${mo.days}</div>
    <div class="big ${wcls}">${word}</div>
    <div class="sub">You'll have about <b class="${mo.left < 0 ? 'neg' : 'pos'}">${fmt(mo.left, { whole: true, sign: true })}</b> left at the end of the month.</div>
    ${bar(mo.spendEnd ? mo.spent / mo.spendEnd : 0)}
    <div class="stat-grid mi-grid">
      <div><span class="label">Spent so far</span><b>${fmt(mo.spent, { whole: true })}</b></div>
      <div><span class="label">Heading for</span><b>${fmt(mo.spendEnd, { whole: true })}</b></div>
      <div><span class="label">Bills still to come</span><b>${fmt(mo.billsToCome, { whole: true })}</b></div>
      <div><span class="label">Income</span><b>${fmt(mo.income, { whole: true })}</b></div>
    </div>
    ${over.length || heading.length ? `<div class="sub mi-movers"><span class="neg">⚠ ${[over.length && `${over.length} over budget`, heading.length && `${heading.length} heading over`].filter(Boolean).join(' · ')}</span></div>` : ''}
  </div>

  <div class="card">
    <h3>Will we have enough?</h3>
    <p class="sub">At your average spending (${fmt(ahead.avgSpend, { whole: true })}/month) and your income month by month (<a href="#/income">Income</a>)${mort ? ', with the mortgage from Future planning' : ''}:</p>
    ${trendChart(past, ahead.months)}
    <div class="plan-table">
      <div class="pt-row head"><span>Month</span><span>In</span><span>Left</span><span>Running</span></div>
      ${ahead.months.map((m) => `<div class="pt-row ${m.mortgage ? 'start' : ''}"><span>${esc(monthLabel(m.month, { short: true }))}${m.mortgage ? ' 🏠' : ''}</span><span>${fmt(m.income, { whole: true })}</span><span class="${m.left < 0 ? 'neg' : ''}">${fmt(m.left, { whole: true, sign: true })}</span><span class="${m.running < 0 ? 'neg' : ''}">${fmt(m.running, { whole: true, sign: true })}</span></div>`).join('')}
    </div>
    <p class="sub ${ahead.shortMonths ? 'warn-text' : ''}">${ahead.shortMonths ? `Short in ${ahead.shortMonths} of the next 6 months at this rate. The plan below shows where to close the gap.` : 'Enough every month at this rate.'}</p>
  </div>

  <div class="card">
    <h3>Budgets this month ${over.length ? `<small class="pill warn">${over.length} over</small>` : ''}</h3>
    ${alerts.filter((a) => a.budget > 0 || a.spent > 0).slice(0, 14).map((a) => `<div class="alert-row ${a.status}">
      <div class="row between">${catChip(a.category)}<span class="grow">${esc(catName(a.category))}</span><b class="${a.status === 'over' ? 'neg' : ''}">${fmt(a.spent, { whole: true })} <small class="muted">/ ${fmt(a.budget, { whole: true })}</small></b></div>
      ${bar(a.budget ? a.spent / a.budget : 1, a.status)}
      <div class="sub">${a.status === 'over' ? `<span class="neg">Over by ${fmt(a.spent - a.budget, { whole: true })}</span>` : a.status === 'heading' ? `<span class="warn-text">Heading for ${fmt(a.projected, { whole: true })} at this pace</span>${a.perDayLeft ? ` · keep to ${fmt(a.perDayLeft, { whole: true })}/day` : ''}` : catKind(a.category) === 'fixed' ? 'Bill' : a.perDayLeft ? `${fmt(a.perDayLeft, { whole: true })}/day left` : 'On track'}</div>
    </div>`).join('')}
    <a class="link small-link" href="#/budget">Change budgets ›</a>
  </div>

  ${planHtml}
  ${creditHtml}

  <div class="card">
    <h3>Monthly routine</h3>
    ${routine.map(([ok, text, href]) => `<a class="list-row tap routine ${ok ? 'ok' : ''}" href="${href}"><span class="vbadge ${ok ? 'ok' : 'fail'}">${ok ? '✓' : '!'}</span><div class="grow">${esc(text)}</div><span class="row-go">›</span></a>`).join('')}
  </div>`;
}

export const actions = {
  'tr-more': (_, rerender) => { ui.showAllSavings = true; rerender(); },
  'tr-stage': async (el, rerender) => { const n = await applyStage(+el.dataset.stage); toast(`${n} budgets moved to month ${+el.dataset.stage + 1} targets`); rerender(); },
  'tr-apply': async (_, rerender) => {
    const { budget } = state.derived;
    const avg = {};
    for (const l of budget.lines) avg[l.category] = l.hist;
    const sb = suggestBudget({ avgByCategory: avg, income: budget.income });
    const b = { ...(state.settings.budgets || {}) };
    for (const l of sb.lines.filter((x) => x.suggested < x.now)) b[l.category] = l.suggested;
    await saveSettings({ budgets: b });
    recompute(); toast('Budgets updated'); rerender();
  },
};

export const changes = {
  'tr-step': async (el, rerender) => { await togglePlanItem('step', +el.dataset.i, +el.dataset.j); rerender(); },
  'tr-save': async (el, rerender) => { await togglePlanItem('saving', +el.dataset.i); rerender(); },
};

void CAT;
