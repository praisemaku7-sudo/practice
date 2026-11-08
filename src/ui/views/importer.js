import { state, personName, ownerOf } from '../../state.js';
import { esc } from '../dom.js';
import { fmt } from '../../lib/money.js';
import { prettyDate, monthLabel } from '../../lib/dates.js';
import { queue, commitAll, clearQueue, pickFiles, busyCount, retryFailed, reimportAllDuplicates, applyPayslip, applySA302 } from '../import.js';

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
    body = `<div class="alert">${esc(it.error)}</div>${/Not a (PDF or CSV|statement)/.test(it.error) ? '' : `<button class="btn ghost full" data-action="imp-retry" data-id="${it.id}">Retry</button>`}`;
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
    body = `<div class="sub">${it.result.added} transaction${it.result.added === 1 ? '' : 's'} → ${esc(it.result.account)}${it.result.replaced ? ` · replaced ${it.result.replaced} saved before` : ''}${it.result.dupes ? ` · ${it.result.dupes} already there` : ''}</div>`;
  } else if (p) {
    const badge = p.verified
      ? `<span class="pill ok">✓ Balances check out</span>`
      : p.method === 'Claude' ? '<span class="pill">Read by Claude</span>' : txs.length ? `<span class="pill warn">Check the amounts</span>` : '';
    body = `
      ${it.doc && !it.doc.isStatement ? `<div class="alert"><b>Not a statement?</b> ${esc(it.doc.reason)} It won't be imported unless you tick Import.</div>` : ''}
      ${(it.prior || it.overlap?.likelyDuplicate) ? `<div class="tip-box">${it.prior ? `Imported before on ${new Date(it.prior.at).toLocaleDateString('en-GB')}.` : `Already saved${ovAcc ? ` in ${esc(ovAcc.name)}` : ''}.`} ${it.include ? 'This read checks out, so it will <b>replace</b> the saved copy (nothing doubles up).' : 'Tick <b>Import</b> to replace the saved copy with this read.'}</div>` : ''}
      ${it.include && it.replace && txs.length ? `<div class="sub warn-text">Will replace the saved transactions for this account from ${prettyDate(dates[0])} to ${prettyDate(dates[dates.length - 1])}.</div>` : ''}
      ${!it.prior && it.overlap?.partialOverlap ? `<div class="tip-box">${it.overlap.matched} overlap an earlier statement. Only ${it.overlap.total - it.overlap.matched} new will be added.</div>` : ''}
      ${p.details?.bankMismatch ? `<div class="alert">The sort code ${esc(p.details.sortCode)} belongs to <b>${esc(p.details.bankFromSort)}</b>, but the statement says <b>${esc(p.details.bank)}</b>. Check this is the right file and account.</div>` : ''}
      ${p.details && (p.details.holder || p.details.sortCode || p.details.product) ? `<div class="details-line">🏦 ${esc([p.details.bank, p.details.product].filter(Boolean).join(' · '))}${p.details.sortCode ? ` · ${esc(p.details.sortCode)}${p.details.bankFromSort ? (p.details.bankMismatch ? ' ⚠︎' : ' ✓') : ''}` : ''}${p.details.last4 ? ` · ••${esc(p.details.last4)}` : ''}${p.details.holder ? ` · 👤 ${esc(p.details.holder)}` : ''}</div>` : ''}
      ${(p.warnings || []).map((w) => `<div class="sub warn-text">• ${esc(w)}</div>`).join('')}
      ${p.screenshot && p.closingBalance != null ? `<div class="tip-box">📸 Balance shown: <b>${fmt(Math.abs(p.closingBalance))}</b>${p.accountType === 'credit' ? ' owed' : ''}. It will update the account you choose.</div>` : ''}
      ${!txs.length && p.screenshot ? `<label class="field select slim grow"><select data-change="imp-acc" data-id="${it.id}">${state.accounts.map((a) => `<option value="${esc(a.id)}" ${it.accountChoice === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}<option value="__new" ${it.accountChoice === '__new' ? 'selected' : ''}>+ New: ${esc(it.newAccount.name)}</option></select></label>` : ''}
      ${txs.length ? `<div class="imp-stats"><b>${txs.length}</b> transactions · ${prettyDate(dates[0])}–${prettyDate(dates[dates.length - 1])} · <span class="pos">${fmt(inSum, { whole: true })} in</span> · ${fmt(outSum, { whole: true })} out</div>
      <div class="row gap wrap-sm">
        <label class="field select slim grow"><select data-change="imp-acc" data-id="${it.id}">
          ${state.accounts.map((a) => `<option value="${esc(a.id)}" ${it.accountChoice === a.id ? 'selected' : ''}>${esc(a.name)}${a.type === 'credit' ? ' 💳' : ''}${state.settings.people.length > 1 ? ` · ${esc(personName(ownerOf(a)))}` : ''}</option>`).join('')}
          <option value="__new" ${it.accountChoice === '__new' ? 'selected' : ''}>+ New: ${esc(it.newAccount.name)}</option></select></label>
      </div>
      ${it.accountChoice === '__new' ? `<div class="row gap wrap-sm">
        <label class="field slim grow"><input value="${esc(it.newAccount.name)}" placeholder="Account name" data-input="imp-name" data-id="${it.id}"></label>
        <label class="field select slim"><select data-change="imp-type" data-id="${it.id}">
          ${['current', 'credit', 'savings'].map((t) => `<option value="${t}" ${it.newAccount.type === t ? 'selected' : ''}>${{ current: 'Current', credit: 'Credit card', savings: 'Savings' }[t]}</option>`).join('')}</select></label>
        ${state.settings.people.length > 1 ? `<label class="field select slim"><select data-change="imp-owner" data-id="${it.id}">${[...state.settings.people.map((pp) => [pp.id, pp.name]), ['joint', 'Joint']].map(([id, n]) => `<option value="${id}" ${it.newAccount.owner === id ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>` : ''}</div>` : ''}
      <div class="row between imp-actions">
        <label class="toggle"><input type="checkbox" data-change="imp-include" data-id="${it.id}" ${it.include ? 'checked' : ''}> Import</label>
        <label class="toggle"><input type="checkbox" data-change="imp-flip" data-id="${it.id}" ${it.flip ? 'checked' : ''}> In/out swapped</label>
        <button class="link" data-action="imp-preview" data-id="${it.id}">${it.showPreview ? 'Hide' : 'Preview'}</button>
      </div>
      ${it.showPreview ? `<div class="preview">${txs.slice(0, 60).map((t) => { const a = it.flip ? -t.amount : t.amount; return `<div class="pv-row"><span>${prettyDate(t.date)}</span><span class="ellipsis grow">${esc(t.description)}</span><b class="${a > 0 ? 'pos' : ''}">${fmt(a, { sign: true })}</b></div>`; }).join('')}${txs.length > 60 ? `<p class="sub center">…and ${txs.length - 60} more</p>` : ''}</div>` : ''}
      ` : ''}
      <div class="sub faint">${badge} ${esc(p.method)}${it.ms != null ? ` · ${(it.ms / 1000).toFixed(1)}s` : ''}</div>`;
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
      <p class="muted">Pick every PDF or CSV at once, all banks and all months. They're read at the same time, checked against the printed balances, and duplicates are caught.</p>
      <button class="btn primary" data-action="import">Choose files</button>
    </div>
    ${tips()}`;
  }
  const busy = busyCount();
  const ready = items.filter((i) => i.status === 'ready' && i.include);
  const txCount = ready.reduce((a, i) => a + i.parsed.transactions.length - (i.replace ? 0 : (i.overlap?.matched || 0)), 0);
  const done = items.filter((i) => ['ready', 'imported', 'skipped', 'error'].includes(i.status)).length;
  const failed = items.filter((i) => i.status === 'error' && !/Not a (PDF or CSV|statement)/.test(i.error || ''));
  const dupes = items.filter((i) => i.status === 'ready' && !i.include && i.parsed?.transactions.length && (i.prior || i.overlap?.likelyDuplicate));
  const missing = state.derived.coverage.missing;
  const order = { error: 0, ready: 1, ai: 2, reading: 3, queued: 4, imported: 5, skipped: 6 };
  const sorted = [...items].sort((a, b) => order[a.status] - order[b.status]);
  return `<h1 class="page-title">Import <small>${done}/${items.length} read</small></h1>
  ${queue.summary ? `<div class="card verdict yes"><div class="verdict-head"><span class="verdict-icon">✓</span><div><div class="verdict-word">${queue.summary.added} transactions added</div><div>from ${queue.summary.files} file${queue.summary.files === 1 ? '' : 's'}${busy ? ` · ${busy} still reading` : ''}</div></div></div>
    ${!busy ? (missing.length ? `<h4>Still missing</h4>${missing.slice(0, 8).map((m) => `<div class="list-row"><span class="bank-badge warn">!</span><div class="grow"><b>${esc(m.accountName)}</b><div class="sub">${esc(monthLabel(m.month))}</div></div></div>`).join('')}` : '<p class="good-note">No statements missing ✓</p>') : ''}
    <div class="row gap"><button class="btn ghost grow" data-action="import">Add more</button><a class="btn primary grow" href="#/home" data-action="imp-done">Done</a></div></div>` : ''}
  ${failed.length ? `<div class="card banner bad"><b>${failed.length} file${failed.length > 1 ? 's' : ''} couldn't be read</b><span class="sub">${esc(failed[0].error)}</span><button class="btn primary full" data-action="imp-retry">Retry ${failed.length > 1 ? 'all' : ''}</button></div>` : ''}
  ${dupes.length ? `<div class="card banner"><b>${dupes.length} file${dupes.length > 1 ? 's were' : ' was'} imported before</b><span class="sub">Skipped so nothing doubles up. If those earlier imports came out wrong (before the AI key was added), re-import them: the old transactions for those dates are replaced.</span><button class="btn primary full" data-action="imp-reimport-all">Re-import ${dupes.length} &amp; replace old data</button></div>` : ''}
  ${sorted.map(itemCard).join('')}
  ${ready.length || busy ? `<div class="sticky-cta">
    <button class="btn ghost" data-action="import">＋ More</button>
    <button class="btn primary grow" data-action="imp-commit" ${!ready.length ? 'disabled' : ''}>${ready.length ? `Import ${ready.length} file${ready.length === 1 ? '' : 's'} · ${txCount}${busy ? ` · ${busy} still reading` : ''}` : busy ? `Reading ${busy} file${busy === 1 ? '' : 's'}…` : 'Nothing ticked: tick Import on a file above'}</button>
  </div>` : ''}`;
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
  'imp-done': () => { clearQueue(); location.hash = '#/home'; },
  'imp-retry': (el, rerender) => { retryFailed(el.dataset.id); rerender(); },
  'imp-payslip': async (el, rerender) => { await applyPayslip(find(el)); rerender(); },
  'imp-sa302': async (el, rerender) => { await applySA302(find(el)); rerender(); },
  'imp-reimport-all': (_, rerender) => { reimportAllDuplicates(); rerender(); },
};
export const changes = {
  'imp-acc': (el, rerender) => { find(el).accountChoice = el.value; rerender(); },
  'imp-type': (el) => { find(el).newAccount.type = el.value; },
  'imp-slip-owner': (el) => { find(el).payslip.owner = el.value; },
  'imp-sa-owner': (el) => { find(el).sa302.owner = el.value; },
  'imp-owner': (el) => { find(el).newAccount.owner = el.value; },
  'imp-include': (el, rerender) => {
    const it = find(el);
    it.include = el.checked;
    // Ticking a file that was imported before means "read it again and replace the old data".
    it.replace = el.checked && !!(it.prior || it.overlap?.likelyDuplicate);
    rerender();
  },
  'imp-flip': (el, rerender) => { find(el).flip = el.checked; rerender(); },
};
export const inputs = {
  'imp-name': (el) => { find(el).newAccount.name = el.value; }, // no re-render while typing
};
export { pickFiles };
