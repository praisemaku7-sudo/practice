// Statement import: PDF (on-device or Claude) and CSV, with a review step before saving.
import { state, recompute, relinkTransfers } from '../state.js';
import { db } from '../lib/db.js';
import { esc, openSheet, closeSheet, busy, toast, fileToBase64 } from './dom.js';
import { fmt } from '../lib/money.js';
import { parseCSVStatement } from '../lib/parse/csv.js';
import { parseStatementLines } from '../lib/parse/statementText.js';
import { toTransactions, dedupe, guessBank } from '../lib/importer.js';
import { aiReadStatement } from '../lib/ai.js';
import { prettyDate, monthKey, daysBetween } from '../lib/dates.js';

async function parseOnDevice(file) {
  const { extractPdfLines } = await import('../lib/parse/pdf.js');
  const buf = await file.arrayBuffer();
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

async function parseFile(file) {
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
    const r = await parseOnDevice(file);
    if (!r.hasText) r.warnings.unshift(apiKey ? 'This looks like a scanned PDF. Turn on "Read PDFs with Claude" in Settings.' : 'This looks like a scanned PDF (no text). Add a Claude API key in Settings to read it, or import a CSV instead.');
    return { ...r, method: 'on-device' };
  } finally { done(); }
}

function matchAccount(parsed) {
  const bank = (parsed.bank || '').toLowerCase();
  return state.accounts.find((a) => bank && (a.bank || '').toLowerCase() === bank && a.type === (parsed.accountType || 'current'))
    || (parsed.accountName && state.accounts.find((a) => a.name.toLowerCase() === parsed.accountName.toLowerCase()));
}

function review(file, parsed) {
  return new Promise((resolve) => {
    const txs = parsed.transactions;
    const dates = txs.map((t) => t.date).sort();
    const inSum = txs.filter((t) => t.amount > 0).reduce((a, t) => a + t.amount, 0);
    const outSum = txs.filter((t) => t.amount < 0).reduce((a, t) => a - t.amount, 0);
    const match = matchAccount(parsed);
    const suggestedName = parsed.accountName || [parsed.bank, parsed.accountType === 'credit' ? 'Card' : parsed.accountType === 'savings' ? 'Savings' : 'Current'].filter(Boolean).join(' ') || file.name.replace(/\.\w+$/, '');
    openSheet(`<h2>Review import</h2>
      <p class="muted ellipsis">${esc(file.name)} · read ${esc(parsed.method)}</p>
      ${parsed.warnings?.map((w) => `<div class="alert">${esc(w)}</div>`).join('') || ''}
      ${txs.length ? `<div class="stat-row"><div><b>${txs.length}</b><span>transactions</span></div>
        <div><b>${prettyDate(dates[0])}–${prettyDate(dates[dates.length - 1])}</b><span>${dates[0].slice(0, 4)}</span></div>
        <div><b class="pos">${fmt(inSum, { whole: true })}</b><span>in</span></div><div><b>${fmt(outSum, { whole: true })}</b><span>out</span></div></div>
      <label class="field select"><span>Account</span><select id="rv-acc">
        ${state.accounts.map((a) => `<option value="${esc(a.id)}" ${match?.id === a.id ? 'selected' : ''}>${esc(a.name)} (${esc(a.bank || '')})</option>`).join('')}
        <option value="__new" ${match ? '' : 'selected'}>+ New account</option></select></label>
      <div id="rv-new" ${match ? 'hidden' : ''}>
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
      <div class="row gap"><button class="btn ghost grow" id="rv-cancel">Skip</button><button class="btn primary grow" id="rv-ok">Import ${txs.length}</button></div>`
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

async function commit(file, parsed, choice) {
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
  const rec = { id: importId, fileName: file.name, accountId: account.id, at: Date.now(), count: fresh.length, dupes: dupes.length, method: parsed.method };
  state.imports.push(rec);
  await db.put('imports', rec);
  await relinkTransfers();
  recompute();
  if (lastDate) state.month = monthKey(lastDate);
  return { added: fresh.length, dupes: dupes.length, replaced: replaced.length };
}

export async function importFiles(files, rerender) {
  for (const file of files) {
    let parsed;
    try { parsed = await parseFile(file); } catch (e) {
      console.error(e);
      toast(`Couldn't read ${file.name}: ${e.message || e}`, { error: true });
      continue;
    }
    const choice = await review(file, parsed);
    if (!choice) continue;
    const r = await commit(file, parsed, choice);
    toast(`Added ${r.added} transactions${r.dupes ? ` · ${r.dupes} already imported` : ''}`);
    rerender();
  }
}

export function pickFiles(rerender) {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = '.pdf,.csv,application/pdf,text/csv,text/comma-separated-values';
  input.onchange = () => importFiles([...input.files], rerender);
  input.click();
}
