// Statement import: PDF (on-device or Claude) and CSV, with a review step before saving.
import { state, recompute, relinkTransfers } from '../state.js';
import { db } from '../lib/db.js';
import { esc, openSheet, closeSheet, busy, toast, fileToBase64 } from './dom.js';
import { fmt } from '../lib/money.js';
import { parseCSVStatement } from '../lib/parse/csv.js';
import { parseStatementLines } from '../lib/parse/statementText.js';
import { toTransactions, dedupe, guessBank } from '../lib/importer.js';
import { aiReadStatement } from '../lib/ai.js';
import { prettyDate, monthKey, daysBetween, monthLabel } from '../lib/dates.js';
import { merchantKey } from '../lib/categorize.js';
import { overlapReport, fileHash, statementCoverage } from '../lib/coverage.js';
import { confirmSheet } from './dom.js';

async function parseOnDevice(file, buf) {
  const { extractPdfLines } = await import('../lib/parse/pdf.js');
  let res;
  try {
    res = await extractPdfLines(buf);
  } catch (e) {
    if (e?.name === 'PasswordException') {
      const pw = window.prompt(`${file.name} is password protected. Enter the PDF password:`);
      if (!pw) throw new Error('Password needed to open this PDF.');
      res = await extractPdfLines(buf, { password: pw });
    } else throw e;
  }
  const text = res.lines.map((l) => l.items.map((i) => i.str).join(' ')).join('\n');
  const parsed = parseStatementLines(res.lines);
  return { ...parsed, hasText: res.hasText, bank: guessBank(text), accountType: /credit card|card statement|minimum payment/i.test(text) ? 'credit' : /saver|savings|isa/i.test(text) ? 'savings' : 'current' };
}

/** Drop rows from before the tracking start date. */
function applyTrackFrom(parsed) {
  const from = state.settings.trackFrom;
  if (!from) return parsed;
  const kept = parsed.transactions.filter((t) => t.date >= from);
  const dropped = parsed.transactions.length - kept.length;
  if (!dropped) return parsed;
  const warnings = [...(parsed.warnings || [])];
  warnings.unshift(`${dropped} transaction${dropped > 1 ? 's' : ''} before ${prettyDate(from)} ${from.slice(0, 4)} skipped (you track from then; change it in Settings).`);
  return { ...parsed, transactions: kept, warnings, droppedOld: dropped };
}

async function parseFile(file, buf) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const { apiKey, model, useAIForPDF } = state.settings;
  if (!isPdf) {
    const text = await file.text();
    const r = parseCSVStatement(text);
    return { ...r, bank: guessBank(file.name + ' ' + text.slice(0, 400)), accountType: 'current', method: 'CSV' };
  }
  if (apiKey && useAIForPDF) {
    const done = busy(`Claude is reading ${file.name}…`);
    try {
      const r = await aiReadStatement({ apiKey, model, pdfBase64: await fileToBase64(file) });
      return { ...r, method: 'Claude' };
    } catch (e) {
      toast(`${e.message} Trying on-device reading instead.`, { error: true });
    } finally { done(); }
  }
  const done = busy(`Reading ${file.name}…`);
  try {
    const r = await parseOnDevice(file, buf);
    if (!r.hasText) r.warnings.unshift(apiKey ? 'This looks like a scanned PDF. Turn on "Read PDFs with Claude" in Settings.' : 'This looks like a scanned PDF (no text). Add a Claude API key in Settings to read it, or import a CSV instead.');
    return { ...r, method: 'on-device' };
  } finally { done(); }
}

function defaultName(parsed) {
  return parsed.accountName || [parsed.bank, parsed.accountType === 'credit' ? 'Card' : parsed.accountType === 'savings' ? 'Savings' : 'Current'].filter(Boolean).join(' ');
}

function matchAccount(parsed) {
  const bank = (parsed.bank || '').toLowerCase();
  const type = parsed.accountType || 'current';
  const name = defaultName(parsed).toLowerCase();
  return state.accounts.find((a) => bank && (a.bank || '').toLowerCase() === bank && a.type === type)
    || state.accounts.find((a) => a.name.toLowerCase() === name && a.type === type)
    || (parsed.accountName && state.accounts.find((a) => a.name.toLowerCase() === parsed.accountName.toLowerCase()));
}

function review(file, parsed) {
  return new Promise((resolve) => {
    const txs = parsed.transactions;
    const dates = txs.map((t) => t.date).sort();
    const inSum = txs.filter((t) => t.amount > 0).reduce((a, t) => a + t.amount, 0);
    const outSum = txs.filter((t) => t.amount < 0).reduce((a, t) => a - t.amount, 0);
    const match = matchAccount(parsed);
    const ov = overlapReport(txs.map((t) => ({ ...t, merchant: merchantKey(t.description) })), state.txs);
    const ovAcc = ov.matchedAccountId ? state.accounts.find((a) => a.id === ov.matchedAccountId) : null;
    const dupBanner = ov.likelyDuplicate
      ? `<div class="alert"><b>Looks like a statement you've already imported.</b> ${ov.matched} of ${ov.total} transactions are already saved${ovAcc ? ` under <b>${esc(ovAcc.name)}</b>` : ''}. Importing again won't double count, but you probably want to skip it.</div>`
      : ov.partialOverlap
        ? `<div class="tip-box">${ov.matched} of ${ov.total} transactions overlap a statement you've already imported${ovAcc ? ` (${esc(ovAcc.name)})` : ''}. Only the ${ov.total - ov.matched} new ones will be added.</div>`
        : '';
    const suggestedName = defaultName(parsed) || file.name.replace(/\.\w+$/, '');
    openSheet(`<h2>Review import</h2>
      <p class="muted ellipsis">${esc(file.name)} · read ${esc(parsed.method)}</p>
      ${dupBanner}
      ${parsed.warnings?.map((w) => `<div class="alert">${esc(w)}</div>`).join('') || ''}
      ${txs.length ? `<div class="stat-row"><div><b>${txs.length}</b><span>transactions</span></div>
        <div><b>${prettyDate(dates[0])}–${prettyDate(dates[dates.length - 1])}</b><span>${dates[0].slice(0, 4)}</span></div>
        <div><b class="pos">${fmt(inSum, { whole: true })}</b><span>in</span></div><div><b>${fmt(outSum, { whole: true })}</b><span>out</span></div></div>
      <label class="field select"><span>Account</span><select id="rv-acc">
        ${state.accounts.map((a) => `<option value="${esc(a.id)}" ${(ovAcc || match)?.id === a.id ? 'selected' : ''}>${esc(a.name)} (${esc(a.bank || '')})</option>`).join('')}
        <option value="__new" ${ovAcc || match ? '' : 'selected'}>+ New account</option></select></label>
      <div id="rv-new" ${ovAcc || match ? 'hidden' : ''}>
        <label class="field"><span>Name</span><input id="rv-name" value="${esc(suggestedName)}"></label>
        <label class="field"><span>Bank</span><input id="rv-bank" value="${esc(parsed.bank || '')}" placeholder="e.g. Monzo"></label>
        <label class="field select"><span>Type</span><select id="rv-type">
          <option value="current" ${parsed.accountType === 'current' ? 'selected' : ''}>Current account</option>
          <option value="credit" ${parsed.accountType === 'credit' ? 'selected' : ''}>Credit card</option>
          <option value="savings" ${parsed.accountType === 'savings' ? 'selected' : ''}>Savings</option></select></label>
      </div>
      <label class="toggle"><input type="checkbox" id="rv-flip"> Money in and out look swapped (flip them)</label>
      <div class="preview">${txs.slice(0, 40).map((t) => `<div class="pv-row"><span>${prettyDate(t.date)}</span><span class="ellipsis grow">${esc(t.description)}</span><b class="${t.amount > 0 ? 'pos' : ''}">${fmt(t.amount, { sign: true })}</b></div>`).join('')}
        ${txs.length > 40 ? `<p class="sub center">…and ${txs.length - 40} more</p>` : ''}</div>
      ${ov.likelyDuplicate
        ? `<div class="row gap"><button class="btn ghost grow" id="rv-ok">Import anyway</button><button class="btn primary grow" id="rv-cancel">Skip duplicate</button></div>`
        : `<div class="row gap"><button class="btn ghost grow" id="rv-cancel">Skip</button><button class="btn primary grow" id="rv-ok">Import ${txs.length - ov.matched || txs.length}</button></div>`}`
      : '<div class="row gap"><button class="btn primary grow" id="rv-cancel">OK</button></div>'}`, {
      onMount(p) {
        const sel = p.querySelector('#rv-acc');
        if (sel) sel.onchange = () => { p.querySelector('#rv-new').hidden = sel.value !== '__new'; };
        p.querySelector('#rv-cancel').onclick = () => { closeSheet(); resolve(null); };
        const ok = p.querySelector('#rv-ok');
        if (ok) ok.onclick = () => {
          const out = { flip: p.querySelector('#rv-flip').checked };
          if (sel.value === '__new') out.newAccount = { name: p.querySelector('#rv-name').value.trim() || suggestedName, bank: p.querySelector('#rv-bank').value.trim(), type: p.querySelector('#rv-type').value };
          else out.accountId = sel.value;
          closeSheet(); resolve(out);
        };
      },
    });
  });
}

async function commit(file, parsed, choice, hash) {
  let account;
  if (choice.newAccount) {
    account = { id: 'acc-' + (crypto.randomUUID?.() || Date.now().toString(36)), ...choice.newAccount, balance: null, balanceDate: null };
    state.accounts.push(account);
  } else account = state.accounts.find((a) => a.id === choice.accountId);

  const importId = 'imp-' + Date.now().toString(36);
  let rows = parsed.transactions;
  if (choice.flip) rows = rows.map((r) => ({ ...r, amount: -r.amount, balance: r.balance }));
  const txs = toTransactions(rows, { accountId: account.id, importId, source: parsed.method, userRules: state.settings.userRules });
  const { fresh, dupes } = dedupe(txs, new Set(state.txs.map((t) => t.id)));

  // Replace "I bought it" manual entries now that the real transaction has arrived.
  const manual = state.txs.filter((t) => t.manual);
  const replaced = [];
  for (const t of fresh) {
    const m = manual.find((x) => !replaced.includes(x) && x.amount === t.amount && Math.abs(daysBetween(x.date, t.date)) <= 5);
    if (m) { replaced.push(m); if (m.userCategory) { t.category = m.category; } }
  }
  for (const m of replaced) await db.del('tx', m.id);
  state.txs = state.txs.filter((t) => !replaced.includes(t)).concat(fresh);

  const lastDate = rows.map((r) => r.date).sort().pop();
  const closing = parsed.closingBalance ?? [...rows].reverse().find((r) => r.balance != null)?.balance ?? null;
  if (closing != null && (!account.balanceDate || lastDate >= account.balanceDate)) {
    // Credit cards: store what you owe as a negative balance.
    account.balance = account.type === 'credit' ? -Math.abs(closing) : closing;
    account.balanceDate = lastDate;
  }
  account.lastImport = state.derived.today;
  await db.put('accounts', account);
  await db.putMany('tx', fresh);
  const sortedDates = rows.map((r) => r.date).sort();
  let periodStart = sortedDates[0], periodEnd = sortedDates[sortedDates.length - 1];
  // Use the statement's printed period when it's close to the transactions (catches quiet days at either end).
  const ps = parsed.period?.start, pe = parsed.period?.end;
  if (ps && ps < periodStart && daysBetween(ps, periodStart) <= 35) periodStart = ps;
  if (pe && pe > periodEnd && daysBetween(periodEnd, pe) <= 35) periodEnd = pe;
  const rec = { id: importId, fileName: file.name, fileHash: hash, accountId: account.id, at: Date.now(), count: fresh.length, dupes: dupes.length, method: parsed.method, periodStart, periodEnd };
  state.imports.push(rec);
  await db.put('imports', rec);
  await relinkTransfers();
  recompute();
  if (lastDate) state.month = monthKey(lastDate);
  return { added: fresh.length, dupes: dupes.length, replaced: replaced.length };
}

let lastRerender = () => {};

export async function importFiles(files, rerender) {
  lastRerender = rerender;
  let added = 0, skipped = 0;
  for (const file of files) {
    const buf = await file.arrayBuffer();
    let hash = null;
    try { hash = await fileHash(buf); } catch { /* very old browser: rely on transaction matching */ }
    const prior = hash && state.imports.find((i) => i.fileHash === hash);
    if (prior) {
      const acc = state.accounts.find((x) => x.id === prior.accountId);
      const again = await confirmSheet({
        title: 'Already imported',
        body: `${file.name} is the exact same file you imported on ${new Date(prior.at).toLocaleDateString('en-GB')}${acc ? ` into ${acc.name}` : ''}. Skip it?`,
        ok: 'Check it anyway',
        cancel: 'Skip it',
      });
      if (!again) { skipped += 1; continue; }
    }
    let parsed;
    try { parsed = applyTrackFrom(await parseFile(file, buf)); } catch (e) {
      console.error(e);
      toast(`Couldn't read ${file.name}: ${e.message || e}`, { error: true });
      continue;
    }
    const choice = await review(file, parsed);
    if (!choice) { skipped += 1; continue; }
    const r = await commit(file, parsed, choice, hash);
    added += r.added;
    rerender();
  }
  await showCoverageSummary(added, skipped);
  rerender();
}

/** After a batch, say what was added and which months still look missing. */
async function showCoverageSummary(added, skipped) {
  const { missing } = statementCoverage({ accounts: state.accounts, imports: state.imports, txs: state.txs, today: state.derived.today, dismissed: state.settings.coverageDismissed || {} });
  if (!missing.length) { toast(`Added ${added} transactions${skipped ? ` · ${skipped} skipped` : ''}. No statements missing ✓`); return; }
  await new Promise((resolve) => {
    openSheet(`<h2>Any statements missing?</h2>
      <p class="muted">Added ${added} transactions${skipped ? `, skipped ${skipped} file${skipped > 1 ? 's' : ''}` : ''}. These months have no statement yet, so their totals will be too low:</p>
      ${missing.slice(0, 12).map((m) => `<div class="list-row"><span class="bank-badge">!</span><div class="grow"><b>${esc(m.accountName)}</b><div class="sub">${esc(monthLabel(m.month))}${m.reason === 'latest' ? ' · latest statement' : m.reason === 'start' ? ' · since you started tracking' : ' · gap between statements'}</div></div></div>`).join('')}
      ${missing.length > 12 ? `<p class="sub">…and ${missing.length - 12} more. See Accounts → Statements.</p>` : ''}
      <div class="row gap"><button class="btn ghost grow" id="cv-later">Later</button><button class="btn primary grow" id="cv-add">Import more</button></div>
      <p class="sub">No statement because the account was quiet or closed? Dismiss that month in Accounts → Statements.</p>`, {
      onMount(p) {
        p.querySelector('#cv-later').onclick = () => { closeSheet(); resolve(); };
        p.querySelector('#cv-add').onclick = () => { closeSheet(); resolve(); pickFiles(lastRerender); };
      },
    });
  });
}

export function pickFiles(rerender) {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = '.pdf,.csv,application/pdf,text/csv,text/comma-separated-values';
  input.onchange = () => importFiles([...input.files].sort((a, b) => a.name.localeCompare(b.name)), rerender);
  input.click();
}
