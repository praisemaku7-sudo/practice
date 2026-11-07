// Claude API calls, made directly from the phone with the user's own API key.
// Used for: reading any bank's PDF layout, reading prices from photos/screenshots,
// and writing the monthly coaching report. Every feature also works without it.
import Anthropic from '@anthropic-ai/sdk';
import { CATEGORIES } from './categories.js';
import { chunkPages } from './parse/layout.js';

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (most accurate)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (faster, half the cost)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fastest, cheapest)' },
];
export const DEFAULT_MODEL = 'claude-opus-5-5';
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
  if (err instanceof Anthropic.APIError && err.status === 400 && /credit balance/i.test(err.message)) return new Error('Your Claude API credit has run out. Top up at console.anthropic.com, then tap Retry.');
  if (err instanceof Anthropic.APIConnectionError) return new Error("Couldn't reach the Claude API. Are you online?");
  if (err instanceof Anthropic.APIError) return new Error(`Claude API error: ${err.message}`);
  return err;
}

// Compact schema: short keys mean fewer output tokens, and output tokens are what make extraction slow.
const CHUNK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['bank', 'account_name', 'account_type', 'account_last4', 'period_start', 'period_end', 'closing_balance', 'tx'],
  properties: {
    bank: { type: ['string', 'null'] },
    account_name: { type: ['string', 'null'] },
    account_type: { type: 'string', enum: ['current', 'savings', 'credit'] },
    account_last4: { type: ['string', 'null'], description: 'Last 4 digits of account or card number' },
    period_start: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
    period_end: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
    closing_balance: { type: ['number', 'null'] },
    tx: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['d', 't', 'a', 'b'],
        properties: {
          d: { type: 'string', description: 'date YYYY-MM-DD' },
          t: { type: 'string', description: 'description, as printed' },
          a: { type: 'number', description: 'GBP; negative = money out, positive = money in' },
          b: { type: ['number', 'null'], description: 'running balance if printed on that row' },
        },
      },
    },
  },
};

const STATEMENT_SYSTEM = 'You extract transactions from UK bank and credit-card statements with perfect accuracy. Include every transaction row in the excerpt exactly once, in order. Only include real transaction rows. Never include summary-box lines: new/previous/statement balance, brought/carried forward, credit limit, available credit, interest-rate or APR tables (e.g. "Standard purchase rate"), estimated interest, minimum payment, amount due, "you have incurred…" warnings, or totals. Merge multi-line descriptions into one. For credit cards, purchases are negative and payments to the card are positive. Use the statement period to give every date a year. If a header field is not in this excerpt, use null.';

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
    .map((t) => ({ date: t.d, description: t.t, amount: p(t.a), balance: p(t.b) }));
  return {
    bank: first('bank'), accountName: first('account_name'), accountType: first('account_type') || 'current',
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
export async function aiReadStatementImages({ apiKey, model, images, onProgress }) {
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
        { type: 'text', text: `These are pages ${c.from}-${c.from + c.imgs.length - 1} of ${images.length} of a bank statement. Extract the transactions.` },
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
