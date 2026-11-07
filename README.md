# Pocket Ledger

A personal finance app for your iPhone: a web app you add to your Home Screen. Import your monthly bank statements (PDF or CSV) from all your banks and it shows you:

- **Monthly breakdown**: income, spending, savings and left-over; spending by category; top merchants; a 6-month trend.
- **What changed**: each category against last month and your 3-month average, new merchants, price rises on bills.
- **A budget for every category**, built from your real spending: bills and essentials at what they actually cost, a **savings goal** (default 20%), and **fun money**, which is what's left, split the way you usually spend.
- **"Can I afford this?"**: type a price, or snap a photo or screenshot of the item. It checks four things: fun money left this month, that category's budget, whether your savings goal still holds, and whether your current-account balance covers every bill before payday. You get **Yes / Yes, if… / Not right now**, plus what to do instead.
- **Monthly suggestions**: subscriptions, duplicate streaming services, fees and interest, takeaway habits, small spends adding up, categories over budget. Optionally, Claude writes a full monthly review and plan.
- **Accounts & consolidation**: every regular payment (Direct Debits, standing orders, card subscriptions) detected per account, plus a checklist for moving them all onto one main account, including when to use the Current Account Switch Service instead.

Everything is stored **only on your phone** (IndexedDB). No account, no server, no tracking.

## Use it on your iPhone

1. Deploy it (below), open the URL in **Safari**, tap **Share → Add to Home Screen**.
2. In each bank app, download last month's statement (PDF, or CSV if offered: CSV is the most reliable) and save it to Files.
3. In Pocket Ledger tap **＋** and pick the files. Review, choose the account, import.
4. Optional: **Settings → Claude AI**: paste an API key from console.anthropic.com to read any PDF layout (including scans), read prices from photos, and get the monthly review.

**Siri / Action Button:** create a Shortcut that asks for a number and opens `https://<your-site>/#/afford?price=[Number]`. "Hey Siri, can I afford this?" then runs the check.

## Deploy

GitHub Pages: merge to `main`, then in the repo go to **Settings → Pages → Source: GitHub Actions**. The included workflow tests, builds and publishes. (Pages on a private repo needs a paid GitHub plan; Netlify, Vercel or Cloudflare Pages also work. Build command `npm run build`, output `dist`.)

## Develop

```bash
npm install
npm run dev      # http://localhost:5173 (use --host URL to open on your phone over Wi-Fi)
npm test         # parser, categoriser, budget and affordability tests
npm run build
```

### Layout

| Path | What |
|---|---|
| `src/lib/parse/statementText.js` | PDF statement parser: columns, signs, balances, multi-line rows, missing years |
| `src/lib/parse/csv.js` | CSV import (Monzo, Starling, Revolut, Barclays, Lloyds, HSBC… header detection) |
| `src/lib/categorize.js` | UK merchant categoriser; your corrections become rules |
| `src/lib/analysis.js` | Monthly summaries, own-account transfer matching, recurring payment detection |
| `src/lib/budget.js` | Budget builder |
| `src/lib/afford.js` | "Can I afford this?" engine |
| `src/lib/insights.js` | Monthly suggestions |
| `src/lib/consolidate.js` | One-account consolidation plan |
| `src/lib/ai.js` | Claude API: statement reading, price-from-photo, monthly review |
| `docs/BANK_LINKING.md` | Plan for live Open Banking sync |

## Privacy notes

- Your Claude API key is stored on the device and sent only to `api.anthropic.com`.
- With "Read PDFs with Claude" on, statement PDFs are sent to Anthropic for extraction. Turn it off to read PDFs entirely on-device.
- The monthly review sends category totals and merchant names, not your transaction list.
- **Back up** from Settings now and then: iOS may clear website storage for apps you haven't opened in weeks.
