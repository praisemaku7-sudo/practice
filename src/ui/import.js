// Import engine: reads every selected file at the same time, on-device first,
// and only calls Claude when the on-device read can't be verified against the balances.
import { state, recompute, relinkTransfers, ownerOf } from '../state.js';
import { db } from '../lib/db.js';
import { toast } from './dom.js';
import { parseTextStatement, decodeText } from '../lib/parse/formats.js';
import { parseStatementLines } from '../lib/parse/statementText.js';
import { linesToPageTexts, detectAccountRef, reconcile } from '../lib/parse/layout.js';
import { toTransactions, dedupe, guessBank } from '../lib/importer.js';
// The Claude library loads only when a file actually needs it.
const ai = () => import('../lib/ai.js');
const aiReadStatementImages = async (...a) => (await ai()).aiReadStatementImages(...a);

/** Reads by Claude are cached by file fingerprint: the same file never costs or waits twice. */
async function cachedAI(hash, run) {
  if (hash) { const hit = await db.kvGet(`ai:${hash}`, null); if (hit) return { ...hit, cached: true }; }
  const r = await run();
  if (hash && r?.transactions) await db.kvSet(`ai:${hash}`, r);
  return r;
}
import { prettyDate, monthKey, daysBetween, parseDate } from '../lib/dates.js';
import { merchantKey } from '../lib/categorize.js';
import { overlapReport, fileHash } from '../lib/coverage.js';
import { matchIncoming } from '../lib/duplicates.js';
import { looksLikeCreditText, isCardIssuer } from '../lib/credit.js';
import { cardSummaryFields, applyCardSummary } from '../lib/parse/cardSummary.js';
import { printedTotals, validateStatement } from '../lib/validate.js';
import { isSummaryLine } from '../lib/parse/junk.js';
import { classifyDocument, isInvestmentDocument } from '../lib/parse/doctype.js';
import { isCreditReport, parseCreditReport } from '../lib/creditreport.js';
import { typicalPay, parsePayslip } from '../lib/payslip.js';
import { parseSA302, isSA302 } from '../lib/sa302.js';
import { extractDetails, suggestAccountName, canonicalBank } from '../lib/parse/details.js';
import { personForName } from '../state.js';
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
  // Only the statement's header says what the account is: a "Round up to Chase Saver" row doesn't.
  const lines = String(text).split('\n');
  const tableAt = lines.findIndex((l) => /\bdate\b/i.test(l) && /\b(balance|amount|paid|money|in|out)\b/i.test(l));
  const head = (tableAt > 0 ? lines.slice(0, tableAt) : lines.slice(0, 12)).join('\n');
  if (/current account|personal account|everyday|classic|flex|club lloyds|joint account|select account/i.test(head)) return 'current';
  return /\bsaver\b|savings|\bisa\b|easy access|fixed rate bond/i.test(head) ? 'savings' : 'current';
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
  // Bank from the statement header (cross-checked with the sort code), product, holder, last 4 digits.
  const details = extractDetails(text, item.name);
  const bank = details.bank || guessBank(text);
  const meta = { headText: text.slice(0, 3000), details, bank, accountType: isCardIssuer(bank) && !/current account|e-money account/i.test(text) && looksLikeCreditText(text) ? 'credit' : guessType(text), accountRef: details.last4 || detectAccountRef(text) };
  const { apiKey, model, pdfMode } = state.settings;
  const printed = res.hasText ? printedTotals(text) : { in: [], out: [] };
  // Credit reports (Checkmyfile, ClearScore…): read on the phone for the credit-health check.
  if (res.hasText && isCreditReport(text.slice(0, 20000))) {
    return { ...meta, headText: '', creditReport: parseCreditReport(text), transactions: [], closingBalance: null, warnings: [], method: 'on-device', verified: false, isStatement: false, documentType: 'credit report' };
  }
  // Investment and pension statements (Quilter, Hargreaves Lansdown, pensions…) are never bank accounts:
  // recognised on the phone and skipped, without spending Claude credit.
  if (res.hasText && isInvestmentDocument(text.slice(0, 20000))) {
    return { ...meta, headText: text.slice(0, 3000), accountType: 'investment', transactions: [], closingBalance: null, warnings: [], method: 'on-device', verified: false, isStatement: false, documentType: 'investment' };
  }
  // Tax calculations and payslips are read on the phone; they never need Claude.
  if (res.hasText && (isSA302(text, item.name) || /payslip|pay slip/i.test(item.name) || classifyDocument(text, { transactions: [] }).kind === 'payslip')) {
    return { ...meta, transactions: [], warnings: [], method: 'on-device', verified: false };
  }
  const canAI = apiKey && pdfMode !== 'never';

  if (res.hasText && pdfMode !== 'always') {
    const local = parseStatementLines(res.lines);
    const check = reconcile(local);
    if (check.confident || !canAI) {
      return { ...meta, ...local, printed, method: 'on-device', verified: check.confident, check };
    }
  }
  if (!canAI) {
    return { ...meta, transactions: [], warnings: ['This looks like a scanned PDF with no text. Add a Claude API key in Settings to read it, or import a CSV instead.'], method: 'on-device', verified: false };
  }
  item.status = 'ai';
  item.aiReason = !res.hasText ? "it's a scanned PDF" : pdfMode === 'always' ? 'you chose to always check with Claude' : "the balances didn't add up on your phone";
  changed();
  const onProgress = (done, total) => { item.progress = { done, total }; changed(); };
  const r = await cachedAI(item.hash, async () => (res.hasText
    ? (await ai()).aiReadStatementText({ apiKey, model, pageTexts, onProgress })
    : (await ai()).aiReadStatementImages({ apiKey, model, images: await renderPageImages(buf, { password }), onProgress })));
  // Check Claude's read against the statement's own opening/closing balances (cards report what's owed).
  const card = (meta.accountType || r.accountType) === 'credit';
  const asBal = (v) => (v == null ? null : card ? -Math.abs(v) : v);
  let check = reconcile({ transactions: r.transactions, openingBalance: asBal(r.openingBalance), closingBalance: asBal(r.closingBalance) });
  // The card's own balance summary (read on the phone) proves the balance and supplies interest/fees
  // that Claude may have skipped because they aren't listed as transactions.
  let balanceProven = false;
  const box = card && res.hasText ? cardSummaryFields(text) : null;
  if (box) {
    const fixed = applyCardSummary({ transactions: r.transactions, period: r.period }, box);
    r.transactions = fixed.transactions; r.openingBalance = fixed.openingBalance; r.closingBalance = fixed.closingBalance;
    check = reconcile(fixed);
    balanceProven = true;
  }
  const mergedDetails = { ...meta.details, holder: meta.details?.holder || r.holder || null };
  return { ...meta, ...r, details: mergedDetails, bank: meta.bank || r.bank, accountType: meta.accountType === 'credit' || r.accountType === 'credit' ? 'credit' : (r.accountType || meta.accountType),
    accountRef: meta.accountRef || r.accountRef, method: 'Claude', verified: check.confident, balanceProven, check, printed };
}

const isCsv = (f) => /\.(csv|txt|tsv|ofx|qfx|qif)$/i.test(f.name) || /csv|comma-separated|text\/plain|ofx|qif/.test(f.type);
const isSpreadsheet = (f) => /\.(xlsx?|numbers|ods)$/i.test(f.name) || /spreadsheet|excel/.test(f.type);

const isImage = (f) => /^image\//.test(f.type) || /\.(png|jpe?g|heic|webp)$/i.test(f.name);

/** A screenshot of a banking app: Claude reads its transactions and/or balance. */
async function readScreenshot(item) {
  const { apiKey, model } = state.settings;
  if (!apiKey) throw new Error('Reading screenshots needs Claude. Add your API key (and credit) in Settings.');
  const { imageForUpload } = await import('./dom.js');
  const img = await imageForUpload(item.file);
  item.status = 'ai'; item.aiReason = "it's a screenshot"; changed();
  const r = await aiReadStatementImages({ apiKey, model, images: [img.base64], screenshot: true, today: state.derived.today });
  return { ...r, headText: '', method: 'Claude (screenshot)', verified: false, screenshot: true };
}

/** The picked file's contents, copied when it was picked. */
async function fileBytes(item) {
  try { return await (item.bytes || item.file.arrayBuffer()); } catch (e) {
    item.bytes = null;
    throw new Error(/NotReadable|NotFound|I\/O/i.test(`${e?.name} ${e?.message}`)
      ? "Couldn't open this file. If it's in iCloud Drive, open it once in the Files app so it downloads to the phone, then import it again."
      : `Couldn't open this file (${e?.message || e}). Try choosing it again.`);
  }
}

async function readFile(item) {
  if (isImage(item.file)) {
    const buf = await fileBytes(item);
    item.file = new File([buf], item.name, { type: item.file.type || 'image/jpeg' });
    return readScreenshot(item);
  }
  if (isSpreadsheet(item.file)) {
    if (!/\.xlsx$/i.test(item.name)) throw new Error('Only .xlsx spreadsheets can be read. Save it as .xlsx (Excel), or for a bank statement download CSV or PDF instead.');
    const { readXlsx } = await import('../lib/xlsx.js');
    const { extractPlan, hasPlan } = await import('../lib/plan.js');
    const plan = extractPlan(await readXlsx(await fileBytes(item)));
    if (!hasPlan(plan)) throw new Error('This spreadsheet has no budget, debts or action plan the app recognises. Bank statements: download CSV or PDF instead.');
    return { plan, headText: '', transactions: [], closingBalance: null, warnings: [], method: 'spreadsheet', verified: false, isStatement: false, documentType: 'plan' };
  }
  if (!isPdf(item.file) && !isCsv(item.file)) throw new Error('Not a statement, CSV, OFX/QIF or screenshot, so it was skipped.');
  const buf = await fileBytes(item);
  try { item.hash = await fileHash(buf); } catch { item.hash = null; }
  const prior = item.hash && state.imports.find((i) => i.fileHash === item.hash);
  if (prior) item.prior = prior;
  if (!isPdf(item.file)) {
    const text = decodeText(buf);
    let r = parseTextStatement(text, item.name);
    const { apiKey, model } = state.settings;
    // A layout none of the readers know: let Claude read the text, then check it adds up.
    if (!r.transactions.length && apiKey && text.trim().length > 40) {
      item.status = 'ai'; item.aiReason = 'the file layout isn\'t one the phone knows'; changed();
      const pageTexts = text.match(/[\s\S]{1,12000}(?:\n|$)/g) || [text];
      const read = await cachedAI(item.hash, async () => (await ai()).aiReadStatementText({ apiKey, model, pageTexts, onProgress: (done, total) => { item.progress = { done, total }; changed(); } }));
      r = { ...read, format: 'Claude' };
    }
    const head = item.name + ' ' + text.slice(0, 600);
    const details = extractDetails(text.slice(0, 3000), item.name);
    const bank = details.bank || guessBank(head);
    const cardRows = r.transactions.filter((t) => /PAYMENT RECEIVED|THANK YOU|INTEREST CHARGED|MINIMUM PAYMENT/i.test(t.description)).length;
    const type = isCardIssuer(head) || (cardRows && isCardIssuer(bank)) ? 'credit' : guessType(head);
    return { ...r, headText: head, details, bank, accountType: r.accountType || type, accountRef: details.last4 || r.accountRef || detectAccountRef(head), method: r.format || 'CSV', verified: reconcile(r).confident };
  }
  return readPdf(item, buf);
}

const looksLikePerson = (name, holder) => !!name && (/^(mr|mrs|ms|miss|dr|mx)\b/i.test(name.trim())
  || (holder && holder.split(/\s+/).slice(-1)[0].length > 2 && name.toLowerCase().includes(holder.split(/\s+/).slice(-1)[0].toLowerCase())));

export function defaultName(p) {
  if (looksLikePerson(p.accountName, p.details?.holder)) p = { ...p, accountName: null };
  const suggested = (p.details || p.bank) && suggestAccountName({ ...(p.details || {}), bank: p.details?.bank || p.bank, last4: p.details?.last4 || p.accountRef }, p.accountType);
  if (suggested) return suggested;
  const base = p.accountName || [p.bank, p.accountType === 'credit' ? 'Card' : p.accountType === 'savings' ? 'Savings' : 'Current'].filter(Boolean).join(' ') || 'Current';
  // Two cards from the same bank need different names: add the last 4 digits.
  return p.accountRef && !base.includes(p.accountRef) ? `${base} ••${p.accountRef}` : base;
}

/**
 * Learn names from statements: if you're still called "Me", take the holder's name; if a holder is
 * clearly one of you under another name (e.g. "Jane Smith" for Jane Doe), remember it.
 */
async function learnHolder(holder) {
  if (!holder) return;
  const clean = holder.replace(/^(mr|mrs|ms|miss|dr|mx)\.?\s+/i, '').trim();
  if (clean.split(/\s+/).length < 2) return;
  const people = state.settings.people;
  const pid = personForName(clean);
  if (pid) {
    const p = people.find((x) => x.id === pid);
    const known = [p.name, ...(p.aliases || [])].map((n) => n.toUpperCase());
    if (!known.includes(clean.toUpperCase())) await saveSettings({ people: people.map((x) => (x.id === pid ? { ...x, aliases: [...(x.aliases || []), clean] } : x)) });
  } else if (people[0]?.name === 'Me') {
    await saveSettings({ people: people.map((x, i) => (i === 0 ? { ...x, name: clean } : x)) });
  }
}

/** Can this statement belong to this account? Never if both have different account numbers. */
const refOk = (a, p) => !p.accountRef || !a.ref || a.ref === p.accountRef;

/** Accounts you deleted and asked not to be recreated: same bank and number, or same name. */
export function isBlockedAccount({ name, bank, ref }) {
  const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return (state.settings.blockedAccounts || []).some((b) => (ref && b.ref && b.ref === ref && (!b.bank || !bank || norm(b.bank) === norm(bank))) || (name && norm(b.name) === norm(name)));
}

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
  // The account holder printed on the statement is the best evidence.
  const byHolder = personForName(p.details?.holder);
  if (byHolder) return byHolder;
  // Otherwise a person's FIRST name in the file name or header (e.g. "Sarah - Monzo.csv").
  const hay = ` ${item.name} ${p.headText || ''} `.toUpperCase().replace(/[^A-Z]+/g, ' ');
  const firsts = state.settings.people.filter((x) => x.name && x.name !== 'Me').map((x) => ({ id: x.id, first: x.name.toUpperCase().replace(/[^A-Z ]/g, ' ').trim().split(/\s+/)[0] })).filter((x) => x.first.length >= 3);
  const hits = firsts.filter((x) => hay.includes(` ${x.first} `));
  return hits.length === 1 ? hits[0].id : state.settings.people[0]?.id;
}

async function processItem(item) {
  item.status = 'reading';
  changed();
  const t0 = performance.now();
  try {
    const parsed = applyTrackFrom(await readFile(item));
    parsed.bank = canonicalBank(parsed.bank);
    if (parsed.details) parsed.details = { ...parsed.details, bank: canonicalBank(parsed.details.bank) };
    // Card companies only issue credit cards.
    if (isCardIssuer(parsed.bank || '') && parsed.accountType !== 'savings') parsed.accountType = 'credit';
    item.parsed = parsed;
    // Not a statement (payslip, receipt, invoice, bill...)? Say so and don't import it by default.
    const investDoc = parsed.documentType === 'investment' || /invest|pension|portfolio|stocks|shares|fund|valuation/i.test(parsed.documentType || '') && !/cash isa|savings|bank|current|credit card/i.test(parsed.documentType || '') || (parsed.headText && isInvestmentDocument(parsed.headText));
    item.doc = investDoc
      ? { isStatement: false, kind: 'investment', reason: (parsed.headText && classifyDocument(parsed.headText).kind === 'investment' ? classifyDocument(parsed.headText).reason : "This is an investment or pension statement. It isn't a bank account, so it's not counted in your spending, income or balances.") }
      : parsed.documentType && parsed.isStatement === false
        ? { isStatement: false, kind: parsed.documentType, reason: `Claude says this is a ${parsed.documentType}, not a bank or card statement.` }
        : parsed.headText ? classifyDocument(parsed.headText, parsed) : { isStatement: true };
    item.ms = Math.round(performance.now() - t0);
    const withMerchant = parsed.transactions.map((t) => ({ ...t, merchant: merchantKey(t.description) }));
    item.overlap = overlapReport(withMerchant, state.txs);
    // Where does it go? Card/account number and bank first. An account that merely holds the same
    // payments is only used if its bank fits: otherwise an earlier misfiled import would repeat forever.
    const ovAccRaw = item.overlap.matchedAccountId && state.accounts.find((a) => a.id === item.overlap.matchedAccountId);
    const bankOf = (a) => (canonicalBank(a.details?.bank || a.bank) || '').toLowerCase();
    const pBank = (canonicalBank(parsed.bank) || '').toLowerCase();
    const typeFits = (a) => !parsed.accountType || a.type === parsed.accountType;
    const ovAcc = ovAccRaw && (!pBank || !bankOf(ovAccRaw) || bankOf(ovAccRaw) === pBank) && refOk(ovAccRaw, parsed) && typeFits(ovAccRaw) ? ovAccRaw : null;
    item.misfiledIn = ovAccRaw && !ovAcc ? ovAccRaw : null;
    const byDetails = parsed.accountRef && state.accounts.find((a) => (a.details?.last4 === parsed.accountRef || a.ref === parsed.accountRef) && (!pBank || !bankOf(a) || bankOf(a) === pBank) && typeFits(a));
    const match = byDetails || ovAcc || matchAccount(parsed);
    item.accountChoice = match ? match.id : '__new';
    item.newAccount = { name: defaultName(parsed), bank: parsed.bank || '', type: parsed.accountType || 'current', owner: guessOwner(item, parsed) };
    // An account you removed as not real (e.g. an investment statement read as savings) isn't recreated.
    if (!match && isBlockedAccount({ name: item.newAccount.name, bank: parsed.bank, ref: parsed.accountRef })) { item.blockedAccount = true; item.include = false; }
    const seenBefore = !!item.prior || item.overlap.likelyDuplicate;
    // Seen before (maybe misfiled or read badly the first time): replace the old copy by default.
    // A read that the statement's own balances prove also replaces whatever is saved for that
    // account over its dates: it's the truth, and older reads may have had money in/out swapped.
    const ds = parsed.transactions.map((t) => t.date).sort();
    const holdsPeriod = match && ds.length && state.txs.some((t) => t.accountId === match.id && !t.manual && t.date >= ds[0] && t.date <= ds[ds.length - 1]);
    item.replace = parsed.transactions.length > 0 && (seenBefore || (parsed.verified && holdsPeriod));
    item.replaceAuto = item.replace;
    item.include = parsed.transactions.length > 0 && item.doc.isStatement;
    // A balance-only screenshot is still worth importing: it updates the account's balance.
    if (parsed.screenshot && !parsed.transactions.length && parsed.closingBalance != null && item.doc.isStatement) item.include = true;
    // An HMRC SA302 tax calculation (self-employed income): offer it as that person's usual income.
    const sa = parsed.headText != null && parseSA302(parsed.headText, item.name);
    if (sa) { item.sa302 = { ...sa, owner: guessOwner(item, parsed) }; item.include = false; item.doc = { isStatement: false, kind: 'sa302' }; }
    else if (isSA302(parsed.headText || '', item.name)) {
      // Recognised as an SA302 but the figures couldn't be read: let you type them.
      item.sa302Manual = { owner: guessOwner(item, parsed), taxYear: (item.name.match(/20\d\d/) || [])[0] || '' };
      item.include = false; item.doc = { isStatement: false, kind: 'sa302' };
    }
    if (parsed.creditReport) {
      item.creditReport = { ...parsed.creditReport, owner: guessOwner(item, { details: { holder: parsed.creditReport.person }, headText: '' }) };
      item.include = false; item.doc = { isStatement: false, kind: 'credit report' };
    }
    if (parsed.plan) { item.plan = parsed.plan; item.include = false; item.doc = { isStatement: false, kind: 'plan' }; }
    // A payslip: offer to use its take-home pay as that person's monthly income.
    if (!item.sa302 && !item.creditReport && !item.plan && (item.doc.kind === 'payslip' || (!parsed.transactions.length && parsed.headText))) {
      const slip = parsePayslip(parsed.headText);
      if (slip) { item.payslip = { ...slip, owner: guessOwner(item, parsed) }; item.include = false; }
      else if (item.doc.kind === 'payslip' || /payslip|pay slip/i.test(item.name)) {
        item.payslipManual = { owner: guessOwner(item, parsed) };
        item.include = false;
      }
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

/** "applepay|date|merchant|amount|card" lines written by the iPhone Shortcut (no server needed). */
export function parseApplePayLog(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.trim().split('|');
    if (m[0]?.toLowerCase() !== 'applepay' || m.length < 4) continue;
    const [, when, merchant, amount, card = ''] = m;
    const w = when.trim();
    const date = w.match(/\d{4}-\d{2}-\d{2}/)?.[0] || parseDate(w.replace(/,/g, ' ').replace(/\s+at\s+.*$/i, ''), new Date().getFullYear());
    if (date && amount) rows.push({ date, merchant: merchant.trim() || 'Apple Pay', amount: amount.trim(), card: card.trim() });
  }
  return rows;
}

async function importApplePayLog(file) {
  const rows = parseApplePayLog(await file.text());
  const { logPurchase } = await import('./views/add.js');
  let n = 0;
  for (const r of rows) {
    const id = [r.date, r.merchant, r.amount, r.card].join('|').toLowerCase().replace(/[^a-z0-9|.-]/g, '');
    if (await logPurchase({ ...r, id })) n++;
  }
  recompute();
  toast(n ? `${n} Apple Pay purchase${n === 1 ? '' : 's'} added (${rows.length - n} already logged)` : rows.length ? 'Nothing new in the Apple Pay log' : 'No Apple Pay lines found in that file', { error: !rows.length });
  return n;
}

export async function addFiles(files) {
  if (!files.length) return;
  // The Apple Pay log isn't a statement: log its purchases straight away.
  const rest = [];
  for (const f of [...files]) {
    if (/\.(txt|log)$/i.test(f.name) || /apple ?pay/i.test(f.name)) {
      const head = await f.slice(0, 200).text().catch(() => '');
      if (/^\s*applepay\|/im.test(head)) { await importApplePayLog(f); continue; }
    }
    rest.push(f);
  }
  files = rest;
  if (!files.length) { changed(); return; }
  if (queue.items.length && queue.items.every((i) => ['imported', 'skipped', 'error'].includes(i.status) || (i.status === 'ready' && !i.include))) {
    queue.items = []; // previous batch finished: start fresh
  }
  queue.summary = null;
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  for (const file of sorted) {
    // Copy the file's contents straight away: on iPhone the picked file can stop being readable
    // later (it's a temporary copy, sometimes still downloading from iCloud).
    const bytes = file.arrayBuffer();
    bytes.catch(() => {}); // handled when the file is read
    queue.items.push({ id: Math.random().toString(36).slice(2), file, bytes, name: file.name, status: 'queued', progress: null, flip: false, showPreview: false });
  }
  if (!location.hash.startsWith('#/import')) location.hash = '#/import';
  changed();
  drain();
}

// Kept in the page (not just in memory) while the picker is open: iOS can throw away a detached
// input before you've chosen, and then the files never arrive.
let picker = null;
export function pickFiles() {
  pdfLib(); // start loading the PDF engine while the picker is open
  picker?.remove();
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  // iPhones and iPads only understand common file types here; unusual ones (.ofx, .qif) can grey
  // out every file or stop the picker opening. Any file can be chosen there and is checked on import.
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!ios) input.accept = '.pdf,.csv,.txt,.tsv,.ofx,.qfx,.qif,application/pdf,text/csv,text/plain,text/comma-separated-values,image/*';
  input.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;opacity:0';
  // Left in the page until the next import: removing it can make the chosen files unreadable on iPhone.
  input.addEventListener('change', () => {
    const files = [...(input.files || [])];
    if (files.length) addFiles(files);
  });
  document.body.appendChild(input);
  picker = input;
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
      account = { id: 'acc-' + (crypto.randomUUID?.() || Date.now().toString(36)), name: n.name || 'Account', bank: n.bank, type: n.type, owner: n.owner, balance: null, balanceDate: null, autoName: n.name === defaultName(p) };
      state.accounts.push(account);
    }
  } else account = state.accounts.find((a) => a.id === item.accountChoice);
  // The statement's own card/account number is the truth for the account you chose (fixes refs read wrongly before).
  if (p.accountRef && account.ref !== p.accountRef && (p.details?.last4 || !account.ref)) account.ref = p.accountRef;
  if (p.details) {
    // Keep what the statement says about the account (only the last 4 digits of the number).
    const d = p.details;
    account.details = { ...(account.details || {}), ...Object.fromEntries(Object.entries({ bank: d.bank, bankFromSort: d.bankFromSort, sortCode: d.sortCode, last4: d.last4 || p.accountRef, holder: d.holder, postcode: d.postcode, product: d.product }).filter(([, v]) => v)) };
    const sameBank = !account.bank || canonicalBank(account.bank) === canonicalBank(d.bank || p.bank);
    if ((d.bank || p.bank) && sameBank) account.bank = canonicalBank(d.bank || p.bank);
    if (isCardIssuer(account.bank || '') && !account.typeLocked) account.type = 'credit';
    const suggested = sameBank ? suggestAccountName({ ...account.details, bank: account.bank }, account.type) : null;
    // Names the app made up itself are corrected; names you typed are kept (Fix accounts suggests instead).
    // Generic names like "Nationwide Card" or "American Express Card ••0476" were made up by the app, so they're corrected too.
    const generic = /^[A-Za-z&' -]+ (Card|Current|Savings)( ••\d{4})?$/.test(account.name) || /^Current( ••\d{4})?$/.test(account.name);
    if (suggested && account.name !== suggested && (account.autoName || generic || (item.accountChoice === '__new' && item.newAccount?.name === account.name))) { account.name = suggested; account.autoName = true; }
  }
  await learnHolder(p.details?.holder);
  // Whose account is it? The holder named on the statement decides, unless you've locked the account yourself.
  const holderOwner = personForName(p.details?.holder);
  if (holderOwner && !account.typeLocked) account.owner = holderOwner;
  else if (!account.owner && item.newAccount?.owner && item.newAccount.owner !== state.settings.people[0]?.id) account.owner = item.newAccount.owner;

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
  // The same payments saved in a DIFFERENT account (an earlier misfiled import) are removed from there.
  if (item.replace || item.misfiledIn) {
    const { matches } = matchIncoming(txs, state.txs.filter((t) => t.accountId !== account.id));
    const stray = [...matches.values()];
    for (const t of stray) await db.del('tx', t.id);
    const strayIds = new Set(stray.map((t) => t.id));
    state.txs = state.txs.filter((t) => !strayIds.has(t.id));
    item.movedFrom = stray.length;
  }
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
  const lastDate = dates[dates.length - 1] || (p.screenshot ? state.derived.today : undefined);
  const closing = p.closingBalance ?? [...rows].reverse().find((r) => r.balance != null)?.balance ?? null;
  // A screenshot shows the balance right now; a statement shows it on its last day.
  // (Statement balances are as of the statement date, which can be a few days after the last purchase.)
  const pEnd = p.period?.end && lastDate && p.period.end > lastDate && daysBetween(lastDate, p.period.end) <= 35 && p.period.end <= state.derived.today ? p.period.end : lastDate;
  const balDate = p.screenshot ? state.derived.today : pEnd;
  // Only save a balance that's proven (it agrees with the statement's own opening balance and
  // transactions, or you took a screenshot of it). Otherwise keep the old one and flag it.
  const trusted = p.verified || p.screenshot || p.balanceProven;
  if (closing != null && balDate && (!account.balanceDate || balDate >= account.balanceDate)) {
    if (trusted) {
      account.balance = account.type === 'credit' ? -Math.abs(closing) : closing;
      account.balanceDate = balDate;
      delete account.balanceUnverified;
    } else {
      account.balanceUnverified = { amount: account.type === 'credit' ? -Math.abs(closing) : closing, date: balDate, file: item.name };
    }
  }
  account.lastImport = state.derived.today;
  let periodStart = dates[0], periodEnd = lastDate;
  const ps = p.period?.start, pe = p.period?.end;
  if (ps && periodStart && ps < periodStart && daysBetween(ps, periodStart) <= 35) periodStart = ps;
  if (pe && periodEnd && pe > periodEnd && daysBetween(periodEnd, pe) <= 35) periodEnd = pe;
  await db.put('accounts', account);
  await db.putMany('tx', fresh);
  const v = validateStatement({ ...p, accountType: account.type });
  const rec = { id: importId, fileName: item.name, fileHash: item.hash, accountId: account.id, at: Date.now(), count: fresh.length, dupes: dupes.length, method: p.method, periodStart, periodEnd, validation: { level: v.level, summary: v.summary, checks: v.checks } };
  state.imports.push(rec);
  await db.put('imports', rec);
  item.status = 'imported';
  item.result = { added: fresh.length, dupes: dupes.length, account: account.name, replaced: replacedOld, moved: item.movedFrom || 0 };
  // A re-read of a statement you'd already imported replaces it: count only what's actually new.
  return { added: Math.max(0, fresh.length - replacedOld), refreshed: Math.min(fresh.length, replacedOld), lastDate };
}

export async function commitAll() {
  const ready = queue.items.filter((i) => i.status === 'ready' && i.include);
  let added = 0, refreshed = 0, latest = '';
  for (const item of ready) {
    const r = await commitItem(item);
    added += r.added; refreshed += r.refreshed || 0;
    if (r.lastDate > latest) latest = r.lastDate;
  }
  // Only mark as skipped once nothing is still being read (you may import in several goes).
  if (!busyCount()) for (const i of queue.items) if (i.status === 'ready' && !i.include) i.status = 'skipped';
  await relinkTransfers();
  recompute();
  if (latest) state.month = monthKey(latest);
  const prev = queue.summary || { added: 0, files: 0, refreshed: 0 };
  queue.summary = { added: prev.added + added, refreshed: (prev.refreshed || 0) + refreshed, files: prev.files + ready.length };
  changed();
}

/** Read failed files again. */
export function retryFailed(id) {
  for (const i of queue.items) if (i.status === 'error' && (!id || i.id === id) && !/Not a (PDF or CSV|statement)|Spreadsheet files/.test(i.error || '')) { i.status = 'queued'; i.error = null; i.progress = null; }
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
  // Keep every payslip (one per pay date) and use the typical recent take-home, so a one-off
  // month (a correction, back pay, a part month) or the order you import them in doesn't skew it.
  const history = { ...(state.settings.payslipHistory || {}) };
  const entry = { payDate: slip.payDate, net: slip.net, gross: slip.gross || null, monthlyNet: slip.monthlyNet, frequency: slip.frequency, employer: slip.employer, file: item.name };
  const list = [...(history[pid] || []).filter((x) => !(x.payDate && x.payDate === entry.payDate)), entry]
    .sort((a, b) => String(b.payDate).localeCompare(String(a.payDate))).slice(0, 12);
  history[pid] = list;
  const typ = typicalPay(list);
  const scoped = { ...(state.settings.scoped || {}) };
  scoped[pid] = { ...(scoped[pid] || {}), income: typ.monthly };
  const latest = typ.latest || entry;
  const payslips = { ...(state.settings.payslips || {}), [pid]: { ...latest, monthlyNet: typ.monthly, count: list.length, usedDates: typ.used.map((x) => x.payDate), oneOffs: typ.oneOffs.map((x) => x.payDate), at: Date.now() } };
  const patch = { scoped, payslips, payslipHistory: history };
  if (state.settings.people.length === 1) patch.income = typ.monthly;
  await saveSettings(patch);
  item.status = 'imported';
  item.result = { added: 0, dupes: 0, account: 'income', payslip: true };
  changed();
}

/** Use an SA302's take-home (income − tax & NI) as a person's usual monthly income; newest tax year wins. */
export async function applySA302(item) {
  const sa = item.sa302;
  const pid = sa.owner || state.settings.people[0].id;
  const list = [...((state.settings.sa302s || {})[pid] || []).filter((x) => x.taxYear !== sa.taxYear), { taxYear: sa.taxYear, totalIncome: sa.totalIncome, taxDue: sa.taxDue, net: sa.net, file: item.name }]
    .sort((a, b) => String(a.taxYear).localeCompare(String(b.taxYear)));
  const latest = list[list.length - 1];
  const scoped = { ...(state.settings.scoped || {}) };
  scoped[pid] = { ...(scoped[pid] || {}), income: Math.round(latest.net / 12) };
  const patch = { scoped, sa302s: { ...(state.settings.sa302s || {}), [pid]: list } };
  if (state.settings.people.length === 1) patch.income = Math.round(latest.net / 12);
  await saveSettings(patch);
  item.status = 'imported';
  item.result = { added: 0, dupes: 0, account: 'income', sa302: true };
  changed();
}

/** Accounts with no transactions left (e.g. after misfiled payments were moved out). */
export function emptyAccounts() {
  const used = new Set((state.allTxs || state.txs).map((t) => t.accountId));
  for (const t of state.txs) used.add(t.accountId);
  return state.accounts.filter((a) => !used.has(a.id) && !(state.settings.bankSync?.links && Object.values(state.settings.bankSync.links).includes(a.id)));
}

export async function removeEmptyAccounts() {
  const gone = emptyAccounts();
  for (const a of gone) await db.del('accounts', a.id);
  const ids = new Set(gone.map((a) => a.id));
  state.accounts = state.accounts.filter((a) => !ids.has(a.id));
  state.allAccounts = (state.allAccounts || []).filter((a) => !ids.has(a.id));
  recompute();
  changed();
  return gone.length;
}

export function clearQueue() { queue.items = []; queue.summary = null; changed(); }

export const busyCount = () => queue.items.filter((i) => ['queued', 'reading', 'ai'].includes(i.status)).length;
