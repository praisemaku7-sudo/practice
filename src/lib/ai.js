// Claude API calls, made directly from the phone with the user's own API key.
// Used for: reading any bank's PDF layout, reading prices from photos/screenshots,
// and writing the monthly coaching report. Every feature also works without it.
import Anthropic from '@anthropic-ai/sdk';
import { CATEGORIES } from './categories.js';
import { chunkPages } from './parse/layout.js';

import { MODELS, DEFAULT_MODEL } from './models.js';
export { MODELS, DEFAULT_MODEL };
const CAT_IDS = CATEGORIES.map((c) => c.id);

function client(apiKey) {
  if (!apiKey) throw new Error('Add your Claude API key in Settings to use AI features.');
  // The key never leaves this device except to api.anthropic.com.
  // Generous retries: the SDK waits for the API's retry-after on rate limits (429) and overloads (529).
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 6 });
}

/**
 * One structured request. Uses server-side refusal fallbacks where the model supports them,
 * and retries once without that beta if the account/model rejects it.
 */
// At most 3 Claude requests in flight across ALL files, so a big batch doesn't hit the account's
// rate limit (new API accounts have low per-minute limits).
const MAX_IN_FLIGHT = 3;
let inFlight = 0;
const waiting = [];
async function limited(fn) {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise((r) => waiting.push(r));
  inFlight += 1;
  try { return await fn(); } finally { inFlight -= 1; waiting.shift()?.(); }
}

function structured(args) { return limited(() => structuredNow(args)); }

async function structuredNow({ apiKey, model = DEFAULT_MODEL, system, content, schema, maxTokens = 16000, effort }) {
  const c = client(apiKey);
  const base = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content }],
    output_config: { format: { type: 'json_schema', schema }, ...(effort ? { effort } : {}) },
  };
  const supportsFallback = model === 'claude-opus-5-5' || model === 'claude-sonnet-5-5';
  let msg;
  try {
    msg = supportsFallback
      ? await c.beta.messages.stream({ ...base, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }).finalMessage()
      : await c.messages.stream(base).finalMessage();
  } catch (err) {
    if (supportsFallback && err instanceof Anthropic.BadRequestError && /fallback/i.test(err.message)) {
      msg = await c.messages.stream(base).finalMessage();
    } else {
      throw friendlyError(err);
    }
  }
  if (msg.stop_reason === 'refusal') throw new Error('Claude declined this request. Try the on-device option instead.');
  if (msg.stop_reason === 'max_tokens') throw new Error('The response was cut off (statement too long). Try splitting the PDF.');
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try { return JSON.parse(text); } catch { throw new Error('Claude returned an unreadable response. Please try again.'); }
}

function friendlyError(err) {
  if (err instanceof Anthropic.AuthenticationError) return new Error('Your Claude API key was rejected. Check it in Settings.');
  if (err instanceof Anthropic.RateLimitError) return new Error('Your Claude account hit its per-minute limit. Wait a minute, then tap Retry. (Limits rise automatically as your account is used.)');
  if (err instanceof Anthropic.APIError && err.status === 529) return new Error('Claude is busy right now. Tap Retry in a minute.');
  if (err instanceof Anthropic.APIError && err.status === 400 && /credit balance/i.test(err.message)) return new Error('Your Claude API credit has run out. Add credit (and turn on auto-reload) at console.anthropic.com → Settings → Billing, then tap Retry. Statements whose balances add up are still read on your phone for free.');
  if (err instanceof Anthropic.APIConnectionError) return new Error("Couldn't reach the Claude API. Are you online?");
  if (err instanceof Anthropic.APIError) return new Error(`Claude API error: ${err.message}`);
  return err;
}

// Compact schema: short keys mean fewer output tokens, and output tokens are what make extraction slow.
const CHUNK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_statement', 'document_type', 'bank', 'account_name', 'account_holder', 'account_type', 'account_last4', 'period_start', 'period_end', 'opening_balance', 'closing_balance', 'tx'],
  properties: {
    is_statement: { type: 'boolean', description: 'true only for a bank, card or savings account statement or banking app screen. false for investment, ISA platform, share dealing and pension statements or apps (Quilter, Hargreaves Lansdown, Vanguard, pensions...)' },
    document_type: { type: 'string', description: 'e.g. bank statement, credit card statement, investment statement, pension statement, payslip, receipt, invoice, bill' },
    bank: { type: ['string', 'null'] },
    account_name: { type: ['string', 'null'], description: 'product name, e.g. FlexDirect, Club M Saver, Platinum Card. Never a person\'s name' },
    account_holder: { type: ['string', 'null'], description: 'name of the account holder printed on the statement' },
    opening_balance: { type: ['number', 'null'], description: 'balance at the start of the period (for cards: amount owed, positive)' },
    account_type: { type: 'string', enum: ['current', 'savings', 'credit'] },
    account_last4: { type: ['string', 'null'], description: 'Last 4 digits of account or card number' },
    period_start: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
    period_end: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
    closing_balance: { type: ['number', 'null'], description: 'balance at the end of the period (for cards: amount owed, positive)' },
    tx: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['d', 't', 'a', 'b', 'h'],
        properties: {
          d: { type: 'string', description: 'date YYYY-MM-DD' },
          t: { type: 'string', description: 'description, as printed' },
          a: { type: 'number', description: 'GBP; negative = money out, positive = money in' },
          b: { type: ['number', 'null'], description: 'running balance if printed on that row' },
          h: { type: ['string', 'null'], description: 'cardholder name if the statement groups spending by cardholder (e.g. supplementary cards), else null' },
        },
      },
    },
  },
};

const STATEMENT_SYSTEM = 'You extract transactions from UK bank and credit-card statements with perfect accuracy. Include every transaction row in the excerpt exactly once, in order. Only include real transaction rows. Never include summary-box lines: new/previous/statement balance, brought/carried forward, credit limit, available credit, interest-rate or APR tables (e.g. "Standard purchase rate"), estimated interest, minimum payment, amount due, "you have incurred…" warnings, or totals. Do include interest charged, fees and charges when they appear as rows in the transaction list. Merge multi-line descriptions into one. For credit cards, purchases are negative and payments to the card are positive. Use the statement period to give every date a year. If a header field is not in this excerpt, use null.';

/** Run async tasks with a concurrency limit. */
async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); }
  });
  await Promise.all(workers);
  return results;
}

function mergeChunks(results) {
  const first = (k) => results.map((r) => r[k]).find((v) => v != null && v !== '');
  const p = (n) => (n == null ? null : Math.round(n * 100));
  const closing = [...results].reverse().map((r) => r.closing_balance).find((v) => v != null);
  const txs = results.flatMap((r) => r.tx)
    .filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.d) && t.a)
    .map((t) => ({ date: t.d, description: t.t, amount: p(t.a), balance: p(t.b), ...(t.h ? { cardholder: t.h } : {}) }));
  return {
    isStatement: results.some((r) => r.is_statement !== false),
    documentType: results.map((r) => r.document_type).find(Boolean) || null,
    bank: first('bank'), accountName: first('account_name'), holder: first('account_holder'),
    openingBalance: p(results.map((r) => r.opening_balance).find((v) => v != null) ?? null), accountType: first('account_type') || 'current',
    accountRef: first('account_last4')?.slice(-4) || null,
    closingBalance: p(closing ?? null),
    period: { start: first('period_start'), end: [...results].reverse().map((r) => r.period_end).find(Boolean) || null },
    transactions: txs,
    warnings: [],
  };
}

/**
 * Read a statement from its extracted text, splitting pages into chunks that are read in parallel.
 * Each chunk also gets the first lines of page 1 so it knows the bank and statement period.
 */
export async function aiReadStatementText({ apiKey, model, pageTexts, onProgress }) {
  const chunks = chunkPages(pageTexts);
  const header = pageTexts[0].split('\n').slice(0, 25).join('\n');
  let done = 0;
  onProgress?.(0, chunks.length);
  const results = await pool(chunks, 4, async (c) => {
    const r = await structured({
      apiKey, model, effort: 'low', maxTokens: 32000,
      system: STATEMENT_SYSTEM,
      content: [{ type: 'text', text: `Statement header (page 1, for context only):\n${header}\n\nExtract the transactions from pages ${c.from}-${c.to} of ${pageTexts.length}:\n\n${c.text}` }],
      schema: CHUNK_SCHEMA,
    });
    onProgress?.(++done, chunks.length);
    return r;
  });
  return mergeChunks(results);
}

/** Scanned statement: send page images, two pages per request, in parallel. */
export async function aiReadStatementImages({ apiKey, model, images, onProgress, screenshot = false, today = new Date().toISOString().slice(0, 10) }) {
  const chunks = [];
  for (let i = 0; i < images.length; i += 2) chunks.push({ from: i + 1, imgs: images.slice(i, i + 2) });
  let done = 0;
  onProgress?.(0, chunks.length);
  const results = await pool(chunks, 4, async (c) => {
    const r = await structured({
      apiKey, model, effort: 'low', maxTokens: 32000,
      system: STATEMENT_SYSTEM,
      content: [
        ...c.imgs.map((data) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } })),
        { type: 'text', text: screenshot
          ? `This is a screenshot from a UK banking or card app (Monzo, Starling, Revolut, Chase, Barclays, HSBC, Lloyds, Halifax, NatWest, Santander, Nationwide, Amex, Barclaycard, Capital One, Aqua, Virgin Money or any other), taken on ${today}. Extract every completed transaction visible, in order (resolve "Today"/"Yesterday"/weekday labels and dates without a year to real dates on or before ${today}). Skip pending, declined, reverted and scheduled/upcoming payments, and skip pots/spaces moves only if they are shown as internal. Money out is negative, money in positive; for a credit card, purchases are negative and payments to the card positive. closing_balance: the account's actual balance (for a credit card, the current balance owed as a positive number). Never use "available", "available credit", "available to spend", "spending money", the credit limit, an overdraft limit or a pot total as the balance; if only those are visible, use null. Read the bank, account name and last 4 digits if shown. If only a balance is visible, return an empty tx list with the balance. Set is_statement true for any bank/card app screen.`
          : `These are pages ${c.from}-${c.from + c.imgs.length - 1} of ${images.length} of a bank statement. Extract the transactions.` },
      ],
      schema: CHUNK_SCHEMA,
    });
    onProgress?.(++done, chunks.length);
    return r;
  });
  return mergeChunks(results);
}

/** Read the item and price from a product photo or screenshot. */
export async function aiReadPrice({ apiKey, model, imageBase64, mediaType }) {
  const r = await structured({
    apiKey, model, effort: 'low', maxTokens: 4000,
    system: 'You read product listings, price tags, receipts and shopping screenshots. Report the total price the person would pay in GBP (convert if needed and say so in notes).',
    content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
      { type: 'text', text: 'What is this item, and what does it cost?' },
    ],
    schema: {
      type: 'object', additionalProperties: false,
      required: ['item', 'price_gbp', 'category', 'confidence', 'notes'],
      properties: {
        item: { type: 'string' },
        price_gbp: { type: ['number', 'null'] },
        category: { type: 'string', enum: CAT_IDS },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        notes: { type: 'string' },
      },
    },
  });
  return { item: r.item, price: r.price_gbp == null ? null : Math.round(r.price_gbp * 100), category: r.category, confidence: r.confidence, notes: r.notes };
}

/** Monthly coaching report from aggregated numbers (no raw transaction list is sent). */
export async function aiMonthlyReport({ apiKey, model, summary }) {
  return structured({
    apiKey, model, effort: 'medium', maxTokens: 16000,
    system: 'You are a blunt, practical UK personal-finance coach. Use the numbers given; never invent figures. Prefer specific, actionable steps with £ amounts. UK context: ISAs, Current Account Switch Service, energy/broadband/mobile switching, council tax bands, cashback, haggling at contract end.',
    content: [{ type: 'text', text: `Here is my month in numbers (GBP). Give me my monthly review and plan for next month.\n\n${JSON.stringify(summary, null, 1)}` }],
    schema: {
      type: 'object', additionalProperties: false,
      required: ['headline', 'what_changed', 'wins', 'concerns', 'actions', 'next_month_focus'],
      properties: {
        headline: { type: 'string' },
        what_changed: { type: 'array', items: { type: 'string' } },
        wins: { type: 'array', items: { type: 'string' } },
        concerns: { type: 'array', items: { type: 'string' } },
        actions: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false, required: ['title', 'detail', 'monthly_saving_gbp'],
            properties: { title: { type: 'string' }, detail: { type: 'string' }, monthly_saving_gbp: { type: 'number' } },
          },
        },
        next_month_focus: { type: 'string' },
      },
    },
  });
}

/** Cheap call to validate a key. */
export async function testKey(apiKey, model = DEFAULT_MODEL) {
  const c = client(apiKey);
  try {
    await c.messages.create({ model, max_tokens: 16, messages: [{ role: 'user', content: 'Reply with OK.' }], output_config: { effort: 'low' } });
    return true;
  } catch (e) { throw friendlyError(e); }
}

/**
 * Categorise merchants, searching the web for ones Claude doesn't recognise (small local shops,
 * company names on statements). Only merchant names, an example statement line, money in/out and a
 * typical amount are sent. Returns [{merchant, category, business, confidence}].
 */
export async function aiCategorizeMerchants({ apiKey, model = DEFAULT_MODEL, merchants, current = {} }) {
  return limited(async () => {
    const c = client(apiKey);
    const cats = CATEGORIES.filter((x) => x.id !== 'transfer' && x.id !== 'excluded').map((x) => `${x.id} (${x.name})`).join(', ');
    const save = {
      name: 'save_categories',
      description: 'Save the category for every merchant in the list. Call this exactly once, at the end, with one entry per merchant.',
      strict: true,
      input_schema: {
        type: 'object', additionalProperties: false, required: ['results'],
        properties: { results: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['merchant', 'category', 'business', 'confidence'],
          properties: {
            merchant: { type: 'string', description: 'exactly as given' },
            category: { type: 'string', enum: CAT_IDS.filter((id) => id !== 'transfer' && id !== 'excluded') },
            business: { type: 'string', description: 'what the business is, in a few words, e.g. "Butcher in Anytown" or "Energy supplier"' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          } } } },
      },
    };
    const list = merchants.map((m, i) => `${i + 1}. ${m.merchant} | statement: "${m.sample}" | ${m.direction} | typical £${m.typical} | ${m.count}×${current[m.merchant] ? ` | currently: ${current[m.merchant]}` : ''}`).join('\n');
    const messages = [{ role: 'user', content: `These are merchants from a UK household's bank statements. For each, decide the best spending category from: ${cats}.\n\nUse web search only for names you don't recognise (local shops, limited companies, abbreviations). Card-reader prefixes like SQ *, SUMUP *, ZETTLE_, PAYPAL * hide the real shop name after them. Rent paid to letting agents is housing; energy, water, council tax, phone and broadband are bills; supermarkets and food shops are groceries. If "currently" is given, say whether it is right by returning the correct category.\n\n${list}\n\nWhen you're done, call save_categories once with every merchant.` }];
    for (let turn = 0; turn < 6; turn++) {
      let msg;
      try {
        msg = await c.messages.stream({
          model, max_tokens: 16000, output_config: { effort: 'medium' }, messages,
          tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 10, user_location: { type: 'approximate', country: 'GB' } }, save],
        }).finalMessage();
      } catch (err) { throw friendlyError(err); }
      if (msg.stop_reason === 'refusal') throw new Error('Claude declined this request.');
      const call = msg.content.find((b) => b.type === 'tool_use' && b.name === 'save_categories');
      if (call) return Array.isArray(call.input?.results) ? call.input.results : [];
      messages.push({ role: 'assistant', content: msg.content });
      // A long search pauses the turn: send it back unchanged and the server carries on.
      if (msg.stop_reason === 'pause_turn') continue;
      messages.push({ role: 'user', content: 'Please call save_categories now with every merchant.' });
    }
    throw new Error("Claude didn't return the categories. Try again with fewer merchants.");
  });
}

/** Read a mortgage in principle from page images (scans/photos) or text. Only figures come back. */
export async function aiReadMIP({ apiKey, model, text = null, images = [], mediaType = 'image/jpeg' }) {
  const { MIP_SCHEMA, fromAI } = await import('./mip.js');
  const r = await structured({
    apiKey, model, effort: 'low', maxTokens: 4000,
    system: 'You read UK mortgage in principle / agreement in principle / decision in principle documents. Report only the figures asked for. Use null when a value is not in the document. Never include names or addresses.',
    content: [...images.map((data) => ({ type: 'image', source: { type: 'base64', media_type: mediaType, data } })), { type: 'text', text: text ? `Document text:\n${text.slice(0, 20000)}` : 'Read this document.' }],
    schema: MIP_SCHEMA,
  });
  return fromAI(r);
}

/** Read a full mortgage application form: figures and yes/no answers only. */
export async function aiReadApplication({ apiKey, model, text = null, images = [], mediaType = 'image/jpeg' }) {
  const { APP_SCHEMA, fromAppAI } = await import('./mortgageApp.js');
  const r = await structured({
    apiKey, model, effort: 'low', maxTokens: 8000,
    system: 'You read UK mortgage application forms. Report only the figures and yes/no answers asked for, per applicant in form order. For radio buttons, the filled dot marks the chosen answer. Use null when a value is not in the document. Never include names, addresses, dates of birth, phone numbers, emails or reference numbers.',
    content: [...images.map((data) => ({ type: 'image', source: { type: 'base64', media_type: mediaType, data } })), { type: 'text', text: text ? `Document text:\n${text.slice(0, 40000)}` : 'Read this mortgage application.' }],
    schema: APP_SCHEMA,
  });
  return fromAppAI(r);
}

/** Answer a question about your money from aggregated numbers only (no raw transactions). */
export async function aiAsk({ apiKey, model, question, context }) {
  return structured({
    apiKey, model, effort: 'medium', maxTokens: 6000,
    system: 'You are a practical UK personal-finance helper for a couple. Answer using only the numbers given; never invent figures or website addresses. Be specific and kind but direct. Give short numbered steps with £ amounts where possible. If debt is unmanageable, mention free help from StepChange, MoneyHelper or National Debtline. Not regulated financial advice: for mortgages, pensions or investments, suggest a qualified adviser.',
    content: [{ type: 'text', text: `My numbers (GBP):\n${JSON.stringify(context, null, 1)}\n\nQuestion: ${question}` }],
    schema: {
      type: 'object', additionalProperties: false, required: ['answer', 'steps'],
      properties: { answer: { type: 'string' }, steps: { type: 'array', items: { type: 'string' } } },
    },
  });
}
