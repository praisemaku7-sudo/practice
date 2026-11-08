// Pocket Ledger bank-sync server: a Cloudflare Worker between the app and Enable Banking
// (a regulated Open Banking provider). It keeps the provider's private key and your bank
// sessions server-side; the app only ever talks to this Worker, using your APP_TOKEN.
//
// Stateless: nothing is stored here. Your bank connections (session ids) are kept in the app on
// your phone; this Worker only holds the provider key and signs requests. No database to set up.
//
// Apple Pay logging (optional KV binding STORE): iPhone Shortcuts POSTs each Apple Pay payment to
// /log; the app collects them from /inbox next time it opens. Works with only APP_TOKEN set.
//
// Secrets: EB_APP_ID, EB_PRIVATE_KEY (PKCS#8 PEM) for bank sync; APP_TOKEN always
// Vars: ALLOWED_ORIGIN (your app's origin, e.g. https://you.github.io), EB_API (optional)

const EB_API = 'https://api.enablebanking.com';

const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uJson = (o) => b64u(new TextEncoder().encode(JSON.stringify(o)));

async function importKey(pem) {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

/** Enable Banking authenticates each API call with a short-lived RS256 JWT signed by your app key. */
export async function makeJwt(env, now = Math.floor(Date.now() / 1000)) {
  const head = b64uJson({ typ: 'JWT', alg: 'RS256', kid: env.EB_APP_ID });
  const body = b64uJson({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp: now + 3600 });
  const key = await importKey(env.EB_PRIVATE_KEY);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64u(sig)}`;
}

async function eb(env, method, path, body) {
  const res = await fetch(`${env.EB_API || EB_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await makeJwt(env)}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw Object.assign(new Error(data.message || data.error || `Provider error ${res.status}`), { status: res.status });
  return data;
}

/** Provider transaction → the app's shape: { date, description, amount (pence, − = out), pending }. */
export function mapTransaction(t) {
  const amt = Math.round(parseFloat(t.transaction_amount?.amount || '0') * 100);
  const sign = t.credit_debit_indicator === 'DBIT' ? -1 : 1;
  const party = sign < 0 ? t.creditor?.name : t.debtor?.name;
  const info = (t.remittance_information || []).join(' ').trim();
  return {
    date: t.booking_date || t.value_date || t.transaction_date,
    description: [party, info].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() || t.bank_transaction_code?.description || 'Transaction',
    amount: sign * Math.abs(amt),
    pending: t.status === 'PDNG',
    id: t.entry_reference || t.transaction_id || null,
  };
}

/** Best "balance now" from a provider balances list. */
export function pickBalance(balances = []) {
  const order = ['ITAV', 'CLAV', 'ITBD', 'CLBD', 'XPCD', 'OTHR'];
  const sorted = [...balances].sort((a, b) => order.indexOf(a.balance_type) - order.indexOf(b.balance_type));
  const b = sorted[0];
  return b ? Math.round(parseFloat(b.balance_amount.amount) * 100) : null;
}

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
}
/** The bank round-trip carries its own signed, expiring state, so nothing needs storing. */
export async function signState(env, data) {
  const body = b64uJson({ ...data, exp: Date.now() + 3600000 });
  return `${body}.${await hmac(env.APP_TOKEN, body)}`;
}
export async function readState(env, state) {
  const [body, sig] = String(state || '').split('.');
  if (!body || !sig || (await hmac(env.APP_TOKEN, body)) !== sig) return null;
  const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(body.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((body.length + 3) % 4)), (c) => c.charCodeAt(0))));
  return data.exp > Date.now() ? data : null;
}

const json = (data, status, cors) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...cors } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      Vary: 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      // The bank sends you back here after you approve access in its app.
      if (url.pathname === '/callback') {
        const pending = await readState(env, url.searchParams.get('state'));
        if (!pending) return new Response('This link has expired. Start again from the app.', { status: 400 });
        const back = new URL(pending.redirect);
        if (url.searchParams.get('error')) { back.hash = `#/sync?error=${encodeURIComponent(url.searchParams.get('error'))}`; return Response.redirect(back.toString(), 302); }
        const session = await eb(env, 'POST', '/sessions', { code: url.searchParams.get('code') });
        const link = {
          id: session.session_id, bank: pending.bank, country: pending.country, validUntil: session.access?.valid_until || null,
          accounts: (session.accounts || []).map((a) => ({ uid: a.uid, name: a.name || a.product || 'Account', last4: (a.account_id?.iban || '').slice(-4) || null, currency: a.currency })),
        };
        // Hand the connection back to the app (kept on your phone, not here).
        back.hash = `#/sync?link=${b64uJson(link)}`;
        return Response.redirect(back.toString(), 302);
      }

      // Everything else needs your app token.
      if (request.headers.get('Authorization') !== `Bearer ${env.APP_TOKEN}`) return json({ error: 'Wrong or missing app token' }, 401, cors);

      if (url.pathname === '/health') return json({ ok: true, bankSync: !!(env.EB_APP_ID && /PRIVATE KEY/.test(env.EB_PRIVATE_KEY || '')), applePay: !!env.STORE }, 200, cors);

      // Apple Pay inbox (from an iPhone Shortcuts "Transaction" automation).
      if (url.pathname === '/log' || url.pathname.startsWith('/inbox')) {
        if (!env.STORE) return json({ error: 'Apple Pay logging needs a KV namespace bound as STORE (see wrangler.toml).' }, 501, cors);
        const inbox = JSON.parse((await env.STORE.get('inbox')) || '[]');
        if (url.pathname === '/log' && request.method === 'POST') {
          const body = await request.json().catch(() => ({}));
          const entry = { id: crypto.randomUUID(), at: new Date().toISOString(), amount: String(body.amount ?? ''), merchant: String(body.merchant ?? '').slice(0, 120), card: String(body.card ?? '').slice(0, 80) };
          if (!entry.amount) return json({ error: 'amount is required' }, 400, cors);
          await env.STORE.put('inbox', JSON.stringify([...inbox, entry].slice(-500)));
          return json({ ok: true }, 200, cors);
        }
        if (url.pathname === '/inbox' && request.method === 'GET') return json(inbox, 200, cors);
        if (url.pathname === '/inbox/ack' && request.method === 'POST') {
          const { ids = [] } = await request.json().catch(() => ({}));
          const done = new Set(ids);
          await env.STORE.put('inbox', JSON.stringify(inbox.filter((e) => !done.has(e.id))));
          return json({ ok: true }, 200, cors);
        }
      }

      if (url.pathname === '/banks') {
        const country = url.searchParams.get('country') || 'GB';
        const data = await eb(env, 'GET', `/aspsps?country=${encodeURIComponent(country)}`);
        return json((data.aspsps || []).map((a) => ({ name: a.name, country: a.country, logo: a.logo || null })), 200, cors);
      }

      if (url.pathname === '/connect' && request.method === 'POST') {
        const { bank, country = 'GB', redirect, days = 90 } = await request.json();
        if (!bank || !redirect) return json({ error: 'bank and redirect are required' }, 400, cors);
        // Only ever send people back to your own app.
        if (env.ALLOWED_ORIGIN && !redirect.startsWith(env.ALLOWED_ORIGIN)) return json({ error: 'redirect must be your app address' }, 400, cors);
        const state = await signState(env, { bank, country, redirect });
        const validUntil = new Date(Date.now() + days * 86400000).toISOString();
        const auth = await eb(env, 'POST', '/auth', {
          access: { valid_until: validUntil }, aspsp: { name: bank, country }, state,
          redirect_url: `${url.origin}/callback`, psu_type: 'personal',
        });
        return json({ url: auth.url }, 200, cors);
      }

      if (url.pathname === '/transactions') {
        const uid = url.searchParams.get('account');
        const from = url.searchParams.get('from');
        const out = [];
        let key = null;
        for (let page = 0; page < 20; page++) {
          const q = new URLSearchParams({ ...(from ? { date_from: from } : {}), ...(key ? { continuation_key: key } : {}) });
          const data = await eb(env, 'GET', `/accounts/${encodeURIComponent(uid)}/transactions?${q}`);
          out.push(...(data.transactions || []).map(mapTransaction));
          key = data.continuation_key;
          if (!key) break;
        }
        let balance = null;
        try { balance = pickBalance((await eb(env, 'GET', `/accounts/${encodeURIComponent(uid)}/balances`)).balances); } catch { /* optional */ }
        return json({ transactions: out.filter((t) => t.date && t.amount && !t.pending), balance }, 200, cors);
      }

      if (url.pathname.startsWith('/sessions/') && request.method === 'DELETE') {
        const id = decodeURIComponent(url.pathname.slice('/sessions/'.length));
        try { await eb(env, 'DELETE', `/sessions/${encodeURIComponent(id)}`); } catch { /* already gone */ }
        return json({ ok: true }, 200, cors);
      }

      return json({ error: 'Not found' }, 404, cors);
    } catch (e) {
      return json({ error: e.message }, e.status && e.status < 500 ? 502 : 500, cors);
    }
  },
};
