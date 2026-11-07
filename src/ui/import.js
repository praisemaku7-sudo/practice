// Import engine: reads every selected file at the same time, on-device first,
// and only calls Claude when the on-device read can't be verified against the balances.
import { state, recompute, relinkTransfers } from '../state.js';
import { db } from '../lib/db.js';
import { parseCSVStatement } from '../lib/parse/csv.js';
import { parseStatementLines } from '../lib/parse/statementText.js';
import { linesToPageTexts, detectAccountRef, reconcile } from '../lib/parse/layout.js';
import { toTransactions, dedupe, guessBank } from '../lib/importer.js';
import { aiReadStatementText, aiReadStatementImages } from '../lib/ai.js';
import { prettyDate, monthKey, daysBetween } from '../lib/dates.js';
import { merchantKey } from '../lib/categorize.js';
import { overlapReport, fileHash } from '../lib/coverage.js';

/** The live import queue, shown by the Import page. */
export const queue = { items: [], summary: null };
let notify = () => {};
export function onQueueChange(fn) { notify = fn; }
const changed = () => notify();

const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
const pdfLib = () => import('../lib/parse/pdf.js');

function guessType(text) {
  return /credit card|card statement|minimum payment|credit limit/i.test(text) ? 'credit' : /\bsaver\b|savings|\bisa\b/i.test(text) ? 'savings' : 'current';
}

function applyTrackFrom(parsed) {
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
  const meta = { bank: guessBank(text), accountType: guessType(text), accountRef: detectAccountRef(text) };
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
  changed();
  const onProgress = (done, total) => { item.progress = { done, total }; changed(); };
  const r = res.hasText
    ? await aiReadStatementText({ apiKey, model, pageTexts, onProgress })
    : await aiReadStatementImages({ apiKey, model, images: await renderPageImages(buf, { password }), onProgress });
  const check = reconcile({ transactions: r.transactions, closingBalance: r.closingBalance });
  return { ...meta, ...r, bank: r.bank || meta.bank, accountRef: r.accountRef || meta.accountRef, method: 'Claude', verified: check.confident, check };
}

async function readFile(item) {
  const buf = await item.file.arrayBuffer();
  try { item.hash = await fileHash(buf); } catch { item.hash = null; }
  const prior = item.hash && state.imports.find((i) => i.fileHash === item.hash);
  if (prior) item.prior = prior;
  if (!isPdf(item.file)) {
    const text = new TextDecoder().decode(buf);
    const r = parseCSVStatement(text);
    const head = item.name + ' ' + text.slice(0, 600);
    return { ...r, bank: guessBank(head), accountType: guessType(head), accountRef: detectAccountRef(head), method: 'CSV', verified: reconcile(r).confident };
  }
  return readPdf(item, buf);
}

export function defaultName(p) {
  return p.accountName || [p.bank, p.accountType === 'credit' ? 'Card' : p.accountType === 'savings' ? 'Savings' : 'Current'].filter(Boolean).join(' ') || 'Current';
}

function matchAccount(p) {
  const bank = (p.bank || '').toLowerCase();
  const type = p.accountType || 'current';
  const name = defaultName(p).toLowerCase();
  return (p.accountRef && state.accounts.find((a) => a.ref === p.accountRef))
    || state.accounts.find((a) => bank && (a.bank || '').toLowerCase() === bank && a.type === type)
    || state.accounts.find((a) => a.name.toLowerCase() === name && a.type === type)
    || null;
}

async function processItem(item) {
  item.status = 'reading';
  changed();
  const t0 = performance.now();
  try {
    const parsed = applyTrackFrom(await readFile(item));
    item.parsed = parsed;
    item.ms = Math.round(performance.now() - t0);
    const withMerchant = parsed.transactions.map((t) => ({ ...t, merchant: merchantKey(t.description) }));
    item.overlap = overlapReport(withMerchant, state.txs);
    const ovAcc = item.overlap.matchedAccountId && state.accounts.find((a) => a.id === item.overlap.matchedAccountId);
    const match = ovAcc || matchAccount(parsed);
    item.accountChoice = match ? match.id : '__new';
    item.newAccount = { name: defaultName(parsed), bank: parsed.bank || '', type: parsed.accountType || 'current' };
    item.include = parsed.transactions.length > 0 && !item.prior && !item.overlap.likelyDuplicate;
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

async function commitItem(item) {
  const p = item.parsed;
  let account;
  if (item.accountChoice === '__new') {
    const n = item.newAccount;
    // Several months of a brand-new account in one batch all land in the same account.
    account = state.accounts.find((a) => a.name.toLowerCase() === n.name.toLowerCase() && a.type === n.type)
      || (p.accountRef && state.accounts.find((a) => a.ref === p.accountRef));
    if (!account) {
      account = { id: 'acc-' + (crypto.randomUUID?.() || Date.now().toString(36)), name: n.name || 'Account', bank: n.bank, type: n.type, balance: null, balanceDate: null };
      state.accounts.push(account);
    }
  } else account = state.accounts.find((a) => a.id === item.accountChoice);
  if (p.accountRef && !account.ref) account.ref = p.accountRef;

  const importId = 'imp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const rows = item.flip ? p.transactions.map((r) => ({ ...r, amount: -r.amount })) : p.transactions;
  const txs = toTransactions(rows, { accountId: account.id, importId, source: p.method, userRules: state.settings.userRules });
  const { fresh, dupes } = dedupe(txs, new Set(state.txs.map((t) => t.id)));
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
  item.result = { added: fresh.length, dupes: dupes.length, account: account.name };
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
  for (const i of queue.items) if (i.status === 'ready' && !i.include) i.status = 'skipped';
  await relinkTransfers();
  recompute();
  if (latest) state.month = monthKey(latest);
  queue.summary = { added, files: ready.length };
  changed();
}

export function clearQueue() { queue.items = []; queue.summary = null; changed(); }

export const busyCount = () => queue.items.filter((i) => ['queued', 'reading', 'ai'].includes(i.status)).length;
