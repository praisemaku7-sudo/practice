import { validateStatement } from '../../lib/validate.js';
import { state, personName, ownerOf } from '../../state.js';
import { esc, toast } from '../dom.js';
import { fmt } from '../../lib/money.js';
import { prettyDate, monthLabel } from '../../lib/dates.js';
import { saveCreditReport, usePlan } from '../../lib/ontrack-store.js';
import { queue, commitAll, clearQueue, pickFiles, busyCount, retryFailed, reimportAllDuplicates, applyPayslip, applySA302, emptyAccounts, removeEmptyAccounts } from '../import.js';

const STATUS = {
  queued: ['Waiting', ''],
  reading: ['Reading…', 'busy'],
  ai: ['Claude is reading…', 'busy'],
  ready: ['Ready', 'ok'],
  error: ["Couldn't read", 'bad'],
  imported: ['Imported', 'ok'],
  skipped: ['Skipped', ''],
};

function itemCard(it) {
  const [label, cls] = STATUS[it.status];
  const p = it.parsed;
  const txs = p?.transactions || [];
  const dates = txs.map((t) => t.date).sort();
  const inSum = txs.filter((t) => t.amount > 0).reduce((a, t) => a + t.amount, 0);
  const outSum = txs.filter((t) => t.amount < 0).reduce((a, t) => a - t.amount, 0);
  const pct = it.progress?.total ? Math.round((it.progress.done / it.progress.total) * 100) : null;
  const ovAcc = it.overlap?.matchedAccountId && state.accounts.find((a) => a.id === it.overlap.matchedAccountId);
  let body = '';
  if (it.status === 'reading' || it.status === 'ai' || it.status === 'queued') {
    body = `<div class="pbar ${it.status === 'ai' ? '' : 'indeterminate'}"><span style="width:${pct ?? 35}%"></span></div>
      <div class="sub">${it.status === 'ai' ? `Claude is reading it because ${esc(it.aiReason || 'it needs checking')}${it.progress?.total > 1 ? ` · part ${it.progress.done}/${it.progress.total}` : ''}. If your account's limit is reached it waits and retries automatically.` : it.status === 'queued' ? 'Waiting for a free slot' : 'Reading on your phone'}</div>`;
  } else if (it.status === 'error') {
    body = `<div class="alert">${esc(it.error)}</div>${/Not a (PDF or CSV|statement)|Spreadsheet files/.test(it.error) ? '' : `<button class="btn ghost full" data-action="imp-retry" data-id="${it.id}">Retry</button>`}`;
  } else if (it.status === 'ready' && (it.payslipManual || it.sa302Manual)) {
    const kind = it.payslipManual ? 'payslip' : 'sa302';
    const owner = (it.payslipManual || it.sa302Manual).owner;
    body = `<div class="tip-box"><b>${kind === 'payslip' ? '💷 Payslip' : '🧾 SA302'}</b> recognised, but its figures couldn't be read automatically. Type them here:</div>
      ${kind === 'payslip'
        ? `<label class="field slim"><span>Take-home (net) £</span><input inputmode="decimal" id="man-net-${it.id}" placeholder="e.g. 2603.40"></label>
           <label class="field select slim"><span>Paid</span><select id="man-freq-${it.id}"><option value="monthly">Monthly</option><option value="four-weekly">Every 4 weeks</option><option value="fortnightly">Fortnightly</option><option value="weekly">Weekly</option></select></label>`
        : `<label class="field slim"><span>Total income £</span><input inputmode="decimal" id="man-inc-${it.id}" placeholder="from the SA302"></label>
           <label class="field slim"><span>Total tax &amp; NI £</span><input inputmode="decimal" id="man-tax-${it.id}" placeholder="from the SA302"></label>`}
      ${state.settings.people.length > 1 ? `<label class="field select slim"><span>Whose</span><select id="man-owner-${it.id}">${state.settings.people.map((pp) => `<option value="${pp.id}" ${owner === pp.id ? 'selected' : ''}>${esc(pp.name)}</option>`).join('')}</select></label>` : ''}
      <button class="btn primary full" data-action="imp-manual-income" data-id="${it.id}" data-kind="${kind}">Use as usual income</button>`;
  } else if (it.creditReport) {
    const r = it.creditReport;
    const active = r.accounts.filter((a) => a.section === 'active');
    body = it.status === 'imported'
      ? `<div class="sub">✓ Saved to ${esc(personName(r.owner))}'s credit health (On track → Credit).</div>`
      : `<div class="tip-box"><b>📈 Credit report</b> · ${esc(r.provider)}${r.date ? ` · ${prettyDate(r.date)} ${r.date.slice(0, 4)}` : ''}<br>
        ${r.score != null ? `Score <b>${r.score}</b> · ` : ''}${active.length} open account${active.length === 1 ? '' : 's'} · ${r.hardSearches.length} hard search${r.hardSearches.length === 1 ? '' : 'es'}${active.some((a) => a.late12) ? ' · <span class="neg">late payments in the last year</span>' : ''}${active.some((a) => a.overLimit) ? ' · <span class="neg">over a limit</span>' : ''}</div>
        <p class="sub">Read on your phone and kept on your phone only. It isn't imported as transactions.</p>
        ${state.settings.people.length > 1 ? `<label class="field select slim"><span>Whose report</span><select data-change="imp-credit-owner" data-id="${it.id}">${state.settings.people.map((pp) => `<option value="${pp.id}" ${r.owner === pp.id ? 'selected' : ''}>${esc(pp.name)}</option>`).join('')}</select></label>` : ''}
        <button class="btn primary full" data-action="imp-credit-save" data-id="${it.id}">Save to credit health</button>`;
  } else if (it.plan) {
    const pl = it.plan;
    body = it.status === 'imported'
      ? '<div class="sub">✓ Your plan is in On track.</div>'
      : `<div class="tip-box"><b>🧭 Household plan</b><br>${[pl.budget.length && `${pl.budget.length} budget lines`, pl.debts.length && `${pl.debts.length} debts`, pl.savings.length && `${pl.savings.length} savings actions (${fmt(pl.savings.reduce((a, x) => a + (x.saving || 0), 0), { whole: true })}/month)`, pl.regular.length && `${pl.regular.length} regular payments`, pl.steps.length && `${pl.steps.length}-step action plan`].filter(Boolean).join(' · ')}</div>
        <label class="check-row"><input type="checkbox" id="plan-budgets-${it.id}" checked> <span><b>Use its suggested budget</b><br><small class="sub">Sets your category budgets to the spreadsheet's "suggested" amounts.</small></span></label>
        <button class="btn primary full" data-action="imp-plan-use" data-id="${it.id}">Use this plan</button>`;
  } else if (it.status === 'imported' && it.result?.sa302) {
    body = `<div class="sub">✓ ${esc(it.sa302.taxYear || 'SA302')} saved for ${esc(personName(it.sa302.owner))}: usual income ${fmt(it.sa302.monthlyNet)}/month.</div>`;
  } else if (it.sa302 && it.status === 'ready') {
    const sa = it.sa302;
    body = `<div class="tip-box"><b>🧾 SA302 tax calculation</b>${sa.taxYear ? ` · ${esc(sa.taxYear)}` : ''}<br>
      Income ${fmt(sa.totalIncome)} − tax &amp; NI ${fmt(sa.taxDue)} = <b>${fmt(sa.net)}</b>/year → <b>${fmt(sa.monthlyNet)}/month</b> take-home</div>
      ${state.settings.people.length > 1 ? `<label class="field select slim"><span>Whose</span><select data-change="imp-sa-owner" data-id="${it.id}">${state.settings.people.map((pp) => `<option value="${pp.id}" ${sa.owner === pp.id ? 'selected' : ''}>${esc(pp.name)}</option>`).join('')}</select></label>` : ''}
      <button class="btn primary full" data-action="imp-sa302" data-id="${it.id}">Use as usual income</button>
      <p class="sub">With two SA302s, the newest tax year is used. Maternity pay or other temporary income can be added in Budget.</p>`;
  } else if (it.status === 'imported' && it.result?.payslip) {
    body = `<div class="sub">✓ Take-home pay of ${fmt(it.payslip.monthlyNet)}/month saved as ${esc(personName(it.payslip.owner))}'s income.</div>`;
  } else if (it.payslip && it.status === 'ready') {
    const sl = it.payslip;
    body = `<div class="tip-box"><b>💷 Payslip</b>${sl.employer ? ` from ${esc(sl.employer)}` : ''}${sl.payDate ? ` · paid ${prettyDate(sl.payDate)}` : ''}<br>
      Take-home <b>${fmt(sl.net)}</b> ${sl.frequency !== 'monthly' ? `(${sl.frequency}) = <b>${fmt(sl.monthlyNet)}/month</b>` : 'per month'}${sl.gross ? ` · gross ${fmt(sl.gross)}` : ''}</div>
      ${state.settings.people.length > 1 ? `<label class="field select slim"><span>Whose pay</span><select data-change="imp-slip-owner" data-id="${it.id}">${state.settings.people.map((pp) => `<option value="${pp.id}" ${sl.owner === pp.id ? 'selected' : ''}>${esc(pp.name)}</option>`).join('')}</select></label>` : ''}
      <button class="btn primary full" data-action="imp-payslip" data-id="${it.id}">Use as monthly income</button>`;
  } else if (it.status === 'imported') {
    body = `<div class="sub">${it.result.added} transaction${it.result.added === 1 ? '' : 's'} → ${esc(it.result.account)}${it.result.replaced ? ` · replaced ${it.result.replaced} saved before` : ''}${it.result.moved ? ` · moved ${it.result.moved} out of the wrong account` : ''}${it.result.dupes ? ` · ${it.result.dupes} already there` : ''}</div>`;
  } else if (p) {
    const v = txs.length || p.screenshot ? validateStatement({ ...p, accountType: it.accountChoice === '__new' ? it.newAccount.type : (state.allAccounts || state.accounts).find((a) => a.id === it.accountChoice)?.type || p.accountType }) : null;
    const verdict = v && it.doc?.isStatement !== false ? `<details class="imp-verdict ${v.level}" ${v.level === 'fail' ? 'open' : ''}><summary>${v.level === 'ok' ? '✅ Read correctly: the statement\'s own figures agree' : v.level === 'fail' ? '⚠️ Something doesn\'t add up: check before importing' : 'ℹ️ ' + esc(v.summary)}</summary>${v.checks.map((c) => `<div class="check-line ${c.ok === true ? 'ok' : c.ok === false ? 'bad' : ''}">${c.ok === true ? '✓' : c.ok === false ? '✗' : '–'} ${esc(c.text.replace(/ ?✓/g, ''))}</div>`).join('')}</details>` : '';
    // Everything worth knowing about this file, as one short list.
    const notes = [
      it.blockedAccount && 'You removed this account before as not real, so it isn\'t imported. Tick Import to bring it back.',
      it.misfiledIn && `These payments were saved in <b>${esc(it.misfiledIn.name)}</b> by mistake: they'll move to the account below.`,
      it.doc && !it.doc.isStatement && `<b>Not a bank statement?</b> ${esc(it.doc.reason)} Only imported if you tick Import.`,
      it.include && it.replace && txs.length && `Replaces what's saved for this account from ${prettyDate(dates[0])} to ${prettyDate(dates[dates.length - 1])}${it.prior ? ` (imported before on ${new Date(it.prior.at).toLocaleDateString('en-GB')})` : ''}, so nothing doubles up.`,
      !it.include && (it.prior || it.overlap?.likelyDuplicate) && `Already saved${ovAcc ? ` in ${esc(ovAcc.name)}` : ''}. Tick <b>Import</b> to replace it with this read.`,
      !it.replace && !it.prior && it.overlap?.partialOverlap && `${it.overlap.matched} overlap an earlier statement: only ${it.overlap.total - it.overlap.matched} new will be added.`,
      p.details?.bankMismatch && `The sort code ${esc(p.details.sortCode)} belongs to <b>${esc(p.details.bankFromSort)}</b>, not ${esc(p.details.bank)}. Check it's the right file.`,
      p.screenshot && p.closingBalance != null && `📸 Balance shown: <b>${fmt(Math.abs(p.closingBalance))}</b>${p.accountType === 'credit' ? ' owed' : ''}. It updates the account you choose.`,
      ...(p.warnings || []).map((w) => esc(w)),
    ].filter(Boolean);
    const accSelect = `<label class="field select slim grow"><select data-change="imp-acc" data-id="${it.id}" aria-label="Account">
      ${state.accounts.map((a) => `<option value="${esc(a.id)}" ${it.accountChoice === a.id ? 'selected' : ''}>${esc(a.name)}${a.type === 'credit' ? ' 💳' : ''}${state.settings.people.length > 1 ? ` · ${esc(personName(ownerOf(a)))}` : ''}</option>`).join('')}
      <option value="__new" ${it.accountChoice === '__new' ? 'selected' : ''}>+ New: ${esc(it.newAccount.name)}</option></select></label>`;
    body = `
      ${verdict}
      ${txs.length ? `<div class="imp-stats"><b>${txs.length}</b> transaction${txs.length === 1 ? '' : 's'} · ${prettyDate(dates[0])}–${prettyDate(dates[dates.length - 1])} · <span class="pos">${fmt(inSum, { whole: true })} in</span> · ${fmt(outSum, { whole: true })} out</div>` : ''}
      ${notes.length ? `<ul class="imp-notes">${notes.map((n) => `<li>${n}</li>`).join('')}</ul>` : ''}
      ${txs.length || p.screenshot ? `<div class="row gap">${accSelect}</div>` : ''}
      ${it.accountChoice === '__new' && (txs.length || p.screenshot) ? `<div class="imp-new">
        <label class="field slim imp-new-name"><span>Name</span><input value="${esc(it.newAccount.name)}" placeholder="Account name" data-input="imp-name" data-id="${it.id}"></label>
        <label class="field select slim"><select data-change="imp-type" data-id="${it.id}" aria-label="Type">
          ${['current', 'credit', 'savings'].map((t) => `<option value="${t}" ${it.newAccount.type === t ? 'selected' : ''}>${{ current: 'Current', credit: 'Credit card', savings: 'Savings' }[t]}</option>`).join('')}</select></label>
        ${state.settings.people.length > 1 ? `<label class="field select slim"><select data-change="imp-owner" data-id="${it.id}" aria-label="Whose">${[...state.settings.people.map((pp) => [pp.id, pp.name]), ['joint', 'Joint']].map(([id, n]) => `<option value="${id}" ${it.newAccount.owner === id ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>` : ''}</div>` : ''}
      ${txs.length ? `<div class="row between imp-actions">
        <label class="toggle"><input type="checkbox" data-change="imp-include" data-id="${it.id}" ${it.include ? 'checked' : ''}> Import</label>
        <button class="link" data-action="imp-preview" data-id="${it.id}">${it.showPreview ? 'Hide' : 'Preview'}</button>
        <button class="link" data-action="imp-more" data-id="${it.id}">${it.showMore ? 'Less' : 'Details'}</button>
      </div>` : ''}
      ${it.showMore ? `<div class="imp-more">
        ${p.details && (p.details.holder || p.details.sortCode || p.details.product) ? `<div class="details-line">🏦 ${esc([p.details.bank, p.details.product].filter(Boolean).join(' · '))}${p.details.sortCode ? ` · ${esc(p.details.sortCode)}` : ''}${p.details.last4 ? ` · ••${esc(p.details.last4)}` : ''}${p.details.holder ? ` · 👤 ${esc(p.details.holder)}` : ''}</div>` : ''}
        <label class="toggle"><input type="checkbox" data-change="imp-flip" data-id="${it.id}" ${it.flip ? 'checked' : ''}> Money in and out are swapped</label>
        <div class="sub faint">Read ${esc(p.method)}${it.ms != null ? ` in ${(it.ms / 1000).toFixed(1)}s` : ''}</div></div>` : ''}
      ${it.showPreview ? `<div class="preview">${txs.slice(0, 60).map((t) => { const a = it.flip ? -t.amount : t.amount; return `<div class="pv-row"><span>${prettyDate(t.date)}</span><span class="ellipsis grow">${esc(t.description)}</span><b class="${a > 0 ? 'pos' : ''}">${fmt(a, { sign: true })}</b></div>`; }).join('')}${txs.length > 60 ? `<p class="sub center">…and ${txs.length - 60} more</p>` : ''}</div>` : ''}`;
  }
  return `<div class="card imp-card ${it.status}">
    <div class="row between"><b class="ellipsis grow">${esc(it.name)}</b><span class="status ${cls}">${label}</span></div>
    ${body}</div>`;
}

export function render() {
  const items = queue.items;
  if (!items.length && !queue.summary) {
    return `<h1 class="page-title">Import</h1>
    <div class="card empty">
      <div class="empty-art">📥</div>
      <h2>Add your statements</h2>
      <p class="muted">Pick everything at once: PDF statements, CSV/OFX/QIF exports and screenshots from any bank or card app, all months. They're read at the same time, checked against the printed balances, and duplicates are caught.</p>
      <button class="btn primary" data-action="import">Choose files</button>
    </div>
    ${toFetch()}
    ${tips()}`;
  }
  const busy = busyCount();
  const ready = items.filter((i) => i.status === 'ready' && i.include);
  const txCount = ready.reduce((a, i) => a + i.parsed.transactions.length - (i.replace ? 0 : (i.overlap?.matched || 0)), 0);
  const done = items.filter((i) => ['ready', 'imported', 'skipped', 'error'].includes(i.status)).length;
  const failed = items.filter((i) => i.status === 'error' && !/Not a (PDF or CSV|statement)|Spreadsheet files/.test(i.error || ''));
  const dupes = items.filter((i) => i.status === 'ready' && !i.include && i.parsed?.transactions.length && (i.prior || i.overlap?.likelyDuplicate));
  const missing = state.derived.coverage.missing;
  const order = { error: 0, ready: 1, ai: 2, reading: 3, queued: 4, imported: 5, skipped: 6 };
  const sorted = [...items].sort((a, b) => order[a.status] - order[b.status]);
  return `<h1 class="page-title">Import <small>${done}/${items.length} read</small></h1>
  ${queue.summary ? `<div class="card verdict yes"><div class="verdict-head"><span class="verdict-icon">✓</span><div><div class="verdict-word">${queue.summary.added} transaction${queue.summary.added === 1 ? '' : 's'} added</div><div>from ${queue.summary.files} file${queue.summary.files === 1 ? '' : 's'}${busy ? ` · ${busy} still reading` : ''}</div>${(() => { const r = queue.summary.refreshed || 0; const d = items.reduce((a, i) => a + (i.result?.dupes || 0), 0) + r; return d ? `<div class="sub">${queue.summary.added ? '' : 'Nothing new: '}${d} transaction${d === 1 ? ' was' : 's were'} already saved${r ? ' and refreshed from this read' : ''}, so nothing is counted twice.</div>` : ''; })()}</div></div>
    ${!busy ? (missing.length ? `<h4>Still missing</h4>${missing.slice(0, 8).map((m) => `<div class="list-row"><span class="bank-badge warn">!</span><div class="grow"><b>${esc(m.accountName)}</b><div class="sub">${esc(monthLabel(m.month))}</div></div></div>`).join('')}` : '<p class="good-note">No statements missing ✓</p>') : ''}
    ${!busy && emptyAccounts().length ? `<div class="tip-box">${emptyAccounts().length} account${emptyAccounts().length > 1 ? 's are' : ' is'} now empty: ${emptyAccounts().map((a) => esc(a.name)).join(', ')}. Usually leftovers from earlier wrong imports.<button class="btn ghost full" data-action="imp-clean">Remove empty accounts</button></div>` : ''}
    <div class="row gap"><button class="btn ghost grow" data-action="import">Add more</button><a class="btn primary grow" href="#/home" data-action="imp-done">Done</a></div></div>` : ''}
  ${failed.length ? `<div class="card banner bad"><b>${failed.length} file${failed.length > 1 ? 's' : ''} couldn't be read</b><span class="sub">${esc(failed[0].error)}</span><button class="btn primary full" data-action="imp-retry">Retry ${failed.length > 1 ? 'all' : ''}</button></div>` : ''}
  ${dupes.length ? `<div class="card banner"><b>${dupes.length} file${dupes.length > 1 ? 's were' : ' was'} imported before</b><span class="sub">Skipped so nothing doubles up. If those earlier imports came out wrong (before the AI key was added), re-import them: the old transactions for those dates are replaced.</span><button class="btn primary full" data-action="imp-reimport-all">Re-import ${dupes.length} &amp; replace old data</button></div>` : ''}
  ${(() => { const slips = items.filter((i) => i.payslip && i.status === 'ready'); return slips.length > 1 ? `<div class="card banner"><b>${slips.length} payslips</b><span class="sub">Use them together: your income becomes your typical take-home from the latest normal months, and one-off months (corrections, back pay) are left out.</span><button class="btn primary full" data-action="imp-payslips-all">Use all ${slips.length} payslips</button></div>` : ''; })()}
  ${sorted.map(itemCard).join('')}
  ${!ready.length && !busy && items.some((i) => i.status === 'ready') ? `<div class="card banner bad"><b>None of these files will be imported yet</b>
    ${items.filter((i) => i.status === 'ready' && !i.include).map((i) => `<div class="sub">• <b>${esc(i.name)}</b>: ${esc(i.sa302 || i.payslip ? 'income document: use its button above' : i.doc && !i.doc.isStatement ? (i.doc.kind === 'investment' ? 'investment statement, not counted' : 'doesn\'t look like a bank statement') : !i.parsed?.transactions?.length ? 'no transactions found in it' : (i.prior || i.overlap?.likelyDuplicate) ? 'already imported' : 'Import is unticked')}</div>`).join('')}
    <span class="sub">If one of them is a real statement, tick <b>Import</b> on its card.</span></div>` : ''}
  ${ready.length || busy ? `<div class="sticky-cta">
    <button class="btn ghost" data-action="import">＋ More</button>
    ${!ready.length && items.some((i) => i.payslip && i.status === 'ready') ? `<button class="btn primary grow" data-action="imp-payslips-all">Use ${items.filter((i) => i.payslip && i.status === 'ready').length} payslip${items.filter((i) => i.payslip && i.status === 'ready').length === 1 ? '' : 's'} as income</button>` : `<button class="btn primary grow" data-action="imp-commit" ${!ready.length ? 'disabled' : ''}>${ready.length ? `Import ${ready.length} file${ready.length === 1 ? '' : 's'} · ${txCount}${busy ? ` · ${busy} still reading` : ''}` : busy ? `Reading ${busy} file${busy === 1 ? '' : 's'}…` : 'Nothing ticked: tick Import on a file above'}</button>`}
  </div>` : ''}`;
}

/** What to import next: statements missing per account, and earlier reads that didn't add up. */
function toFetch() {
  const missing = state.derived?.coverage?.missing || [];
  const seen = new Set();
  const redo = [...state.imports].sort((a, b) => b.at - a.at).filter((i) => i.validation?.level === 'fail' && !seen.has(i.fileName) && seen.add(i.fileName));
  if (!missing.length && !redo.length) return state.txs.length ? '<div class="card"><p class="good-note">✓ Every account is up to date</p></div>' : '';
  const byAcc = {};
  for (const m of missing) (byAcc[m.accountName] ||= []).push(m.month);
  return `<div class="card"><h3>To import next</h3>
    ${Object.entries(byAcc).map(([name, ms]) => `<div class="list-row"><span class="bank-badge warn">!</span><div class="grow"><b>${esc(name)}</b><div class="sub">${ms.map((m) => esc(monthLabel(m, { short: true }))).join(', ')}</div></div></div>`).join('')}
    ${redo.length ? `<h4>Didn't add up when first read: import again</h4><p class="sub">Reading has improved, and a re-import replaces the old transactions for those dates.</p>${redo.slice(0, 10).map((i) => `<div class="list-row"><span class="bank-badge">↻</span><div class="grow ellipsis">${esc(i.fileName)}<div class="sub">${new Date(i.at).toLocaleDateString('en-GB')}</div></div></div>`).join('')}` : ''}
    <button class="btn primary full" data-action="import">Choose files</button></div>`;
}

function tips() {
  return `<div class="card"><h3>Fastest way to import</h3>
    <ul class="tips">
      <li><b>CSV beats PDF.</b> If your bank app offers CSV export, it's instant and exact.</li>
      <li>PDFs are read on your phone first. If the printed balances add up, there's no AI call and no wait.</li>
      <li>Claude is only used when a PDF can't be verified (or is a scan). Long statements are split and read in parallel.</li>
      <li>In Files, tap <b>Select</b> and choose every statement at once.</li>
    </ul></div>`;
}

const find = (el) => queue.items.find((i) => i.id === el.dataset.id);

export const actions = {
  'imp-commit': async (_, rerender) => { await commitAll(); rerender(); window.scrollTo(0, 0); },
  'imp-preview': (el, rerender) => { const it = find(el); it.showPreview = !it.showPreview; rerender(); },
  'imp-more': (el, rerender) => { const it = find(el); it.showMore = !it.showMore; rerender(); },
  'imp-done': () => { clearQueue(); location.hash = '#/home'; },
  'imp-retry': (el, rerender) => { retryFailed(el.dataset.id); rerender(); },
  'imp-clean': async (_, rerender) => { const n = await removeEmptyAccounts(); rerender(); toast(`Removed ${n} empty account${n === 1 ? '' : 's'}`); },
  'imp-payslip': async (el, rerender) => { await applyPayslip(find(el)); rerender(); },
  'imp-payslips-all': async (_, rerender) => {
    const slips = queue.items.filter((i) => i.payslip && i.status === 'ready');
    for (const it of slips) await applyPayslip(it);
    const p = state.settings.payslips?.[slips[0].payslip.owner || state.settings.people[0].id];
    toast(p ? `Income set to ${fmt(p.monthlyNet, { whole: true })}/month from ${p.count} payslips` : 'Payslips saved'); rerender();
  },
  'imp-credit-save': async (el, rerender) => { const it = find(el); await saveCreditReport(it.creditReport); it.status = 'imported'; toast('Saved to credit health'); rerender(); },
  'imp-plan-use': async (el, rerender) => {
    const it = find(el);
    const n = await usePlan(it.plan, { budgets: document.getElementById(`plan-budgets-${it.id}`)?.checked });
    it.status = 'imported'; toast(`Plan saved${n ? ` · ${n} budgets set` : ''}`); rerender();
  },
  'imp-sa302': async (el, rerender) => { await applySA302(find(el)); rerender(); },
  'imp-manual-income': async (el, rerender) => {
    const it = find(el);
    const val = (id) => parseFloat((document.getElementById(id)?.value || '').replace(/[£,\s]/g, ''));
    const owner = document.getElementById(`man-owner-${it.id}`)?.value || state.settings.people[0].id;
    if (el.dataset.kind === 'payslip') {
      const net = Math.round(val(`man-net-${it.id}`) * 100);
      if (!net) return toast('Type the take-home amount', { error: true });
      const freq = document.getElementById(`man-freq-${it.id}`).value;
      const { toMonthly } = await import('../../lib/payslip.js');
      it.payslip = { net, gross: null, frequency: freq, monthlyNet: toMonthly(net, freq), payDate: null, employer: null, owner };
      await applyPayslip(it);
    } else {
      const inc = Math.round(val(`man-inc-${it.id}`) * 100), tax = Math.round((val(`man-tax-${it.id}`) || 0) * 100);
      if (!inc) return toast('Type the total income', { error: true });
      const net = Math.max(0, inc - tax);
      it.sa302 = { taxYear: it.sa302Manual.taxYear || null, totalIncome: inc, taxDue: tax, net, monthlyNet: Math.round(net / 12), owner };
      await applySA302(it);
    }
    rerender();
  },
  'imp-reimport-all': (_, rerender) => { reimportAllDuplicates(); rerender(); },
};
export const changes = {
  'imp-acc': (el, rerender) => { find(el).accountChoice = el.value; rerender(); },
  'imp-type': (el) => { find(el).newAccount.type = el.value; },
  'imp-slip-owner': (el) => { find(el).payslip.owner = el.value; },
  'imp-credit-owner': (el) => { find(el).creditReport.owner = el.value; },
  'imp-sa-owner': (el) => { find(el).sa302.owner = el.value; },
  'imp-owner': (el) => { find(el).newAccount.owner = el.value; },
  'imp-include': (el, rerender) => {
    const it = find(el);
    it.include = el.checked;
    // Ticking a file that was imported before means "read it again and replace the old data".
    it.replace = el.checked && (it.replaceAuto || !!(it.prior || it.overlap?.likelyDuplicate));
    rerender();
  },
  'imp-flip': (el, rerender) => { find(el).flip = el.checked; rerender(); },
};
export const inputs = {
  'imp-name': (el) => { find(el).newAccount.name = el.value; }, // no re-render while typing
};
export { pickFiles };
