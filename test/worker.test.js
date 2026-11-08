import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { makeJwt, mapTransaction, pickBalance } from '../server/worker.js';

async function makeEnv() {
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----`;
  return {
    pub: kp.publicKey,
    env: { EB_APP_ID: 'app-123', EB_PRIVATE_KEY: pem, APP_TOKEN: 'secret-token', ALLOWED_ORIGIN: 'https://me.github.io', EB_API: 'https://eb.test' },
  };
}

test('JWT is signed with the app key and has the right claims', async () => {
  const { env, pub } = await makeEnv();
  const jwt = await makeJwt(env, 1700000000);
  const [h, b, s] = jwt.split('.');
  const dec = (x) => JSON.parse(Buffer.from(x, 'base64url').toString());
  assert.deepEqual(dec(h), { typ: 'JWT', alg: 'RS256', kid: 'app-123' });
  assert.equal(dec(b).aud, 'api.enablebanking.com');
  assert.equal(dec(b).exp - dec(b).iat, 3600);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pub, Buffer.from(s, 'base64url'), new TextEncoder().encode(`${h}.${b}`));
  assert.equal(ok, true);
});

test('mapping provider transactions and balances', () => {
  assert.deepEqual(mapTransaction({ booking_date: '2026-10-02', transaction_amount: { amount: '25.50', currency: 'GBP' }, credit_debit_indicator: 'DBIT', creditor: { name: 'TESCO STORES' }, remittance_information: ['CARD 1234'], status: 'BOOK', entry_reference: 'x1' }),
    { date: '2026-10-02', description: 'TESCO STORES CARD 1234', amount: -2550, pending: false, id: 'x1' });
  assert.equal(mapTransaction({ value_date: '2026-10-25', transaction_amount: { amount: '2500.00' }, credit_debit_indicator: 'CRDT', debtor: { name: 'ACME' } }).amount, 250000);
  assert.equal(pickBalance([{ balance_type: 'CLBD', balance_amount: { amount: '10.00' } }, { balance_type: 'ITAV', balance_amount: { amount: '12.34' } }]), 1234);
});

test('full flow (stateless): token check, banks, connect, callback hands the link to the app, paged transactions', async () => {
  const { env } = await makeEnv();
  const calls = [];
  globalThis.fetch = async (u, opts = {}) => {
    const url = new URL(u);
    calls.push(`${opts.method || 'GET'} ${url.pathname}${url.search}`);
    assert.match(opts.headers.Authorization, /^Bearer .+\..+\..+$/);
    const reply = (o) => new Response(JSON.stringify(o), { status: 200 });
    if (url.pathname === '/aspsps') return reply({ aspsps: [{ name: 'Nationwide', country: 'GB' }, { name: 'Monzo', country: 'GB' }] });
    if (url.pathname === '/auth') { const body = JSON.parse(opts.body); assert.equal(body.redirect_url, 'https://sync.test/callback'); assert.equal(body.aspsp.name, 'Monzo'); return reply({ url: `https://bank.test/approve?state=${body.state}` }); }
    if (url.pathname === '/sessions') return reply({ session_id: 'sess1', access: { valid_until: '2027-02-01T00:00:00Z' }, accounts: [{ uid: 'acc-uid-1', name: 'Personal', currency: 'GBP' }] });
    if (url.pathname.endsWith('/transactions')) {
      return url.searchParams.get('continuation_key')
        ? reply({ transactions: [{ booking_date: '2026-10-05', transaction_amount: { amount: '4.20' }, credit_debit_indicator: 'DBIT', creditor: { name: 'PRET' }, status: 'BOOK' }] })
        : reply({ transactions: [{ booking_date: '2026-10-04', transaction_amount: { amount: '1.00' }, credit_debit_indicator: 'DBIT', creditor: { name: 'PENDING CAFE' }, status: 'PDNG' }], continuation_key: 'k2' });
    }
    if (url.pathname.endsWith('/balances')) return reply({ balances: [{ balance_type: 'ITAV', balance_amount: { amount: '842.10' } }] });
    return new Response('{}', { status: 404 });
  };
  const call = (path, opts = {}) => worker.fetch(new Request(`https://sync.test${path}`, { ...opts, headers: { Authorization: 'Bearer secret-token', 'Content-Type': 'application/json', ...(opts.headers || {}) } }), env);

  assert.equal((await worker.fetch(new Request('https://sync.test/health'), env)).status, 401, 'no token, no access');
  assert.equal((await call('/health')).status, 200);
  const banks = await (await call('/banks?country=GB')).json();
  assert.deepEqual(banks.map((b) => b.name), ['Nationwide', 'Monzo']);
  const { url } = await (await call('/connect', { method: 'POST', body: JSON.stringify({ bank: 'Monzo', redirect: 'https://me.github.io/practice/' }) })).json();
  const state = new URL(url).searchParams.get('state');
  const cb = await worker.fetch(new Request(`https://sync.test/callback?code=abc&state=${state}`), env);
  assert.equal(cb.status, 302);
  const loc = new URL(cb.headers.get('Location'));
  assert.equal(loc.origin + loc.pathname, 'https://me.github.io/practice/');
  const link = JSON.parse(Buffer.from(loc.hash.split('link=')[1], 'base64url').toString());
  assert.equal(link.id, 'sess1');
  assert.equal(link.accounts[0].uid, 'acc-uid-1');
  // Tampered state is refused; redirect must be your own app.
  assert.equal((await worker.fetch(new Request(`https://sync.test/callback?code=abc&state=${state}x`), env)).status, 400);
  assert.equal((await call('/connect', { method: 'POST', body: JSON.stringify({ bank: 'Monzo', redirect: 'https://evil.example/' }) })).status, 400);
  const tx = await (await call('/transactions?account=acc-uid-1&from=2026-10-01')).json();
  assert.deepEqual(tx.transactions.map((t) => [t.description, t.amount]), [['PRET', -420]], 'pending skipped, both pages read');
  assert.equal(tx.balance, 84210);
  assert.ok(calls.some((c) => c.includes('continuation_key=k2')));
});

test('Apple Pay inbox: log, list, acknowledge; token required', async () => {
  const kv = new Map();
  const env = { APP_TOKEN: 't', STORE: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => kv.set(k, v) } };
  const call = (path, opts = {}) => worker.fetch(new Request(`https://sync.test${path}`, { ...opts, headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' } }), env);
  assert.equal((await worker.fetch(new Request('https://sync.test/log', { method: 'POST', body: '{"amount":"1"}' }), env)).status, 401);
  assert.equal((await call('/log', { method: 'POST', body: JSON.stringify({ amount: '£4.50', merchant: 'Pret A Manger', card: 'Amex' }) })).status, 200);
  const inbox = await (await call('/inbox')).json();
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].merchant, 'Pret A Manger');
  await call('/inbox/ack', { method: 'POST', body: JSON.stringify({ ids: [inbox[0].id] }) });
  assert.equal((await (await call('/inbox')).json()).length, 0);
  const health = await (await call('/health')).json();
  assert.deepEqual(health, { ok: true, bankSync: false, applePay: true });
});
