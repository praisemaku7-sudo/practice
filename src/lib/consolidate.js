// Plan for moving every bill and incoming payment onto one "main" account.

const HOW = {
  'Direct Debit': 'Give the company your main account details (online account or a call). They set up a new Direct Debit; the old one stops on its own.',
  'Standing Order': 'In your main bank app, create the same standing order, then cancel the old one in the old bank app.',
  'Card / Subscription': "Update the saved card in the company's app or website to your main account's debit card.",
  income: 'Send your main account details to your employer or payer (payroll / HR portal, or HMRC / DWP online).',
};

/**
 * @returns {{ main, steps: Array<{accountId, accountName, items: Array, switchSuggested: boolean}>, totalItems }}
 */
export function consolidationPlan({ accounts, recurring, mainAccountId, done = {} }) {
  const main = accounts.find((a) => a.id === mainAccountId) || null;
  const steps = [];
  for (const acc of accounts) {
    if (acc.id === mainAccountId) continue;
    const items = recurring
      .filter((r) => r.accountId === acc.id && r.active)
      .map((r) => ({ ...r, how: HOW[r.type] || HOW['Card / Subscription'], done: !!done[r.key + '@' + acc.id], doneKey: r.key + '@' + acc.id }));
    if (!items.length) continue;
    const debits = items.filter((i) => i.type === 'Direct Debit' || i.type === 'Standing Order' || i.type === 'income').length;
    steps.push({
      accountId: acc.id,
      accountName: acc.name,
      items,
      // A full switch moves DDs, SOs and incoming payments automatically and closes the old account.
      switchSuggested: debits >= 3 && acc.type !== 'credit',
    });
  }
  return { main, steps, totalItems: steps.reduce((a, s) => a + s.items.length, 0), doneItems: steps.reduce((a, s) => a + s.items.filter((i) => i.done).length, 0) };
}
