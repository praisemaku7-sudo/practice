// Claude API calls, made directly from the phone with the user's own API key.
// Used for: reading any bank's PDF layout, reading prices from photos/screenshots,
// and writing the monthly coaching report. Every feature also works without it.
import Anthropic from '@anthropic-ai/sdk';
import { CATEGORIES } from './categories.js';

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (cheaper)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (cheapest)' },
];
export const DEFAULT_MODEL = 'claude-opus-5-5';
const CAT_IDS = CATEGORIES.map((c) => c.id);

function client(apiKey) {
  if (!apiKey) throw new Error('Add your Claude API key in Settings to use AI features.');
  // The key never leaves this device except to api.anthropic.com.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
}

/**
 * One structured request. Uses server-side refusal fallbacks where the model supports them,
 * and retries once without that beta if the account/model rejects it.
 */
async function structured({ apiKey, model = DEFAULT_MODEL, system, content, schema, maxTokens = 16000, effort }) {
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
  if (err instanceof Anthropic.RateLimitError) return new Error('Rate limited by the Claude API. Wait a minute and try again.');
  if (err instanceof Anthropic.APIConnectionError) return new Error("Couldn't reach the Claude API. Are you online?");
  if (err instanceof Anthropic.APIError) return new Error(`Claude API error: ${err.message}`);
  return err;
}

const TX_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['bank', 'account_name', 'account_type', 'statement_start', 'statement_end', 'closing_balance', 'transactions'],
  properties: {
    bank: { type: 'string' },
    account_name: { type: 'string' },
    account_type: { type: 'string', enum: ['current', 'savings', 'credit'] },
    statement_start: { type: ['string', 'null'], description: 'Statement period start, YYYY-MM-DD' },
    statement_end: { type: ['string', 'null'], description: 'Statement period end, YYYY-MM-DD' },
    closing_balance: { type: ['number', 'null'] },
    transactions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['date', 'description', 'amount'],
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          description: { type: 'string' },
          amount: { type: 'number', description: 'GBP. Negative = money leaving the account, positive = money arriving.' },
          balance: { type: ['number', 'null'] },
        },
      },
    },
  },
};

/** Read a whole bank statement PDF. Returns pence-based transactions. */
export async function aiReadStatement({ apiKey, model, pdfBase64 }) {
  const r = await structured({
    apiKey, model, maxTokens: 64000,
    system: 'You extract transactions from UK bank and credit-card statements with perfect accuracy. Include every transaction row exactly once. Skip balance brought/carried forward rows and summary totals. For credit cards, purchases are negative and payments to the card are positive.',
    content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
      { type: 'text', text: 'Extract all transactions from this statement.' },
    ],
    schema: TX_SCHEMA,
  });
  const p = (n) => (n == null ? null : Math.round(n * 100));
  return {
    bank: r.bank, accountName: r.account_name, accountType: r.account_type, closingBalance: p(r.closing_balance),
    period: { start: r.statement_start, end: r.statement_end },
    transactions: r.transactions.filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.date) && t.amount).map((t) => ({
      date: t.date, description: t.description, amount: p(t.amount), balance: p(t.balance),
    })),
    warnings: [],
  };
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
    apiKey, model, effort: 'high', maxTokens: 16000,
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
