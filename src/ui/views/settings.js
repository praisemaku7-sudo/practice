import { state, saveSettings, wipeAll, load, relinkTransfers, recompute, PERSON_COLORS, ownerOf, startFresh } from '../../state.js';
import { db } from '../../lib/db.js';
import { esc, toast, confirmSheet, busy } from '../dom.js';
import { fmt, parsePrice } from '../../lib/money.js';
import { MODELS } from '../../lib/models.js';
const testKey = async (...a) => (await import('../../lib/ai.js')).testKey(...a);
import { lockSettingsCard } from '../lock.js';

let lockCard = '';
export async function preload() { lockCard = await lockSettingsCard(); }

export function render() {
  const s = state.settings;
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone;
  return `
  <h1 class="page-title">Settings</h1>
  ${standalone ? '' : `<div class="card tip-box"><b>Install on your iPhone:</b> in Safari tap <b>Share</b> → <b>Add to Home Screen</b>. It opens full screen like an app, works offline, and keeps your data on the phone.</div>`}
  ${lockCard}
  <div class="card" id="people">
    <h3>Household</h3>
    <p class="muted">Add everyone whose statements you import. Give each account an owner (or Joint) in Accounts → Edit types. The switcher at the top then shows the household together or one person at a time.</p>
    ${state.settings.people.map((p, i) => `<div class="person-row">
      <span class="person-dot" style="--pc:${p.color}"></span>
      <input class="name-input" value="${esc(p.name)}" data-input="pp-name" data-id="${esc(p.id)}" aria-label="Name">
      <span class="sub">${(state.allAccounts || []).filter((a) => ownerOf(a) === p.id).length} accounts</span>
      ${i > 0 ? `<button class="icon-btn small" data-action="pp-remove" data-id="${esc(p.id)}" aria-label="Remove">×</button>` : ''}</div>`).join('')}
    <div class="row gap"><label class="field slim grow"><input id="pp-new" placeholder="Add a person, e.g. your wife's name" autocomplete="off"></label><button class="btn primary" data-action="pp-add">Add</button></div>
    <p class="sub">Tip: use full names as they appear on statements (e.g. "Alex Doe"). Statements with that name are assigned to that person automatically, and transfers between you are recognised.</p>
    <a class="btn ghost full" href="#/setup">Assign accounts to people</a>
  </div>
  <div class="card">
    <h3>Claude AI</h3>
    <p class="muted">Reads any bank's PDF layout, reads prices from photos, and writes your monthly review. You pay Anthropic directly for usage (usually a few pence per statement). Get a key at console.anthropic.com.</p>
    <label class="field"><span>API key</span><input id="st-key" type="password" autocomplete="off" placeholder="sk-ant-…" value="${esc(s.apiKey)}"></label>
    <label class="field select"><span>Model</span><select data-change="st-model">${MODELS.map((m) => `<option value="${m.id}" ${s.model === m.id ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label>
    <label class="field select"><span>PDFs</span><select data-change="st-pdfmode">
      <option value="auto" ${s.pdfMode === 'auto' ? 'selected' : ''}>On phone first, Claude only if needed (fastest)</option>
      <option value="always" ${s.pdfMode === 'always' ? 'selected' : ''}>Always double-check with Claude</option>
      <option value="never" ${s.pdfMode === 'never' ? 'selected' : ''}>Never send PDFs to Claude</option></select></label>
    <p class="sub">"Only if needed" means a statement's printed balances didn't add up on the phone, or it's a scan. Claude gets the statement's text, not the PDF file, split into parts read in parallel. For the quickest reads choose Haiku 5.5 above.</p>
    <div class="row gap"><button class="btn ghost grow" data-action="st-test">Test key</button><button class="btn primary grow" data-action="st-save-key">Save key</button></div>
    <div class="tip-box"><b>Out of credit?</b> Claude API usage is prepaid, and it can't be charged to a bank account from here. In your Claude Console go to <b>Settings → Billing</b>, add credit with a card, and turn on <b>auto-reload</b> so it tops itself up (e.g. add £10 when it drops below £5). Statements whose balances add up, including American Express, are read on your phone for free.</div>
    <p class="sub">Your key is stored only on this device and sent only to api.anthropic.com. Statement text goes to Anthropic only when a PDF needs Claude (see PDFs above). Monthly reviews send totals, not transactions.</p>
  </div>
  <div class="card">
    <h3>Track from</h3>
    <p class="muted">Only money from this month onwards counts: budgets, trends, insights and missing-statement checks. Older transactions in a statement are skipped on import.</p>
    <label class="field"><span>Start month</span><input id="st-from" type="month" value="${s.trackFrom ? s.trackFrom.slice(0, 7) : ''}" max="${state.derived.today.slice(0, 7)}"></label>
    <div class="row gap"><button class="btn ghost grow" data-action="st-from-all">Use all history</button><button class="btn primary grow" data-action="st-from-save">Save</button></div>
    ${state.hiddenCount ? `<p class="sub">${state.hiddenCount} older transactions are hidden, not deleted. Set an earlier month to bring them back.</p>` : ''}
  </div>
  ${applePayCard()}
  <div class="card">
    <h3>Bill reminders</h3>
    <p class="muted"><b>Calendar (recommended):</b> adds every regular bill to your iPhone Calendar, with an alert the day before. It works even when this app is closed.</p>
    <button class="btn primary full" data-action="due-calendar">📅 Add bills to Calendar</button>
    <p class="muted" style="margin-top:12px"><b>Daily Shortcut:</b> Shortcuts app → Automation → + → Time of Day (e.g. 8:00, Daily, Run Immediately) → add action <b>Open URLs</b> with:</p>
    <div class="row gap"><input class="url-box grow" id="due-url" readonly value="${esc(location.origin + location.pathname)}#/due?days=1"><button class="btn ghost" data-action="copy-due-url">Copy</button></div>
    <p class="sub">Every morning it opens "Due soon" showing today's and tomorrow's payments.</p>
  </div>
  <div class="card">
    <h3>Affordability</h3>
    <label class="field"><span>Always keep £</span><input id="st-buffer" inputmode="decimal" value="${(s.bufferPence / 100).toFixed(0)}"></label>
    <p class="sub">Safety cushion left in your current accounts after bills before payday.</p>
    <button class="btn ghost full" data-action="st-save-buffer">Save</button>
  </div>
  <div class="card">
    <h3>Your data</h3>
    <p class="muted">${state.txs.length} transactions · ${state.accounts.length} accounts · ${Object.keys(s.userRules).length} category rules. Stored in this browser only. Back up regularly: iOS can clear website data if you don't open the app for weeks.</p>
    <div class="row gap"><button class="btn ghost grow" data-action="st-export">Export backup</button>
    <label class="btn ghost grow">Restore backup<input type="file" accept="application/json,.json" data-change="st-restore" hidden></label></div>
    ${(state.allAccounts || []).some((a) => a.id.startsWith('demo-'))
      ? '<button class="btn danger full" data-action="remove-demo">Remove sample data</button>'
      : `<button class="btn ghost full" data-action="load-demo" ${(state.allAccounts || []).length ? 'hidden' : ''}>Load sample data</button>`}
    <button class="btn ghost full" data-action="st-fresh">Start fresh: re-import all statements</button>
    <p class="sub">Clears accounts and transactions only. People, income, goals, budgets and category rules stay, and files Claude already read are re-read for free. Use it if earlier imports got muddled.</p>
    <button class="btn danger full" data-action="st-wipe">Delete everything</button>
  </div>
  <p class="sub center">Pocket Ledger · runs on your phone · no account, no tracking</p>`;
}

async function setTrackFrom(value, rerender) {
  await saveSettings({ trackFrom: value });
  state.month = state.derived.today.slice(0, 7);
  await load(); await relinkTransfers(); recompute(); rerender();
}

function applePayCard() {
  const bs = state.settings.bankSync || {};
  const ready = bs.url && bs.token;
  const url = bs.url || 'https://YOUR-SERVER.workers.dev';
  const token = bs.token || 'YOUR-APP-TOKEN';
  const prompt = `When this shortcut runs from a Wallet transaction, send the payment to my budget app without showing anything: use "Get Contents of URL" to make a POST request to ${url}/log with the header "Authorization" set to "Bearer ${token}" and a JSON request body with three text fields: "amount" = the transaction's Amount, "merchant" = the transaction's Merchant, "card" = the transaction's Card or Pass name.`;
  return `<div class="card" id="applepay">
    <h3>Auto-log Apple Pay ⚡</h3>
    <p class="muted">Every Apple Pay payment is sent to your sync server in the background and appears here next time you open the app. Statements or bank sync replace the quick entries, so nothing doubles up.</p>
    ${ready ? '' : `<div class="alert">First set up your sync server: <b>Accounts → Live bank sync</b>, steps 2–3. For Apple Pay you only need Cloudflare and the app password, not Enable Banking.</div>`}
    <p class="muted"><b>1. Make the shortcut.</b> In Shortcuts, tap <b>+</b> and paste this into "Describe a shortcut":</p>
    <textarea class="url-box prompt-box" id="ap-prompt" readonly rows="6">${esc(prompt)}</textarea>
    <button class="btn ghost full" data-action="copy-ap-prompt">Copy prompt</button>
    <details class="sub"><summary>Or build it by hand</summary>
      <ol class="tips"><li>New shortcut → add <b>Get Contents of URL</b>.</li><li>URL: <code>${esc(url)}/log</code>, Method <b>POST</b>.</li>
      <li>Headers: <code>Authorization</code> = <code>Bearer ${esc(token)}</code>.</li>
      <li>Request Body <b>JSON</b>: <code>amount</code>, <code>merchant</code>, <code>card</code> → pick <b>Shortcut Input</b> → Amount / Merchant / Card.</li></ol></details>
    <p class="muted"><b>2. Run it on every tap.</b> Shortcuts → <b>Automation</b> → <b>+</b> → <b>Transaction</b> → choose your cards → <b>Run Immediately</b> → Next → pick the shortcut you just made.</p>
    ${ready ? '<button class="btn ghost full" data-action="ap-test">Check for new Apple Pay purchases now</button>' : ''}
  </div>`;
}

export const actions = {
  'st-fresh': async (_, rerender) => {
    if (!(await confirmSheet({ title: 'Start fresh?', body: 'Deletes all accounts and transactions (people, income, goals, budgets and settings are kept). Then import all your statements again in one go.', ok: 'Start fresh', danger: true }))) return;
    await startFresh();
    toast('Cleared. Now import all your statements');
    location.hash = '#/import';
    rerender();
  },
  'copy-ap-prompt': async () => {
    const v = document.getElementById('ap-prompt').value;
    try { await navigator.clipboard.writeText(v); toast('Prompt copied'); } catch { document.getElementById('ap-prompt').select(); toast('Select and copy the prompt'); }
  },
  'ap-test': async (_, rerender) => {
    try { const { pullApplePay } = await import('./sync.js'); const n = await pullApplePay(); toast(n ? `${n} purchase${n === 1 ? '' : 's'} added` : 'Nothing new yet. Pay with Apple Pay, then check again'); }
    catch (e) { toast(e.message, { error: true }); }
    rerender();
  },
  'remove-demo': async (_, rerender) => {
    const all = await db.all('tx');
    const demoIds = new Set((state.allAccounts || []).filter((a) => a.id.startsWith('demo-')).map((a) => a.id));
    for (const t of all.filter((x) => demoIds.has(x.accountId))) await db.del('tx', t.id);
    for (const id of demoIds) await db.del('accounts', id);
    await load(); await relinkTransfers(); recompute(); rerender(); toast('Sample data removed');
  },
  'copy-due-url': async () => {
    const v = document.getElementById('due-url').value;
    try { await navigator.clipboard.writeText(v); toast('Link copied'); } catch { document.getElementById('due-url').select(); toast('Select and copy the link'); }
  },
  'pp-add': async (_, rerender) => {
    const name = document.getElementById('pp-new').value.trim();
    if (!name) return toast('Type a name', { error: true });
    const people = state.settings.people;
    const id = 'p' + (Math.max(0, ...people.map((p) => parseInt(p.id.slice(1), 10) || 0)) + 1);
    await saveSettings({ people: [...people, { id, name, color: PERSON_COLORS[people.length % PERSON_COLORS.length] }] });
    rerender(); toast(`${name} added. Now assign their accounts.`);
  },
  'pp-remove': async (el, rerender) => {
    const p = state.settings.people.find((x) => x.id === el.dataset.id);
    if (!(await confirmSheet({ title: `Remove ${p.name}?`, body: `Their accounts move to ${state.settings.people[0].name}. No transactions are deleted.`, ok: 'Remove' }))) return;
    const { db: database } = await import('../../lib/db.js');
    for (const a of (state.allAccounts || []).filter((x) => x.owner === p.id)) { a.owner = state.settings.people[0].id; await database.put('accounts', a); }
    await saveSettings({ people: state.settings.people.filter((x) => x.id !== p.id), scope: state.settings.scope === p.id ? 'all' : state.settings.scope });
    await load(); rerender();
  },
  'st-from-save': async (_, rerender) => {
    const v = document.getElementById('st-from').value; // YYYY-MM
    if (!/^\d{4}-\d{2}$/.test(v)) return toast('Pick a month', { error: true });
    await setTrackFrom(`${v}-01`, rerender);
    toast(`Tracking from ${new Date(v + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`);
  },
  'st-from-all': async (_, rerender) => { await setTrackFrom(null, rerender); toast('Using all history'); },
  // Saving always checks the key first, so a typo or a key with no credit shows up now, not mid-import.
  'st-save-key': async (_, rerender) => {
    const key = document.getElementById('st-key').value.trim();
    if (!key) { await saveSettings({ apiKey: '' }); rerender(); return toast('Key removed'); }
    if (!/^sk-ant-/.test(key)) return toast('That doesn\'t look like a Claude API key (they start with sk-ant-). Copy it again from console.anthropic.com → API keys.', { error: true });
    const done = busy('Checking key…');
    try { await testKey(key, state.settings.model); done(); await saveSettings({ apiKey: key }); rerender(); toast('Key works and is saved ✓'); }
    catch (e) {
      done();
      if (/reach|online/i.test(e.message)) { await saveSettings({ apiKey: key }); rerender(); return toast('Saved, but couldn\'t check it: you seem to be offline.'); }
      toast(e.message, { error: true });
    }
  },
  'st-test': async () => {
    const key = document.getElementById('st-key').value.trim();
    if (!key) return toast('Paste a key first', { error: true });
    const done = busy('Checking key…');
    try { await testKey(key, state.settings.model); done(); await saveSettings({ apiKey: key }); toast('Key works and is saved ✓'); }
    catch (e) { done(); toast(e.message, { error: true }); }
  },
  'st-save-buffer': async () => {
    const v = parsePrice(document.getElementById('st-buffer').value);
    if (v == null) return toast('Enter an amount', { error: true });
    await saveSettings({ bufferPence: v }); toast(`Keeping ${fmt(v, { whole: true })} cushion`);
  },
  'st-export': async () => {
    const data = { app: 'pocket-ledger', version: 1, exportedAt: new Date().toISOString(), txs: state.allTxs || state.txs, accounts: state.allAccounts || state.accounts, imports: state.imports, checks: state.checks, settings: { ...state.settings, apiKey: '', scope: 'all' } };
    // Everything, whoever's view you're on and including months before tracking starts. The API key is never in the file.
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const name = `pocket-ledger-backup-${state.derived.today}.json`;
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Pocket Ledger backup' }); return; } catch { /* fall through */ }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
  'st-wipe': async (_, rerender) => {
    if (!(await confirmSheet({ title: 'Delete everything?', body: 'All transactions, accounts, budgets and your API key will be removed from this phone. Export a backup first if you might want it.', ok: 'Delete all', danger: true }))) return;
    await wipeAll(); rerender(); toast('All data deleted');
  },
};

export const inputs = {
  'pp-name': async (el) => {
    const name = el.value.trim();
    if (!name) return;
    await saveSettings({ people: state.settings.people.map((p) => (p.id === el.dataset.id ? { ...p, name } : p)) });
  },
};

export const changes = {
  'st-model': async (el) => { await saveSettings({ model: el.value }); toast('Model updated'); },
  'st-pdfmode': async (el) => { await saveSettings({ pdfMode: el.value }); },
  'st-restore': async (el, rerender) => {
    const file = el.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'pocket-ledger') throw new Error('Not a Pocket Ledger backup');
      if (!(await confirmSheet({ title: 'Restore backup?', body: `Replaces current data with ${data.txs.length} transactions from ${data.exportedAt?.slice(0, 10)}.`, ok: 'Restore' }))) return;
      const key = state.settings.apiKey;
      await wipeAll();
      await db.putMany('tx', data.txs); await db.putMany('accounts', data.accounts);
      await db.putMany('imports', data.imports || []); await db.putMany('checks', data.checks || []);
      await db.kvSet('settings', { ...data.settings, apiKey: key });
      await load(); await relinkTransfers(); recompute(); rerender(); toast('Backup restored');
    } catch (e) { toast(e.message, { error: true }); }
  },
};
