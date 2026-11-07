# Live bank linking (Open Banking): design notes

**Status: not built yet.** Pocket Ledger currently imports PDF/CSV statements. This is the plan for adding live, automatic syncing.

## Why not just give the app my bank logins?

- Sharing your online banking password with a third party usually breaks your bank's terms, and can weaken your protection if fraud happens.
- Screen-scraping with stored passwords breaks whenever a bank changes its login or 2FA.
- UK Open Banking exists to solve this. You approve **read-only** access inside your bank's own app (Face ID), the access is time-limited (re-confirm every 90 days), and you can revoke it at any time. The app never sees your password.

## What's needed

1. **An FCA-regulated aggregator (AISP)**, for example TrueLayer (Data API), GoCardless Bank Account Data, or Yapily. They cover essentially every UK bank and fintech (Monzo, Starling, Revolut, Barclays, Lloyds, HSBC, NatWest, Santander, Nationwide, Amex, and others). Check current pricing and sign-up terms yourself: some offer free personal/dev tiers, others are business-only.
2. **A tiny server** (for example a Cloudflare Worker or Vercel function). The aggregator gives you a client secret that must not live in a web app. The server:
   - `POST /link`: creates an auth link for the chosen bank and returns the URL; the phone opens it, and the bank app handles approval
   - `GET /callback`: swaps the code for tokens and stores them encrypted
   - `GET /transactions?since=…`: returns new transactions as JSON

## How it plugs into this app

The import pipeline already takes `{ date, description, amount (pence), balance }` rows. A sync adapter maps provider JSON into that shape and calls the same `toTransactions → dedupe → relinkTransfers` path as a statement import, so categories, transfer matching, budgets and affordability all work unchanged.

```js
// src/lib/banks/provider.js (future)
export async function syncAccount(account) {
  const res = await fetch(`${SERVER}/transactions?account=${account.providerId}&since=${account.syncedTo}`, { headers: { Authorization: `Bearer ${userToken}` } });
  const { transactions, balance } = await res.json();
  return { rows: transactions.map((t) => ({ date: t.date, description: t.description, amount: Math.round(t.amount * 100), balance: null })), balance };
}
```

## Apple Wallet / FinanceKit

Apple's FinanceKit gives native iOS apps transaction data for accounts in Apple Wallet. Its coverage is limited, and it needs a native Swift app with an Apple entitlement, so it doesn't replace Open Banking for 5 to 8 UK banks. It's worth revisiting only if this becomes a native app.

## Consolidating to one account

Moving money between banks (payment initiation, PISP) is a separate permission and a heavier regulatory lift. For consolidation, the in-app **Consolidation plan** plus the UK **Current Account Switch Service** (moves all Direct Debits, standing orders and incoming payments in 7 working days, guaranteed) is the safer route.
