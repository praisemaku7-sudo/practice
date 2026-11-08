// Live bank sync (Open Banking) through your own sync server.
import { state, saveSettings, recompute, relinkTransfers } from '../../state.js';
import { db } from '../../lib/db.js';
import { esc, toast, busy, openSheet, closeSheet } from '../dom.js';
import { fmt } from '../../lib/money.js';
import { prettyDate } from '../../lib/dates.js';
import { client, syncFrom } from '../../lib/banksync.js';
import { commitItem } from '../import.js';

let sessions = null;
let loadErr = '';
let flash = '';

const cfg = () => state.settings.bankSync || { url: '', token: '', links: {}, lastSync: {} };

export function applyParams(params) {
  if (params.get('connected')) flash = '✓ Bank connected. Choose which account each one fills, then Sync.';
  if (params.get('error')) flash = `The bank didn't connect: ${params.get('error')}`;
  sessions = null;
}

export async function preload() {
  const c = cfg();
  if (sessions || !c.url || !c.token) return;
  try { sessions = await client(c).sessions(); loadErr = ''; } catch (e) { loadErr = e.message; sessions = []; }
}

export function render() {
  const c = cfg();
  const setup = !c.url || !c.token;
  const linked = (sessions || []).flatMap((s) => s.accounts.map((a) => ({ ...a, session: s })));
  return `
  <h1 class="page-title">Bank sync</h1>
  ${flash ? `<div class="card tip-box">${esc(flash)}</div>` : ''}
  <div class="card">
    <h3>1 · Your sync server</h3>
    <p class="muted">Live sync needs a small server you own (free on Cloudflare) and a free Enable Banking account, so that bank access never sits in this app. Setup guide: <a href="https://github.com/praisemaku7-sudo/practice/blob/main/docs/BANK_LINKING.md" target="_blank" rel="noopener">docs/BANK_LINKING.md</a>.</p>
    <label class="field"><span>Server</span><input id="bs-url" placeholder="https://pocket-ledger-sync.you.workers.dev" value="${esc(c.url)}" autocomplete="off"></label>
    <label class="field"><span>App token</span><input id="bs-token" type="password" placeholder="the APP_TOKEN you set" value="${esc(c.token)}" autocomplete="off"></label>
    <button class="btn ${setup ? 'primary' : 'ghost'} full" data-action="bs-save">Save &amp; test</button>
    ${loadErr ? `<div class="alert">${esc(loadErr)}</div>` : ''}
  </div>
  ${setup ? '' : `
  <div class="card">
    <h3>2 · Connect a bank</h3>
    <p class="muted">You approve read-only access in your bank's own app (Face ID). It lasts up to 90 days, then you reconnect. Nobody sees your password.</p>
    <button class="btn primary full" data-action="bs-connect">＋ Connect a bank</button>
  </div>
  <div class="card">
    <h3>3 · Linked accounts</h3>
    ${linked.length ? linked.map((a) => {
      const target = c.links[a.uid] || '';
      const last = c.lastSync[a.uid];
      const exp = a.session.validUntil ? a.session.validUntil.slice(0, 10) : null;
      return `<div class="sync-row">
        <div class="row between"><b>${esc(a.session.bank)} · ${esc(a.name)}</b><span class="sub">${last ? `synced ${prettyDate(last)}` : 'not synced'}</span></div>
        <label class="field select slim"><span>Fills</span><select data-change="bs-link" data-uid="${esc(a.uid)}">
          <option value="">Choose…</option><option value="__new" ${target === '__new' ? 'selected' : ''}>+ New account</option>
          ${(state.allAccounts || state.accounts).map((x) => `<option value="${esc(x.id)}" ${target === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        ${exp ? `<div class="sub">Access until ${prettyDate(exp)}${exp < state.derived.today ? ' · <span class="neg">expired, reconnect</span>' : ''}</div>` : ''}
      </div>`;
    }).join('') : '<p class="muted">No banks connected yet.</p>'}
    ${linked.length ? `<button class="btn primary full" data-action="bs-sync">Sync now</button>` : ''}
    ${(sessions || []).length ? `<details class="sub"><summary>Disconnect a bank</summary>${sessions.map((s) => `<button class="link" data-action="bs-disconnect" data-id="${esc(s.id)}">Disconnect ${esc(s.bank)}</button>`).join('<br>')}</details>` : ''}
  </div>`}`;
}

async function saveCfg(patch) { await saveSettings({ bankSync: { ...cfg(), ...patch } }); }

/** Pull new transactions for every linked account, through the same duplicate-safe import path as statements. */
export async function syncAll({ quiet = false } = {}) {
  const c = cfg();
  const api = client(c);
  const list = sessions || await api.sessions();
  const linked = list.flatMap((s) => s.accounts.map((a) => ({ ...a, bank: s.bank }))).filter((a) => c.links[a.uid]);
  let added = 0;
  const lastSync = { ...c.lastSync };
  const links = { ...c.links };
  for (const a of linked) {
    const from = syncFrom(c.lastSync[a.uid], state.settings.trackFrom, state.derived.today);
    const { transactions, balance } = await api.transactions(a.uid, from);
    const item = {
      name: `Live: ${a.bank} ${a.name}`, hash: null, flip: false, replace: false,
      accountChoice: links[a.uid],
      newAccount: { name: `${a.bank} ${a.name}`, bank: a.bank, type: 'current', owner: state.settings.people[0].id },
      parsed: { transactions: transactions.map((t) => ({ date: t.date, description: t.description, amount: t.amount, balance: null })), closingBalance: null, method: 'Open Banking', period: {} },
    };
    if (item.parsed.transactions.length) {
      const r = await commitItem(item);
      added += r.added;
    }
    // Remember the account a "+ New account" link created, and keep its balance live.
    const acc = links[a.uid] === '__new' ? state.accounts.find((x) => x.name === item.newAccount.name) : state.accounts.find((x) => x.id === links[a.uid]);
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
  if (!c.url || !c.token || !Object.keys(c.links || {}).length) return;
  if (c.lastRun && Date.now() - c.lastRun < 6 * 3600000) return;
  try { const n = await syncAll({ quiet: true }); if (n) toast(`${n} new transaction${n === 1 ? '' : 's'} from your banks`); } catch { /* try again next open */ }
}

export const actions = {
  'bs-save': async (_, rerender) => {
    const url = document.getElementById('bs-url').value.trim();
    const token = document.getElementById('bs-token').value.trim();
    await saveCfg({ url, token });
    const done = busy('Checking your sync server…');
    try { await client({ url, token }).health(); done(); toast('Connected to your sync server ✓'); sessions = null; }
    catch (e) { done(); toast(e.message, { error: true }); }
    rerender();
  },
  'bs-connect': async () => {
    const done = busy('Loading banks…');
    let banks = [];
    try { banks = await client(cfg()).banks('GB'); } catch (e) { done(); return toast(e.message, { error: true }); }
    done();
    openSheet(`<h2>Choose your bank</h2><input type="search" id="bank-q" class="url-box" placeholder="Search" style="width:100%">
      <div class="preview tall" id="bank-list">${banks.map((b) => `<button class="list-row tap" data-bank="${esc(b.name)}"><div class="grow">${esc(b.name)}</div>›</button>`).join('')}</div>`, {
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
    try { await client(cfg()).disconnect(el.dataset.id); sessions = null; toast('Disconnected'); } catch (e) { toast(e.message, { error: true }); }
    await preload(); rerender();
  },
};
export const changes = {
  'bs-link': async (el) => { await saveCfg({ links: { ...cfg().links, [el.dataset.uid]: el.value } }); },
};
