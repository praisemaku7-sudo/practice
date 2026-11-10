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
import { buildPath, chosenSaving } from '../../lib/path.js';
import { diagnoseSpending } from '../../lib/diagnose.js';
import { commitmentsCard } from '../afford-extras.js';
import { summarizeMonth } from '../../lib/analysis.js';
import { schedule } from '../../lib/mortgage.js';

let reports = [];
const ui = { showAllSavings: false, showAllPath: false, withActions: false, sel: null };
let points = [];
export async function preload() { reports = await creditReports(); }

const statusWord = { ok: ['On track', 'pos'], tight: ['Tight', 'warn-text'], short: ['Short', 'neg'] };
const bar = (pct, cls = '') => `<div class="cat-bar ${cls}"><span style="width:${Math.max(0, Math.min(100, pct * 100)).toFixed(1)}%"></span></div>`;

/** Money in vs out, month by month: 6 complete months, this month at today's pace, 6 ahead. */
function cashChart(pts, sel) {
  const W = 320, H = 170, top = 10, base = H - 34;
  const max = Math.max(1, ...pts.flatMap((p) => [p.income, p.spend]));
  const step = W / pts.length, bw = Math.min(10, step * 0.32);
  const y = (v) => base - (v / max) * (base - top);
  const runs = pts.filter((p) => p.running != null);
  const rMax = Math.max(1, ...runs.map((p) => Math.abs(p.running)));
  return `<svg class="cash-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Money in and out by month. Tap a month.">
    <line x1="0" x2="${W}" y1="${base}" y2="${base}" class="tb-axis"/>
    ${pts.map((p, i) => {
      const cx = i * step + step / 2;
      const neg = p.spend > p.income;
      return `<g class="cm ${p.kind} ${p.incomplete ? 'inc' : ''} ${i === sel ? 'sel' : ''}">
        <rect x="${(i * step + 1).toFixed(1)}" y="2" width="${(step - 2).toFixed(1)}" height="${H - 4}" rx="6" class="cm-bg"/>
        <rect x="${(cx - bw - 1).toFixed(1)}" y="${y(p.income).toFixed(1)}" width="${bw}" height="${Math.max(1, base - y(p.income)).toFixed(1)}" rx="2.5" class="cm-in"/>
        <rect x="${(cx + 1).toFixed(1)}" y="${y(p.spend).toFixed(1)}" width="${bw}" height="${Math.max(1, base - y(p.spend)).toFixed(1)}" rx="2.5" class="cm-out ${neg ? 'over' : ''}"/>
        <text x="${cx.toFixed(1)}" y="${H - 20}" text-anchor="middle" class="tb-label">${esc(monthLabel(p.month, { short: true }).split(' ')[0].slice(0, 3))}</text>
        <text x="${cx.toFixed(1)}" y="${H - 7}" text-anchor="middle" class="cm-net ${p.left < 0 ? 'neg' : 'pos'}">${p.left < 0 ? '−' : '+'}${Math.abs(p.left) >= 100000 ? (Math.abs(p.left) / 100000).toFixed(1) + 'k' : Math.round(Math.abs(p.left) / 100)}</text>
        <rect x="${(i * step).toFixed(1)}" y="0" width="${step.toFixed(1)}" height="${H}" class="ihit" data-action="tr-m" data-i="${i}"/></g>`;
    }).join('')}
    ${pts.findIndex((p) => p.kind === 'now') > 0 ? `<line x1="${(pts.findIndex((p) => p.kind === 'now') * step).toFixed(1)}" x2="${(pts.findIndex((p) => p.kind === 'now') * step).toFixed(1)}" y1="2" y2="${base}" class="tb-split"/>` : ''}
  </svg>${runs.length > 1 ? `<div class="run-line"><span class="label">Running total from now</span><svg viewBox="0 0 ${W} 30" preserveAspectRatio="none">${(() => { const idx = pts.map((p, i) => [p, i]).filter(([p]) => p.running != null); return `<line x1="0" x2="${W}" y1="15" y2="15" class="tb-axis"/><path d="${idx.map(([p, i], j) => `${j ? 'L' : 'M'}${(i * step + step / 2).toFixed(1)},${(15 - (p.running / rMax) * 13).toFixed(1)}`).join(' ')}" class="run-path ${runs.at(-1).running < 0 ? 'neg' : 'pos'}"/>`; })()}</svg><b class="${runs.at(-1).running < 0 ? 'neg' : 'pos'}">${fmt(runs.at(-1).running, { whole: true, sign: true })}</b></div>` : ''}`;
}

function detailFor(p) {
  if (!p) return '';
  const row = (l, v, cls = '') => `<div class="pt-row two"><span>${l}</span><b class="${cls}">${v}</b></div>`;
  if (p.kind === 'past') {
    const sm = summarizeMonth(state.txs, p.month);
    const top = Object.entries(sm.byCat || {}).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const miss = p.incomplete ? state.derived.coverage.missing.filter((x) => x.month === p.month) : [];
    return `<b>${esc(monthLabel(p.month))}</b> <small class="muted">actual</small>${miss.length ? `<div class="sub warn-text">⚠ Incomplete: no statement from ${esc(miss.map((x) => x.accountName).join(', '))}, so these totals are too low. Left out of the typical month. <a href="#/accounts">Import ›</a></div>` : ''}<div class="plan-table">${row('In', fmt(p.income, { whole: true }), 'pos')}${row('Out', fmt(p.spend, { whole: true }))}${row('Left over', fmt(p.left, { whole: true, sign: true }), p.left < 0 ? 'neg' : 'pos')}</div>
      ${top.length ? `<div class="sub">Biggest: ${top.map(([c, v]) => `${esc(catName(c))} ${fmt(v, { whole: true })}`).join(' · ')}</div>` : ''}
      <div class="row gap wrap"><button class="chip" data-action="dash-month" data-month="${p.month}">Breakdown and transactions ›</button></div>`;
  }
  if (p.kind === 'now') {
    return `<b>${esc(monthLabel(p.month))}</b> <small class="muted">in progress</small><div class="plan-table">${row('Spent so far', fmt(p.spent, { whole: true }))}${row('Heading for', fmt(p.spend, { whole: true }))}${row('Bills still to come', fmt(p.billsToCome, { whole: true }))}${row('Income', fmt(p.income, { whole: true }), 'pos')}${row('Left at month end', fmt(p.left, { whole: true, sign: true }), p.left < 0 ? 'neg' : 'pos')}</div>
      <div class="row gap wrap"><a class="chip" href="#/bills">Bills calendar ›</a><a class="chip" href="#/budget">Budgets ›</a></div>`;
  }
  return `<b>${esc(monthLabel(p.month))}</b> <small class="muted">forecast</small><div class="plan-table">${row('In' + (p.incomeNote ? ` <small class="muted">${esc(p.incomeNote)}</small>` : ''), fmt(p.income, { whole: true }), 'pos')}${row('Regular bills', fmt(p.bills || 0, { whole: true }))}${row('Everyday spending (typical)', fmt(Math.max(0, p.spend - (p.bills || 0)), { whole: true }))}${p.mortgage ? row('🏠 Mortgage instead of rent', 'included') : ''}${row('Left over', fmt(p.left, { whole: true, sign: true }), p.left < 0 ? 'neg' : 'pos')}${row('Running total', fmt(p.running, { whole: true, sign: true }), p.running < 0 ? 'neg' : '')}</div>
    <div class="row gap wrap"><a class="chip" href="#/income">Income ›</a>${p.mortgage ? '<a class="chip" href="#/plan">Future planning ›</a>' : ''}</div>`;
}

function enoughCard({ past, ahead, withPlan, mo, chosen, picked, mort, s }) {
  const plan = ui.withActions && withPlan ? withPlan : ahead;
  points = [
    ...past.map((m) => ({ ...m, kind: 'past', running: null })),
    { month: mo.key, kind: 'now', income: mo.income, spend: mo.spendEnd - (ui.withActions && picked ? Math.round(picked * (1 - mo.day / mo.days)) : 0), spent: mo.spent, billsToCome: mo.billsToCome, left: mo.left + (ui.withActions && picked ? Math.round(picked * (1 - mo.day / mo.days)) : 0), running: null },
    ...plan.months.map((m) => ({ ...m, kind: 'future' })),
  ];
  const nowLeft = points.find((p) => p.kind === 'now').left;
  let run = nowLeft; for (const p of points) if (p.kind === 'future') { run += p.left; p.running = run; }
  points.find((p) => p.kind === 'now').running = nowLeft;
  const sel = ui.sel ?? points.findIndex((p) => p.kind === 'now');
  const income = plan.months[0]?.income || 0;
  const outTyp = plan.avgSpend - (ui.withActions ? picked : 0);
  const spare = income - outTyp;
  const recvd = past.filter((p) => !p.incomplete).length ? Math.round(past.filter((p) => !p.incomplete).reduce((a, p) => a + p.income, 0) / past.filter((p) => !p.incomplete).length) : null;
  const checks = income && (ahead.avgSpend > income * 1.3 || (recvd && recvd > income * 1.35)) ? diagnoseSpending({ txs: state.txs, accounts: state.allAccounts || state.accounts, months: past.filter((p) => !p.incomplete).map((p) => p.month), people: s.people, income, receivedIncome: recvd }) : [];
  const nAct = Object.values(chosen).filter(Boolean).length;
  return `<div class="card keep-open">
    <h3>Will we have enough?</h3>
    <div class="enough-sum">
      <div><span class="label">Typical month in</span><b class="pos">${fmt(income, { whole: true })}</b></div>
      <div><span class="label">Typical month out</span><b>${fmt(outTyp, { whole: true })}</b></div>
      <div><span class="label">${spare < 0 ? 'Short' : 'Spare'} each month</span><b class="${spare < 0 ? 'neg' : 'pos'}">${fmt(Math.abs(spare), { whole: true })}</b></div>
    </div>
    <p class="sub">"Typical" is your middle month of the last ${ahead.monthsUsed}${ahead.basis === 'median' && Math.abs(ahead.meanSpend - ahead.avgSpend) > ahead.avgSpend * 0.05 ? ` (the average is ${fmt(ahead.meanSpend, { whole: true })}, pushed ${ahead.meanSpend > ahead.avgSpend ? 'up' : 'down'} by one-off months)` : ''}. Income month by month from <a href="#/income">Income</a>${mort ? ', with the mortgage from Future planning' : ''}.</p>
    ${checks.length ? `<div class="cal-tip bad"><b>⚠ Does this look right? ${ahead.avgSpend > income * 1.3 ? `Spending is ${Math.round((ahead.avgSpend / income) * 100)}% of income` : 'Income doesn\'t match your payslips'}</b><span>Spending this far above income usually means something's counted that isn't really spending:</span>
      ${checks.slice(0, 3).map((c) => `<div class="diag"><b>${esc(c.title)}</b><span>${esc(c.detail)}</span>${c.action ? `<a class="chip" href="${esc(c.action.href)}">${esc(c.action.label)} ›</a>` : ''}</div>`).join('')}
      ${checks.length > 3 ? `<details><summary class="sub">${checks.length - 3} more checks</summary>${checks.slice(3).map((c) => `<div class="diag"><b>${esc(c.title)}</b><span>${esc(c.detail)}</span></div>`).join('')}</details>` : ''}</div>` : ''}
    ${withPlan ? `<div class="seg" role="radiogroup" aria-label="Forecast"><button class="${ui.withActions ? '' : 'sel'}" data-action="tr-with" data-v="0">As things are</button><button class="${ui.withActions ? 'sel' : ''}" data-action="tr-with" data-v="1">With my ${nAct} action${nAct === 1 ? '' : 's'}</button></div>` : ''}
    ${cashChart(points, sel)}
    <div class="kind-legend"><span><i class="tb-key pos"></i>In</span><span><i class="tb-key out"></i>Out</span><span><i class="tb-key neg"></i>Out more than in</span><span><i class="tb-key future"></i>Forecast</span></div>
    <div class="cm-detail" id="tr-detail">${detailFor(points[sel])}</div>
    <p class="sub ${plan.shortMonths ? 'warn-text' : ''}">${plan.shortMonths ? `At this rate you'd be short in ${plan.shortMonths} of the next 6 months, ${fmt(points.at(-1).running, { whole: true, sign: true })} by ${esc(monthLabel(points.at(-1).month))}. ${ui.withActions ? '' : 'Your path below shows how to close the gap.'}` : 'Enough every month at this rate.'}</p>
    ${withPlan && !ui.withActions ? `<p class="sub">With your ${nAct} chosen action${nAct === 1 ? '' : 's'} (${fmt(picked, { whole: true })}/month): ${withPlan.shortMonths ? `still short in ${withPlan.shortMonths} of 6 months` : '<span class="pos">enough every month</span>'}.</p>` : ''}
  </div>`;
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
  const ahead = outlook({ txs: state.txs, today, budget, months: 6, mortgage: mort, housingNow, incomeFor, recurring, incomplete: state.derived.incomplete });
  const past = history({ txs: state.txs, today, n: 6, incomplete: state.derived.incomplete });
  const [word, wcls] = statusWord[mo.status];
  const mortPay = mort ? (schedule({ ...mort }).rows[0]?.payment || 0) + (mort.extraCosts || 0) : null;
  const path = buildPath({ budget, recurring, settings: s, income: ahead.months[0]?.income ?? budget.income, avgSpend: ahead.avgSpend, mortgagePayment: mortPay });
  const chosen = s.pathChosen || {};
  const picked = chosenSaving(path, chosen);
  const withPlan = picked ? outlook({ txs: state.txs, today, budget, months: 6, mortgage: mort, housingNow, incomeFor, cut: picked, recurring, incomplete: state.derived.incomplete }) : null;
  const pathHtml = pathCard(path, chosen, picked);
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

  ${commitmentsCard()}
  ${enoughCard({ past, ahead, withPlan, mo, chosen, picked, mort, s })}

  ${pathHtml}

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

/** Ranked actions with the £ each frees up; tick the ones you'll do and watch the gap close. */
function pathCard(path, chosen, picked) {
  if (!path.actions.length) return '';
  const short = Math.max(0, -path.gap);
  const after = path.gap + picked;
  const all = path.actions.reduce((a, x) => a + x.saving, 0);
  const list = ui.showAllPath ? path.actions : path.actions.slice(0, 8);
  const kindTag = { temporary: 'For now', income: 'Extra income', planned: 'When you move' };
  return `<div class="card keep-open">
    <h3>Your path to living within your means</h3>
    <div class="path-sum">
      <div><span class="label">${path.gap < 0 ? 'Short each month' : 'Spare each month'}</span><b class="${path.gap < 0 ? 'neg' : 'pos'}">${fmt(Math.abs(path.gap), { whole: true })}</b></div>
      <div><span class="label">You've chosen</span><b class="pos">${fmt(picked, { whole: true })}</b></div>
      <div><span class="label">Then</span><b class="${after < 0 ? 'neg' : 'pos'}">${fmt(after, { whole: true, sign: true })}</b></div>
    </div>
    ${short ? bar(picked / short, after >= 0 ? 'ok' : '') : ''}
    <p class="sub">${short ? (after >= 0 ? '✓ With these you live within your means. Keep them up for 3 months and the forecast above turns green.' : `Tick what you'll do. Everything below adds up to ${fmt(all, { whole: true })}/month${all < short ? `, still ${fmt(short - all, { whole: true })} short: the rest is the big decisions (rent, giving, income)` : ''}.`) : 'You\'re within your means. These would add to what you save.'}</p>
    ${list.map((a) => `<label class="path-item ${chosen[a.id] ? 'done' : ''}"><input type="checkbox" data-change="tr-path" data-id="${esc(a.id)}" ${chosen[a.id] ? 'checked' : ''}>
      <span class="grow"><b>${esc(a.title)}</b>${kindTag[a.kind] ? ` <small class="pill">${kindTag[a.kind]}</small>` : ''}<br><small class="sub">${esc(a.detail)}</small>${a.help ? `<br><a class="act-link" href="${esc(a.help.url)}" target="_blank" rel="noopener">${esc(a.help.label)} ↗</a>` : a.id === 'cb' ? '<br><a class="act-link" href="https://www.gov.uk/child-benefit/how-to-claim" target="_blank" rel="noopener">Claim on GOV.UK ↗</a> <a class="act-tel" href="tel:03002003100">📞 0300 200 3100</a>' : ''}</span>
      <b class="pos path-save">+${fmt(a.saving, { whole: true })}</b></label>`).join('')}
    ${path.actions.length > list.length ? `<button class="btn ghost full" data-action="tr-path-more">Show all ${path.actions.length} actions</button>` : ''}
    ${path.gap < 0 && after < 0 ? '<div class="act-links"><a class="act-link" href="https://www.stepchange.org/" target="_blank" rel="noopener">StepChange: free debt advice ↗</a><a class="act-tel" href="tel:08001381111">📞 0800 138 1111</a></div>' : ''}
  </div>`;
}

export const actions = {
  'tr-m': (el) => {
    const i = +el.dataset.i;
    ui.sel = i;
    const d = document.getElementById('tr-detail');
    if (d) d.innerHTML = detailFor(points[i]);
    document.querySelectorAll('.cash-chart .cm').forEach((g, j) => g.classList.toggle('sel', j === i));
  },
  'tr-with': (el, rerender) => { ui.withActions = el.dataset.v === '1'; ui.sel = null; rerender(); },
  'tr-path-more': (_, rerender) => { ui.showAllPath = true; rerender(); },
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
  'tr-path': async (el, rerender) => {
    const chosen = { ...(state.settings.pathChosen || {}) };
    const id = el.dataset.id;
    const patch = {};
    if (el.checked) {
      chosen[id] = true;
      // A spending cut becomes that category's budget, so alerts hold you to it.
      if (id.startsWith('trim:')) {
        const { budget, recurring } = state.derived;
        const a = buildPath({ budget, recurring, settings: state.settings, income: budget.income, avgSpend: budget.avgSpend || 0 }).actions.find((x) => x.id === id);
        if (a?.target != null) patch.budgets = { ...(state.settings.budgets || {}), [a.category]: a.target };
      }
      if (id.startsWith('sub:')) patch.billFlags = { ...(state.settings.billFlags || {}), [id.slice(4)]: 'cancel' };
    } else delete chosen[id];
    await saveSettings({ pathChosen: chosen, ...patch });
    if (patch.budgets) { recompute(); toast('Set as your budget'); } else if (patch.billFlags) toast('Added to your cancel list');
    rerender();
  },
};

void CAT;
