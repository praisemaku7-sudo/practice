// Pocket Ledger bank-sync server: a Cloudflare Worker between the app and Enable Banking
// (a regulated Open Banking provider). It keeps the provider's private key and your bank
// sessions server-side; the app only ever talks to this Worker, using your APP_TOKEN.
//
// Secrets (wrangler secret put …): EB_APP_ID, EB_PRIVATE_KEY (PKCS#8 PEM), APP_TOKEN
// Vars: ALLOWED_ORIGIN (your app's origin, e.g. https://you.github.io), EB_API (optional)
// KV binding: STORE

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
        const state = url.searchParams.get('state');
        const pending = state && JSON.parse((await env.STORE.get(`state:${state}`)) || 'null');
        if (!pending) return new Response('This link has expired. Start again from the app.', { status: 400 });
        await env.STORE.delete(`state:${state}`);
        const back = new URL(pending.redirect);
        if (url.searchParams.get('error')) { back.hash = `#/sync?error=${encodeURIComponent(url.searchParams.get('error'))}`; return Response.redirect(back.toString(), 302); }
        const session = await eb(env, 'POST', '/sessions', { code: url.searchParams.get('code') });
        const sessions = JSON.parse((await env.STORE.get('sessions')) || '[]');
        sessions.push({
          id: session.session_id, bank: pending.bank, country: pending.country, validUntil: session.access?.valid_until || null,
          accounts: (session.accounts || []).map((a) => ({ uid: a.uid, name: a.name || a.product || 'Account', iban: a.account_id?.iban || null, currency: a.currency, type: a.cash_account_type || null })),
        });
        await env.STORE.put('sessions', JSON.stringify(sessions));
        back.hash = '#/sync?connected=1';
        return Response.redirect(back.toString(), 302);
      }

      // Everything else needs your app token.
      if (request.headers.get('Authorization') !== `Bearer ${env.APP_TOKEN}`) return json({ error: 'Wrong or missing app token' }, 401, cors);

      if (url.pathname === '/health') return json({ ok: true }, 200, cors);

      if (url.pathname === '/banks') {
        const country = url.searchParams.get('country') || 'GB';
        const data = await eb(env, 'GET', `/aspsps?country=${encodeURIComponent(country)}`);
        return json((data.aspsps || []).map((a) => ({ name: a.name, country: a.country, logo: a.logo || null })), 200, cors);
      }

      if (url.pathname === '/connect' && request.method === 'POST') {
        const { bank, country = 'GB', redirect, days = 90 } = await request.json();
        if (!bank || !redirect) return json({ error: 'bank and redirect are required' }, 400, cors);
        const state = crypto.randomUUID();
        await env.STORE.put(`state:${state}`, JSON.stringify({ bank, country, redirect }), { expirationTtl: 3600 });
        const validUntil = new Date(Date.now() + days * 86400000).toISOString();
        const auth = await eb(env, 'POST', '/auth', {
          access: { valid_until: validUntil }, aspsp: { name: bank, country }, state,
          redirect_url: `${url.origin}/callback`, psu_type: 'personal',
        });
        return json({ url: auth.url }, 200, cors);
      }

      if (url.pathname === '/accounts') return json(JSON.parse((await env.STORE.get('sessions')) || '[]'), 200, cors);

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
        const sessions = JSON.parse((await env.STORE.get('sessions')) || '[]').filter((s) => s.id !== id);
        await env.STORE.put('sessions', JSON.stringify(sessions));
        return json({ ok: true }, 200, cors);
      }

      return json({ error: 'Not found' }, 404, cors);
    } catch (e) {
      return json({ error: e.message }, e.status && e.status < 500 ? 502 : 500, cors);
    }
  },
};
