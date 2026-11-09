// Move every bill to one main account, step by step: what each bill is (Direct Debit, standing order,
// card payment), where it comes from now, exactly how to move it, and a tick when it's done.
import { state, saveSettings, accountName, personName, ownerOf } from '../../state.js';
import { esc, toast } from '../dom.js';
import { fmt } from '../../lib/money.js';
import { catName } from '../../lib/categories.js';
import { helpFor, HELP } from '../../lib/directory.js';

/** The account your pay goes into is the natural main account. */
function suggestedMain() {
  const inc = {};
  for (const t of state.allTxs || state.txs) if (t.category === 'income' && t.amount > 0) inc[t.accountId] = (inc[t.accountId] || 0) + t.amount;
  const best = Object.entries(inc).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : state.accounts.find((a) => a.type === 'current')?.id;
}

function howTo(r, mainName, fromAcc) {
  const h = helpFor(r.name);
  if (fromAcc?.type === 'credit') return { kind: 'Card payment', steps: [`Change the card saved with ${r.name} to your ${mainName} debit card${h ? ` (${h.label}: account settings)` : ''}.`, 'Check the next card statement to make sure it has moved.'], h };
  if (r.type === 'Standing Order') return { kind: 'Standing order', steps: [`In the ${mainName} app, set up a new standing order for ${fmt(r.amount)} on the ${r.day}${r.day % 10 === 1 && r.day !== 11 ? 'st' : r.day % 10 === 2 && r.day !== 12 ? 'nd' : r.day % 10 === 3 && r.day !== 13 ? 'rd' : 'th'}.`, `Then cancel the old one in the ${fromAcc?.name || 'old account'} app, so it isn't paid twice.`], h };
  if (r.type === 'Direct Debit') return { kind: 'Direct Debit', steps: [`Give ${r.name} your ${mainName} sort code and account number (their app, website or phone line). They set up the new Direct Debit and the old one stops.`, 'Don\'t cancel the old Direct Debit yourself first: let the company switch it, then check it has gone.', 'While you\'re there, ask to move the payment date to just after payday.'], h };
  return { kind: 'Regular payment', steps: [`Find how ${r.name} is paid (Direct Debit, standing order or card) in the ${fromAcc?.name || 'account'} app, then move it as above.`], h };
}

export function render() {
  const s = state.settings;
  const main = s.mainAccountId || suggestedMain();
  const mainAcc = state.allAccounts?.find((a) => a.id === main) || state.accounts.find((a) => a.id === main);
  const moved = s.billsMoved || {};
  const bills = state.derived.recurring.filter((r) => r.active && r.direction === 'out' && (r.category !== 'transfer' || r.cardRepay));
  const toMove = bills.filter((r) => r.accountId !== main);
  const done = toMove.filter((r) => moved[r.key]);
  const total = bills.reduce((a, r) => a + r.amount, 0);
  const current = (state.allAccounts || state.accounts).filter((a) => a.type === 'current');
  const payday = state.derived.payday;
  return `<h1 class="page-title">Move bills to one account</h1>
  <div class="card hero">
    <div class="label">Bills moved</div>
    <div class="big">${done.length}<small> of ${toMove.length}</small></div>
    <div class="cat-bar"><span style="width:${toMove.length ? ((done.length / toMove.length) * 100).toFixed(1) : 100}%"></span></div>
    <div class="sub">One account for every bill means one balance to watch, no bounced payments and no missed-payment marks on your credit file.</div>
  </div>
  <div class="card">
    <h3>1. Choose your main account</h3>
    <label class="field select"><span>Main account</span><select data-change="mb-main">${current.map((a) => `<option value="${esc(a.id)}" ${a.id === main ? 'selected' : ''}>${esc(a.name)}${state.settings.people.length > 1 ? ` · ${esc(personName(ownerOf(a)).split(' ')[0])}` : ''}</option>`).join('')}</select></label>
    <p class="sub">${s.mainAccountId ? '' : 'Suggested: the account your pay goes into. '}Every bill comes out of here, so keep at least <b>${fmt(total, { whole: true })}</b> a month (your bills) in it${payday ? `, and ask companies for dates after payday (the ${payday}${payday % 10 === 1 && payday !== 11 ? 'st' : payday % 10 === 2 && payday !== 12 ? 'nd' : payday % 10 === 3 && payday !== 13 ? 'rd' : 'th'})` : ''}.</p>
    <details class="checks"><summary>Moving everything from one bank to another?</summary><div class="sub">The free Current Account Switch Service moves every Direct Debit and standing order for you in 7 working days and redirects payments for 3 years, but it closes the old account. Fine if you're leaving that bank completely.</div><a class="act-link" href="${HELP.cass.url}" target="_blank" rel="noopener">Current Account Switch Service ↗</a></details>
  </div>
  <div class="card">
    <h3>2. Move each bill${toMove.length ? ` <small class="muted">${toMove.length - done.length} to go</small>` : ''}</h3>
    ${toMove.length ? toMove.sort((a, b) => (moved[a.key] ? 1 : 0) - (moved[b.key] ? 1 : 0) || b.amount - a.amount).map((r) => {
      const from = (state.allAccounts || state.accounts).find((a) => a.id === r.accountId);
      const how = howTo(r, mainAcc?.name || 'main account', from);
      return `<div class="move-item ${moved[r.key] ? 'done' : ''}">
        <label class="check-row"><input type="checkbox" data-change="mb-done" data-key="${esc(r.key)}" ${moved[r.key] ? 'checked' : ''}><span class="grow"><b>${esc(r.name)}</b> · ${fmt(r.amount)}/mo<br><small class="sub">${esc(how.kind)} · ${esc(catName(r.category))} · from ${esc(accountName(r.accountId))} · day ${r.day}</small></span></label>
        ${moved[r.key] ? '' : `<ol class="act-steps">${how.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>${how.h ? `<a class="act-link" href="${esc(how.h.url)}" target="_blank" rel="noopener">${esc(how.h.label)} account ↗</a>` : ''}`}
      </div>`;
    }).join('') : '<p class="sub">✓ Every regular payment already comes from your main account.</p>'}
  </div>
  <div class="card">
    <h3>3. Check it worked</h3>
    <ol class="act-steps"><li>After each bill's next payment date, check it came out of ${esc(mainAcc?.name || 'your main account')}.</li><li>When nothing is left on an old account, you can close it, or keep it at £0 with no Direct Debits.</li><li>Import next month's statements: bills still coming from other accounts will show up here again.</li></ol>
  </div>`;
}

export const changes = {
  'mb-main': async (el, rerender) => { await saveSettings({ mainAccountId: el.value }); rerender(); toast('Main account set'); },
  'mb-done': async (el, rerender) => {
    const moved = { ...(state.settings.billsMoved || {}) };
    if (el.checked) moved[el.dataset.key] = true; else delete moved[el.dataset.key];
    await saveSettings({ billsMoved: moved }); rerender();
  },
};
