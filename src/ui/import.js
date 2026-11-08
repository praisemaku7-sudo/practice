// Import engine: reads every selected file at the same time, on-device first,
// and only calls Claude when the on-device read can't be verified against the balances.
import { state, recompute, relinkTransfers, ownerOf } from '../state.js';
import { db } from '../lib/db.js';
import { parseCSVStatement } from '../lib/parse/csv.js';
import { parseStatementLines } from '../lib/parse/statementText.js';
import { linesToPageTexts, detectAccountRef, reconcile } from '../lib/parse/layout.js';
import { toTransactions, dedupe, guessBank } from '../lib/importer.js';
import { aiReadStatementText, aiReadStatementImages } from '../lib/ai.js';
import { prettyDate, monthKey, daysBetween } from '../lib/dates.js';
import { merchantKey } from '../lib/categorize.js';
import { overlapReport, fileHash } from '../lib/coverage.js';
import { matchIncoming } from '../lib/duplicates.js';
import { looksLikeCreditText, isCardIssuer } from '../lib/credit.js';
import { isSummaryLine } from '../lib/parse/junk.js';
import { classifyDocument } from '../lib/parse/doctype.js';
import { parsePayslip } from '../lib/payslip.js';
import { saveSettings } from '../state.js';

/** The live import queue, shown by the Import page. */
export const queue = { items: [], summary: null };
let notify = () => {};
export function onQueueChange(fn) { notify = fn; }
const changed = () => notify();

const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
const pdfLib = () => import('../lib/parse/pdf.js');

function guessType(text) {
  if (/credit card|card statement/i.test(text) || looksLikeCreditText(text)) return 'credit';
  return /\bsaver\b|savings|\bisa\b/i.test(text) ? 'savings' : 'current';
}

function applyTrackFrom(parsed) {
  // Summary-box lines (new balance, purchase rate, minimum payment...) are never transactions.
  const junk = parsed.transactions.filter((t) => isSummaryLine(t.description));
  if (junk.length) {
    parsed = { ...parsed, transactions: parsed.transactions.filter((t) => !isSummaryLine(t.description)), warnings: [`Ignored ${junk.length} statement summary line${junk.length > 1 ? 's' : ''} (balances, rates, minimum payment).`, ...(parsed.warnings || [])] };
    if (/credit|purchase rate|minimum/i.test(junk.map((t) => t.description).join(' '))) parsed.accountType = 'credit';
  }
  const from = state.settings.trackFrom;
  if (!from) return parsed;
  const kept = parsed.transactions.filter((t) => t.date >= from);
  const dropped = parsed.transactions.length - kept.length;
  if (!dropped) return parsed;
  return { ...parsed, transactions: kept, warnings: [`${dropped} transaction${dropped > 1 ? 's' : ''} before ${prettyDate(from)} ${from.slice(0, 4)} skipped (tracking start).`, ...(parsed.warnings || [])] };
}

async function readPdf(item, buf) {
  const { extractPdfLines, renderPageImages } = await pdfLib();
  let password;
  let res;
  try { res = await extractPdfLines(buf); } catch (e) {
    if (e?.name !== 'PasswordException') throw e;
    password = window.prompt(`${item.name} is password protected. Enter the PDF password:`) || undefined;
    if (!password) throw new Error('Password needed to open this PDF.');
    res = await extractPdfLines(buf, { password });
  }
  const pageTexts = res.hasText ? linesToPageTexts(res.lines) : [];
  const text = pageTexts.join('\n');
  const bank = guessBank(text);
  const meta = { headText: text.slice(0, 3000), bank, accountType: isCardIssuer(bank) && !/current account/i.test(text) ? 'credit' : guessType(text), accountRef: detectAccountRef(text) };
  const { apiKey, model, pdfMode } = state.settings;
  const canAI = apiKey && pdfMode !== 'never';

  if (res.hasText && pdfMode !== 'always') {
    const local = parseStatementLines(res.lines);
    const check = reconcile(local);
    if (check.confident || !canAI) {
      return { ...meta, ...local, method: 'on-device', verified: check.confident, check };
    }
  }
  if (!canAI) {
    return { ...meta, transactions: [], warnings: ['This looks like a scanned PDF with no text. Add a Claude API key in Settings to read it, or import a CSV instead.'], method: 'on-device', verified: false };
  }
  item.status = 'ai';
  item.aiReason = !res.hasText ? "it's a scanned PDF" : pdfMode === 'always' ? 'you chose to always check with Claude' : "the balances didn't add up on your phone";
  changed();
  const onProgress = (done, total) => { item.progress = { done, total }; changed(); };
  const r = res.hasText
    ? await aiReadStatementText({ apiKey, model, pageTexts, onProgress })
    : await aiReadStatementImages({ apiKey, model, images: await renderPageImages(buf, { password }), onProgress });
  const check = reconcile({ transactions: r.transactions, closingBalance: r.closingBalance });
  return { ...meta, ...r, bank: r.bank || meta.bank, accountRef: r.accountRef || meta.accountRef, method: 'Claude', verified: check.confident, check };
}

const isCsv = (f) => /\.(csv|txt)$/i.test(f.name) || /csv|comma-separated|text\/plain/.test(f.type);

async function readFile(item) {
  if (!isPdf(item.file) && !isCsv(item.file)) throw new Error('Not a PDF or CSV statement, so it was skipped.');
  const buf = await item.file.arrayBuffer();
  try { item.hash = await fileHash(buf); } catch { item.hash = null; }
  const prior = item.hash && state.imports.find((i) => i.fileHash === item.hash);
  if (prior) item.prior = prior;
  if (!isPdf(item.file)) {
    const text = new TextDecoder().decode(buf);
    const r = parseCSVStatement(text);
    const head = item.name + ' ' + text.slice(0, 600);
    const bank = guessBank(head);
    const cardRows = r.transactions.filter((t) => /PAYMENT RECEIVED|THANK YOU|INTEREST CHARGED|MINIMUM PAYMENT/i.test(t.description)).length;
    const type = isCardIssuer(head) || (cardRows && isCardIssuer(bank)) ? 'credit' : guessType(head);
    return { ...r, headText: head, bank, accountType: type, accountRef: detectAccountRef(head), method: 'CSV', verified: reconcile(r).confident };
  }
  return readPdf(item, buf);
}

export function defaultName(p) {
  const base = p.accountName || [p.bank, p.accountType === 'credit' ? 'Card' : p.accountType === 'savings' ? 'Savings' : 'Current'].filter(Boolean).join(' ') || 'Current';
  // Two cards from the same bank need different names: add the last 4 digits.
  return p.accountRef && !base.includes(p.accountRef) ? `${base} ••${p.accountRef}` : base;
}

/** Can this statement belong to this account? Never if both have different account numbers. */
const refOk = (a, p) => !p.accountRef || !a.ref || a.ref === p.accountRef;

function matchAccount(p) {
  const bank = (p.bank || '').toLowerCase();
  const type = p.accountType || 'current';
  const name = defaultName(p).toLowerCase();
  if (p.accountRef) {
    const exact = state.accounts.find((a) => a.ref === p.accountRef);
    if (exact) return exact;
  }
  // Same bank + type only when it's unambiguous (one candidate, no conflicting account number):
  // otherwise a second card from the same bank would be filed inside the first.
  const sameBank = state.accounts.filter((a) => bank && (a.bank || '').toLowerCase() === bank && a.type === type && refOk(a, p));
  if (sameBank.length === 1 && (!p.accountRef || !sameBank[0].ref)) return sameBank[0];
  return state.accounts.find((a) => a.name.toLowerCase() === name && a.type === type && refOk(a, p)) || null;
}

/** Whose statement is it? Looks for a household member's name in the file name or statement header. */
function guessOwner(item, p) {
  const hay = ` ${item.name} ${p.headText || ''} `.toUpperCase().replace(/[^A-Z]+/g, ' ');
  const people = state.settings.people.filter((x) => x.name && x.name !== 'Me');
  const words = (n) => n.toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter((w) => w.length >= 3);
  // Only words unique to one person count (a shared surname says nothing about whose it is).
  const all = people.flatMap((x) => words(x.name));
  const unique = (w) => all.filter((v) => v === w).length === 1;
  const scored = people.map((x) => ({ id: x.id, score: words(x.name).filter((w) => unique(w) && hay.includes(` ${w} `)).length })).filter((x) => x.score > 0);
  return scored.length === 1 ? scored[0].id : state.settings.people[0]?.id;
}

async function processItem(item) {
  item.status = 'reading';
  changed();
  const t0 = performance.now();
  try {
    const parsed = applyTrackFrom(await readFile(item));
    item.parsed = parsed;
    // Not a statement (payslip, receipt, invoice, bill...)? Say so and don't import it by default.
    item.doc = parsed.documentType && parsed.isStatement === false
      ? { isStatement: false, kind: parsed.documentType, reason: `Claude says this is a ${parsed.documentType}, not a bank or card statement.` }
      : parsed.headText ? classifyDocument(parsed.headText, parsed) : { isStatement: true };
    item.ms = Math.round(performance.now() - t0);
    const withMerchant = parsed.transactions.map((t) => ({ ...t, merchant: merchantKey(t.description) }));
    item.overlap = overlapReport(withMerchant, state.txs);
    const ovAcc = item.overlap.matchedAccountId && state.accounts.find((a) => a.id === item.overlap.matchedAccountId);
    const match = ovAcc || matchAccount(parsed);
    item.accountChoice = match ? match.id : '__new';
    item.newAccount = { name: defaultName(parsed), bank: parsed.bank || '', type: parsed.accountType || 'current', owner: guessOwner(item, parsed) };
    item.include = parsed.transactions.length > 0 && !item.prior && !item.overlap.likelyDuplicate && item.doc.isStatement;
    // A payslip: offer to use its take-home pay as that person's monthly income.
    if (item.doc.kind === 'payslip' || (!parsed.transactions.length && parsed.headText)) {
      const slip = parsePayslip(parsed.headText);
      if (slip) { item.payslip = { ...slip, owner: guessOwner(item, parsed) }; item.include = false; }
    }
    item.status = 'ready';
  } catch (e) {
    console.error(e);
    item.status = 'error';
    item.error = e.message || String(e);
  }
  changed();
}

/** Run up to N reads at once; PDFs read on-device take well under a second each. */
let draining = false;
async function drain() {
  if (draining) return; // running workers pick up newly added files
  draining = true;
  const waiting = () => queue.items.filter((i) => i.status === 'queued');
  const run = async () => { let next; while ((next = waiting()[0])) { next.status = 'reading'; await processItem(next); } };
  try { await Promise.all([run(), run(), run()]); } finally { draining = false; }
}

export function addFiles(files) {
  if (!files.length) return;
  if (queue.items.length && queue.items.every((i) => ['imported', 'skipped', 'error'].includes(i.status) || (i.status === 'ready' && !i.include))) {
    queue.items = []; // previous batch finished: start fresh
  }
  queue.summary = null;
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  for (const file of sorted) {
    queue.items.push({ id: Math.random().toString(36).slice(2), file, name: file.name, status: 'queued', progress: null, flip: false, showPreview: false });
  }
  if (!location.hash.startsWith('#/import')) location.hash = '#/import';
  changed();
  drain();
}

export function pickFiles() {
  pdfLib(); // start loading the PDF engine while the picker is open
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = '.pdf,.csv,application/pdf,text/csv,text/comma-separated-values';
  input.onchange = () => addFiles([...input.files]);
  input.click();
}

export async function commitItem(item) {
  const p = item.parsed;
  let account;
  if (item.accountChoice === '__new') {
    const n = item.newAccount;
    // Several months of a brand-new account in one batch all land in the same account.
    account = (p.accountRef && state.accounts.find((a) => a.ref === p.accountRef))
      || state.accounts.find((a) => a.name.toLowerCase() === n.name.toLowerCase() && a.type === n.type && refOk(a, p));
    if (!account) {
      account = { id: 'acc-' + (crypto.randomUUID?.() || Date.now().toString(36)), name: n.name || 'Account', bank: n.bank, type: n.type, owner: n.owner, balance: null, balanceDate: null };
      state.accounts.push(account);
    }
  } else account = state.accounts.find((a) => a.id === item.accountChoice);
  if (p.accountRef && !account.ref) account.ref = p.accountRef;

  const importId = 'imp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const rows = item.flip ? p.transactions.map((r) => ({ ...r, amount: -r.amount })) : p.transactions;
  let replacedOld = 0;
  if (item.replace && rows.length) {
    // Re-import: throw away what was saved for this account over this statement's dates
    // (e.g. an earlier bad read), then save the new read.
    const ds = rows.map((r) => r.date).sort();
    const from = ds[0], to = ds[ds.length - 1];
    const old = state.txs.filter((t) => t.accountId === account.id && !t.manual && t.date >= from && t.date <= to);
    for (const t of old) await db.del('tx', t.id);
    const oldIds = new Set(old.map((t) => t.id));
    state.txs = state.txs.filter((t) => !oldIds.has(t.id));
    replacedOld = old.length;
    for (const i of state.imports.filter((x) => item.hash && x.fileHash === item.hash)) { await db.del('imports', i.id); }
    state.imports = state.imports.filter((x) => !(item.hash && x.fileHash === item.hash));
  }
  const txs = toTransactions(rows, { accountId: account.id, importId, source: p.method, userRules: state.settings.userRules });
  const exact = dedupe(txs, new Set(state.txs.map((t) => t.id)));
  // Also skip payments already saved on this account with a slightly different date or wording.
  const { matches } = matchIncoming(exact.fresh, state.txs, { sameAccountId: account.id });
  const fresh = exact.fresh.filter((_, i) => !matches.has(i));
  const dupes = [...exact.dupes, ...exact.fresh.filter((_, i) => matches.has(i))];
  // Replace "I bought it" manual entries now that the real transaction has arrived.
  const replaced = [];
  for (const t of fresh) {
    const m = state.txs.find((x) => x.manual && !replaced.includes(x) && x.amount === t.amount && Math.abs(daysBetween(x.date, t.date)) <= 5);
    if (m) { replaced.push(m); t.category = m.category; }
  }
  for (const m of replaced) await db.del('tx', m.id);
  state.txs = state.txs.filter((t) => !replaced.includes(t)).concat(fresh);

  const dates = rows.map((r) => r.date).sort();
  const lastDate = dates[dates.length - 1];
  const closing = p.closingBalance ?? [...rows].reverse().find((r) => r.balance != null)?.balance ?? null;
  if (closing != null && lastDate && (!account.balanceDate || lastDate >= account.balanceDate)) {
    account.balance = account.type === 'credit' ? -Math.abs(closing) : closing;
    account.balanceDate = lastDate;
  }
  account.lastImport = state.derived.today;
  let periodStart = dates[0], periodEnd = lastDate;
  const ps = p.period?.start, pe = p.period?.end;
  if (ps && periodStart && ps < periodStart && daysBetween(ps, periodStart) <= 35) periodStart = ps;
  if (pe && periodEnd && pe > periodEnd && daysBetween(periodEnd, pe) <= 35) periodEnd = pe;
  await db.put('accounts', account);
  await db.putMany('tx', fresh);
  const rec = { id: importId, fileName: item.name, fileHash: item.hash, accountId: account.id, at: Date.now(), count: fresh.length, dupes: dupes.length, method: p.method, periodStart, periodEnd };
  state.imports.push(rec);
  await db.put('imports', rec);
  item.status = 'imported';
  item.result = { added: fresh.length, dupes: dupes.length, account: account.name, replaced: replacedOld };
  return { added: fresh.length, lastDate };
}

export async function commitAll() {
  const ready = queue.items.filter((i) => i.status === 'ready' && i.include);
  let added = 0, latest = '';
  for (const item of ready) {
    const r = await commitItem(item);
    added += r.added;
    if (r.lastDate > latest) latest = r.lastDate;
  }
  // Only mark as skipped once nothing is still being read (you may import in several goes).
  if (!busyCount()) for (const i of queue.items) if (i.status === 'ready' && !i.include) i.status = 'skipped';
  await relinkTransfers();
  recompute();
  if (latest) state.month = monthKey(latest);
  const prev = queue.summary || { added: 0, files: 0 };
  queue.summary = { added: prev.added + added, files: prev.files + ready.length };
  changed();
}

/** Read failed files again. */
export function retryFailed(id) {
  for (const i of queue.items) if (i.status === 'error' && (!id || i.id === id) && !/Not a PDF or CSV/.test(i.error || '')) { i.status = 'queued'; i.error = null; i.progress = null; }
  changed();
  drain();
}

/** Tick every already-imported file for re-import, replacing what was saved before. */
export function reimportAllDuplicates() {
  for (const i of queue.items) if (i.status === 'ready' && i.parsed?.transactions.length && (i.prior || i.overlap?.likelyDuplicate)) { i.include = true; i.replace = true; }
  changed();
}

/** Use a payslip's take-home pay as a person's monthly income (household income = everyone's together). */
export async function applyPayslip(item) {
  const slip = item.payslip;
  const pid = slip.owner || state.settings.people[0].id;
  const scoped = { ...(state.settings.scoped || {}) };
  scoped[pid] = { ...(scoped[pid] || {}), income: slip.monthlyNet };
  const payslips = { ...(state.settings.payslips || {}), [pid]: { net: slip.net, monthlyNet: slip.monthlyNet, frequency: slip.frequency, payDate: slip.payDate, employer: slip.employer, file: item.name, at: Date.now() } };
  const patch = { scoped, payslips };
  if (state.settings.people.length === 1) patch.income = slip.monthlyNet;
  await saveSettings(patch);
  item.status = 'imported';
  item.result = { added: 0, dupes: 0, account: 'income', payslip: true };
  changed();
}

export function clearQueue() { queue.items = []; queue.summary = null; changed(); }

export const busyCount = () => queue.items.filter((i) => ['queued', 'reading', 'ai'].includes(i.status)).length;
