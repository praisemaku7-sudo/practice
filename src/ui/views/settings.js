import { state, saveSettings, wipeAll, load, relinkTransfers, recompute } from '../../state.js';
import { db } from '../../lib/db.js';
import { esc, toast, confirmSheet, busy } from '../dom.js';
import { fmt, parsePrice } from '../../lib/money.js';
import { MODELS, testKey } from '../../lib/ai.js';

export function render() {
  const s = state.settings;
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone;
  return `
  <h1 class="page-title">Settings</h1>
  ${standalone ? '' : `<div class="card tip-box"><b>Install on your iPhone:</b> in Safari tap <b>Share</b> → <b>Add to Home Screen</b>. It opens full screen like an app, works offline, and keeps your data on the phone.</div>`}
  <div class="card">
    <h3>Claude AI</h3>
    <p class="muted">Reads any bank's PDF layout, reads prices from photos, and writes your monthly review. You pay Anthropic directly for usage (usually a few pence per statement). Get a key at console.anthropic.com.</p>
    <label class="field"><span>API key</span><input id="st-key" type="password" autocomplete="off" placeholder="sk-ant-…" value="${esc(s.apiKey)}"></label>
    <label class="field select"><span>Model</span><select data-change="st-model">${MODELS.map((m) => `<option value="${m.id}" ${s.model === m.id ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label>
    <label class="toggle"><input type="checkbox" data-change="st-aipdf" ${s.useAIForPDF ? 'checked' : ''}> Read PDFs with Claude (more accurate; sends the PDF to Anthropic)</label>
    <div class="row gap"><button class="btn ghost grow" data-action="st-test">Test key</button><button class="btn primary grow" data-action="st-save-key">Save key</button></div>
    <p class="sub">Your key is stored only on this device and sent only to api.anthropic.com. Statement PDFs go to Anthropic only when "Read PDFs with Claude" is on. Monthly reviews send totals, not transactions.</p>
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
    <button class="btn ghost full" data-action="load-demo">Load sample data</button>
    <button class="btn danger full" data-action="st-wipe">Delete everything</button>
  </div>
  <p class="sub center">Pocket Ledger · runs on your phone · no account, no tracking</p>`;
}

export const actions = {
  'st-save-key': async () => { await saveSettings({ apiKey: document.getElementById('st-key').value.trim() }); toast('Key saved'); },
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
    const data = { app: 'pocket-ledger', version: 1, exportedAt: new Date().toISOString(), txs: state.txs, accounts: state.accounts, imports: state.imports, checks: state.checks, settings: { ...state.settings, apiKey: '' } };
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

export const changes = {
  'st-model': async (el) => { await saveSettings({ model: el.value }); toast('Model updated'); },
  'st-aipdf': async (el) => { await saveSettings({ useAIForPDF: el.checked }); },
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
