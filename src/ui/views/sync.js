// Live bank sync (Open Banking) through your own sync server. Your bank connections are stored
// here on the phone; the server only holds the provider key and signs requests.
import { state, saveSettings, recompute, relinkTransfers } from '../../state.js';
import { db } from '../../lib/db.js';
import { esc, toast, busy, openSheet, closeSheet } from '../dom.js';
import { prettyDate } from '../../lib/dates.js';
import { client, syncFrom } from '../../lib/banksync.js';
import { commitItem } from '../import.js';

const DEPLOY_URL = 'https://deploy.workers.cloudflare.com/?url=https://github.com/praisemaku7-sudo/practice/tree/main/server';
let flash = '';

const cfg = () => ({ url: '', token: '', links: {}, lastSync: {}, sessions: [], ...(state.settings.bankSync || {}) });
async function saveCfg(patch) { await saveSettings({ bankSync: { ...cfg(), ...patch } }); }

function fromB64u(s) {
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0))));
}

export async function applyParams(params) {
  flash = '';
  if (params.get('error')) flash = `The bank didn't connect: ${params.get('error')}`;
  const link = params.get('link');
  if (link) {
    try {
      const s = fromB64u(link);
      const sessions = cfg().sessions.filter((x) => x.id !== s.id && x.bank !== s.bank);
      await saveCfg({ sessions: [...sessions, s] });
      flash = `✓ ${s.bank} connected (${s.accounts.length} account${s.accounts.length === 1 ? '' : 's'}). Choose which account each one fills, then tap Sync now.`;
    } catch { flash = "That connection link couldn't be read. Try connecting again."; }
    history.replaceState(null, '', '#/sync');
  }
}

const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('');

export function render() {
  const c = cfg();
  const ready = c.url && c.token;
  const linked = c.sessions.flatMap((s) => s.accounts.map((a) => ({ ...a, session: s })));
  const token = c.token || (state.draftToken ||= newToken());
  const step = (n, title, done, body) => `<div class="card step ${done ? 'done' : ''}"><div class="step-head"><span class="step-num">${done ? '✓' : n}</span><h3>${title}</h3></div>${body}</div>`;
  return `
  <h1 class="page-title">Bank sync</h1>
  ${flash ? `<div class="card tip-box">${esc(flash)}</div>` : ''}
  <div class="card muted-card"><p class="muted">Your banks send new transactions here automatically through UK Open Banking. You approve read-only access in each bank's app, and nobody sees your password. One-time setup takes about 20 minutes. Until then, <a href="#/settings">Auto-log Apple Pay</a> and screenshot imports keep you up to date.</p></div>

  ${step(1, 'Free Enable Banking account', ready, `
    <p class="muted">The regulated provider that talks to your banks. Its free "restricted" mode covers your own accounts.</p>
    <ol class="tips"><li>Sign up at <b>enablebanking.com</b> → Control Panel → <b>Applications</b> → create one (Production).</li>
    <li>Download the <b>private key</b> (.pem) and copy the <b>application ID</b>.</li>
    <li>Tap <b>Activate by linking accounts</b> and link each bank account you want synced.</li></ol>
    <a class="btn ghost full" href="https://enablebanking.com" target="_blank" rel="noopener">Open Enable Banking</a>`)}

  ${step(2, 'Your sync server (one tap)', ready, `
    <p class="muted">Deploys the server from this app's code to your own free Cloudflare account. When it asks for settings, paste:</p>
    <ul class="tips"><li><b>EB_APP_ID</b>: the application ID</li><li><b>EB_PRIVATE_KEY</b>: the whole .pem file contents</li>
    <li><b>APP_TOKEN</b>: this password (copy it now):</li></ul>
    <div class="row gap"><input class="url-box grow" id="bs-newtoken" readonly value="${esc(token)}"><button class="btn ghost" data-action="bs-copy-token">Copy</button></div>
    <a class="btn primary full" href="${DEPLOY_URL}" target="_blank" rel="noopener">Deploy to Cloudflare</a>
    <p class="sub">Afterwards, in Enable Banking set the app's <b>redirect URL</b> to your server address + <code>/callback</code>.</p>`)}

  ${step(3, 'Connect the app to your server', ready, `
    <label class="field"><span>Server</span><input id="bs-url" placeholder="https://pocket-ledger-sync.you.workers.dev" value="${esc(c.url)}" autocomplete="off"></label>
    <label class="field"><span>App token</span><input id="bs-token" type="password" value="${esc(token)}" autocomplete="off"></label>
    <button class="btn ${ready ? 'ghost' : 'primary'} full" data-action="bs-save">Save &amp; test</button>`)}

  ${ready ? `
  <div class="card">
    <h3>Your banks</h3>
    ${linked.map((a) => {
      const target = c.links[a.uid] || '';
      const exp = a.session.validUntil ? a.session.validUntil.slice(0, 10) : null;
      return `<div class="sync-row">
        <div class="row between"><b>${esc(a.session.bank)} · ${esc(a.name)}${a.last4 ? ` ••${esc(a.last4)}` : ''}</b><span class="sub">${c.lastSync[a.uid] ? `synced ${prettyDate(c.lastSync[a.uid])}` : 'not synced'}</span></div>
        <label class="field select slim"><span>Fills</span><select data-change="bs-link" data-uid="${esc(a.uid)}">
          <option value="">Choose…</option><option value="__new" ${target === '__new' ? 'selected' : ''}>+ New account</option>
          ${(state.allAccounts || state.accounts).map((x) => `<option value="${esc(x.id)}" ${target === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        ${exp ? `<div class="sub">Access until ${prettyDate(exp)}${exp < state.derived.today ? ' · <span class="neg">expired: reconnect</span>' : ''}</div>` : ''}
      </div>`;
    }).join('') || '<p class="muted">No banks connected yet.</p>'}
    <button class="btn primary full" data-action="bs-connect">＋ Connect a bank</button>
    ${linked.length ? `<button class="btn ghost full" data-action="bs-sync">Sync now</button>` : ''}
    ${c.sessions.length ? `<details class="sub"><summary>Disconnect a bank</summary>${c.sessions.map((s) => `<button class="link" data-action="bs-disconnect" data-id="${esc(s.id)}">Disconnect ${esc(s.bank)}</button>`).join('<br>')}</details>` : ''}
  </div>` : ''}`;
}

/** Pull new transactions for every linked account, through the same duplicate-safe import as statements. */
export async function syncAll({ quiet = false } = {}) {
  const c = cfg();
  const api = client(c);
  const linked = c.sessions.flatMap((s) => s.accounts.map((a) => ({ ...a, bank: s.bank }))).filter((a) => c.links[a.uid]);
  if (!linked.length) throw new Error('Choose which account each bank account fills first.');
  let added = 0;
  const lastSync = { ...c.lastSync };
  const links = { ...c.links };
  for (const a of linked) {
    const from = syncFrom(c.lastSync[a.uid], state.settings.trackFrom, state.derived.today);
    const { transactions, balance } = await api.transactions(a.uid, from);
    const name = `${a.bank} ${a.name}${a.last4 ? ` ••${a.last4}` : ''}`;
    const item = {
      name: `Live: ${name}`, hash: null, flip: false, replace: false, accountChoice: links[a.uid],
      newAccount: { name, bank: a.bank, type: 'current', owner: state.settings.people[0].id },
      parsed: { transactions: transactions.map((t) => ({ date: t.date, description: t.description, amount: t.amount, balance: null })), closingBalance: null, method: 'Open Banking', period: {}, accountRef: a.last4 || null },
    };
    if (item.parsed.transactions.length) added += (await commitItem(item)).added;
    const acc = links[a.uid] === '__new' ? state.accounts.find((x) => x.name === name) : state.accounts.find((x) => x.id === links[a.uid]);
    if (acc) {
      links[a.uid] = acc.id;
      if (balance != null) { acc.balance = acc.type === 'credit' ? -Math.abs(balance) : balance; acc.balanceDate = state.derived.today; await db.put('accounts', acc); }
    }
    lastSync[a.uid] = state.derived.today;
  }
  await saveCfg({ lastSync, links, lastRun: Date.now() });
  await relinkTransfers();
  recompute();
  if (!quiet) toast(`Synced ${linked.length} account${linked.length === 1 ? '' : 's'} · ${added} new transaction${added === 1 ? '' : 's'}`);
  return added;
}

/** On app open: sync quietly if it's been more than 6 hours. */
export async function autoSync() {
  const c = cfg();
  if (!c.url || !c.token || !Object.values(c.links || {}).some(Boolean)) return;
  if (c.lastRun && Date.now() - c.lastRun < 6 * 3600000) return;
  try { const n = await syncAll({ quiet: true }); if (n) toast(`${n} new transaction${n === 1 ? '' : 's'} from your banks`); } catch { /* try again next open */ }
}

export const actions = {
  'bs-copy-token': async () => {
    const v = document.getElementById('bs-newtoken').value;
    try { await navigator.clipboard.writeText(v); toast('Password copied'); } catch { document.getElementById('bs-newtoken').select(); toast('Select and copy it'); }
  },
  'bs-save': async (_, rerender) => {
    const url = document.getElementById('bs-url').value.trim().replace(/\/+$/, '');
    const token = document.getElementById('bs-token').value.trim();
    if (!url) return toast('Paste your server address', { error: true });
    const done = busy('Checking your sync server…');
    try { await client({ url, token }).health(); await saveCfg({ url, token }); done(); toast('Connected to your sync server ✓'); }
    catch (e) { done(); toast(e.message, { error: true }); }
    rerender();
  },
  'bs-connect': async () => {
    const done = busy('Loading banks…');
    let banks = [];
    try { banks = await client(cfg()).banks('GB'); } catch (e) { done(); return toast(e.message, { error: true }); }
    done();
    openSheet(`<h2>Choose your bank</h2><input type="search" id="bank-q" class="url-box" placeholder="Search" style="width:100%">
      <div class="preview tall">${banks.map((b) => `<button class="list-row tap" data-bank="${esc(b.name)}"><div class="grow">${esc(b.name)}</div>›</button>`).join('') || '<p class="muted">No banks returned. Check your Enable Banking app is active.</p>'}</div>`, {
      onMount(p) {
        p.querySelector('#bank-q').oninput = (e) => { const q = e.target.value.toLowerCase(); p.querySelectorAll('[data-bank]').forEach((b) => { b.hidden = !b.dataset.bank.toLowerCase().includes(q); }); };
        p.querySelectorAll('[data-bank]').forEach((b) => { b.onclick = async () => {
          closeSheet();
          const d = busy(`Opening ${b.dataset.bank}…`);
          try { const { url } = await client(cfg()).connect(b.dataset.bank, location.origin + location.pathname); location.href = url; }
          catch (e) { d(); toast(e.message, { error: true }); }
        }; });
      },
    });
  },
  'bs-sync': async (_, rerender) => {
    const done = busy('Syncing your banks…');
    try { await syncAll(); } catch (e) { toast(e.message, { error: true }); }
    done(); rerender();
  },
  'bs-disconnect': async (el, rerender) => {
    const c = cfg();
    try { await client(c).disconnect(el.dataset.id); } catch { /* remove locally anyway */ }
    await saveCfg({ sessions: c.sessions.filter((s) => s.id !== el.dataset.id) });
    toast('Disconnected'); rerender();
  },
};
export const changes = {
  'bs-link': async (el) => { await saveCfg({ links: { ...cfg().links, [el.dataset.uid]: el.value } }); },
};
