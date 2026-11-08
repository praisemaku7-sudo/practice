import { catName, catKind } from './categories.js';
import { compareMonths } from './analysis.js';
import { fmt } from './money.js';
import { monthLabel } from './dates.js';

const STREAMING = /NETFLIX|DISNEY|PRIME VIDEO|AMAZON PRIME|NOW ?TV|PARAMOUNT|APPLE ?TV|DAZN|SKY|YOUTUBE/;
const MUSIC = /SPOTIFY|APPLE MUSIC|YOUTUBE MUSIC|TIDAL|DEEZER|AMAZON MUSIC/;

/**
 * Rule-based monthly suggestions. Each: { id, level: 'good'|'warn'|'alert'|'tip', title, detail, saving }
 * saving = estimated pence per month you could free up.
 */
export function buildInsights({ txs, key, budget, recurring, accounts = [] }) {
  const creditIds = new Set(accounts.filter((a) => a.type === 'credit').map((a) => a.id));
  const out = [];
  const cmp = compareMonths(txs, key);
  const { cur } = cmp;
  const label = monthLabel(key);

  // Savings rate (skipped while a month is in progress and pay hasn't landed yet)
  const inProgress = budget && cur.income < budget.income * 0.6;
  if (cur.income > 0 && !inProgress) {
    const kept = cur.income - cur.spend;
    const rate = kept / cur.income;
    if (rate >= 0.2) out.push({ id: 'rate', level: 'good', title: `You kept ${Math.round(rate * 100)}% of your income in ${label}`, detail: `${fmt(kept, { whole: true })} not spent. Move it to savings before it drifts.`, saving: 0 });
    else if (rate < 0) out.push({ id: 'rate', level: 'alert', title: `You spent ${fmt(-kept, { whole: true })} more than you earned`, detail: 'Spending was higher than income this month. Check the categories that grew below first.', saving: -kept });
    else out.push({ id: 'rate', level: 'warn', title: `Savings rate ${Math.round(rate * 100)}% (target 20%)`, detail: `Getting to 20% means cutting about ${fmt(Math.round(cur.income * 0.2 - kept), { whole: true })} a month.`, saving: Math.round(cur.income * 0.2 - kept) });
  }

  // Categories that grew vs the 3-month average
  if (cmp.trailingMonths > 0) {
    for (const r of cmp.rows) {
      if (catKind(r.category) === 'fixed') continue;
      if (r.deltaAvg > 3000 && r.current > r.average * 1.25) {
        out.push({ id: 'up-' + r.category, level: 'warn', title: `${catName(r.category)} up ${fmt(r.deltaAvg, { whole: true })} on your usual`, detail: `${fmt(r.current, { whole: true })} this month vs a ${fmt(r.average, { whole: true })} average.`, saving: r.deltaAvg });
      } else if (r.deltaAvg < -3000 && r.average > 0) {
        out.push({ id: 'down-' + r.category, level: 'good', title: `${catName(r.category)} down ${fmt(-r.deltaAvg, { whole: true })}`, detail: `Nice. ${fmt(r.current, { whole: true })} vs a ${fmt(r.average, { whole: true })} average.`, saving: 0 });
      }
    }
  }

  // Over budget categories
  if (budget) {
    for (const l of budget.lines) {
      const spent = cur.byCat[l.category] || 0;
      if (l.budget > 0 && spent > l.budget * 1.1 && spent - l.budget > 1500) {
        out.push({ id: 'over-' + l.category, level: 'alert', title: `${catName(l.category)} ${fmt(spent - l.budget, { whole: true })} over budget`, detail: `Budget ${fmt(l.budget, { whole: true })}, spent ${fmt(spent, { whole: true })}.`, saving: spent - l.budget });
      }
    }
  }

  // Takeaway & eating out habit
  const food = (cur.byCat.takeaway || 0) + (cur.byCat.eating_out || 0);
  const groceries = cur.byCat.groceries || 0;
  if (food > 10000 && food > groceries * 0.6) {
    out.push({ id: 'food', level: 'tip', title: `${fmt(food, { whole: true })} on takeaways and eating out`, detail: `That's ${groceries ? Math.round((food / groceries) * 100) + '% of' : 'more than'} your grocery spend. Halving it saves ${fmt(food / 2, { whole: true })} a month.`, saving: Math.round(food / 2) });
  }

  // Small frequent purchases (coffee, snacks)
  const small = txs.filter((t) => t.date.startsWith(key) && t.amount < 0 && -t.amount <= 600 && ['eating_out', 'takeaway', 'groceries', 'other'].includes(t.category));
  if (small.length >= 12) {
    const total = small.reduce((a, t) => a - t.amount, 0);
    out.push({ id: 'small', level: 'tip', title: `${small.length} small purchases under £6 added up to ${fmt(total, { whole: true })}`, detail: 'Coffees, meal deals and snacks. Cutting a third of them is an easy win.', saving: Math.round(total / 3) });
  }

  // Subscriptions
  const subs = recurring.filter((r) => r.direction === 'out' && r.active && (r.category === 'subscriptions' || r.type === 'Card / Subscription') && r.category !== 'housing');
  const subTotal = subs.filter((r) => r.category === 'subscriptions').reduce((a, r) => a + r.amount, 0);
  if (subTotal > 0) {
    out.push({ id: 'subs', level: 'tip', title: `${fmt(subTotal)} a month on subscriptions (${fmt(subTotal * 12, { whole: true })}/yr)`, detail: subs.filter((r) => r.category === 'subscriptions').map((r) => `${r.name} ${fmt(r.amount)}`).join(', '), saving: 0 });
  }
  const streaming = subs.filter((r) => STREAMING.test(r.name));
  if (streaming.length >= 2) {
    const cheapest = streaming.reduce((a, b) => (a.amount < b.amount ? a : b));
    out.push({ id: 'streaming', level: 'tip', title: `${streaming.length} streaming services`, detail: `${streaming.map((s) => s.name).join(', ')}. Rotate them: keep one at a time and switch monthly.`, saving: streaming.reduce((a, s) => a + s.amount, 0) - cheapest.amount });
  }
  const music = subs.filter((r) => MUSIC.test(r.name));
  if (music.length >= 2) out.push({ id: 'music', level: 'warn', title: 'Paying for two music services', detail: music.map((s) => s.name).join(' and '), saving: Math.min(...music.map((m) => m.amount)) });

  // Price rises
  for (const r of recurring.filter((x) => x.direction === 'out' && x.priceChange > 0 && x.active)) {
    out.push({ id: 'rise-' + r.key, level: 'warn', title: `${r.name} went up ${fmt(r.priceChange)}`, detail: `Now ${fmt(r.amount)}/month. Worth a call to haggle or switch.`, saving: r.priceChange });
  }

  // Credit cards: the goal is £0 of new spending on them.
  if (creditIds.size) {
    const cardSpend = txs.filter((t) => t.date.startsWith(key) && creditIds.has(t.accountId) && t.amount < 0 && !['transfer', 'excluded'].includes(t.category));
    const total = cardSpend.reduce((a, t) => a - t.amount, 0);
    if (total > 0) {
      const top = {};
      for (const t of cardSpend) top[t.merchant] = (top[t.merchant] || 0) - t.amount;
      const names = Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, v]) => `${n} ${fmt(v, { whole: true })}`).join(', ');
      out.push({ id: 'card-spend', level: 'alert', title: `${fmt(total, { whole: true })} put on credit cards this month`, detail: `Goal is £0. Biggest: ${names}. Use your debit card instead.`, saving: total });
    }
    const onCard = recurring.filter((r) => r.direction === 'out' && r.active && creditIds.has(r.accountId));
    if (onCard.length) out.push({ id: 'card-recurring', level: 'warn', title: `${onCard.length} regular payment${onCard.length > 1 ? 's' : ''} still charged to a credit card`, detail: `${onCard.map((r) => `${r.name} ${fmt(r.amount)}`).join(', ')}. Move ${onCard.length > 1 ? 'them' : 'it'} to your debit card so the card balance can reach £0.`, saving: 0 });
  }

  // Fees and interest
  const fees = cur.byCat.fees || 0;
  if (fees > 0) out.push({ id: 'fees', level: 'alert', title: `${fmt(fees)} in bank fees or interest`, detail: 'Overdraft or card interest is money for nothing. Set a balance alert, or move bills to after payday.', saving: fees });

  // New merchants with big spend
  for (const m of cmp.newMerchants.slice(0, 3)) {
    out.push({ id: 'new-' + m.name, level: 'tip', title: `New this month: ${m.name}`, detail: `${fmt(m.total)} across ${m.count} payment${m.count > 1 ? 's' : ''}. Expected?`, saving: 0 });
  }

  // Consolidation
  const accountsWithBills = new Set(recurring.filter((r) => r.direction === 'out' && r.active).map((r) => r.accountId));
  if (accountsWithBills.size >= 3) {
    out.push({ id: 'consolidate', level: 'tip', title: `Bills come out of ${accountsWithBills.size} different accounts`, detail: 'Moving them to one bills account means one balance to watch and fewer missed payments. Tap for a step-by-step guide.', saving: 0 });
  }

  // Don't say "over budget" and "up on usual" about the same category.
  const overCats = new Set(out.filter((i) => i.id.startsWith('over-')).map((i) => i.id.slice(5)));
  const deduped = out.filter((i) => !(i.id.startsWith('up-') && overCats.has(i.id.slice(3))));
  const order = { alert: 0, warn: 1, tip: 2, good: 3 };
  return deduped.sort((a, b) => order[a.level] - order[b.level] || b.saving - a.saving);
}
