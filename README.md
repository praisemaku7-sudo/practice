# Pocket Ledger

A personal finance app for your iPhone: a web app you add to your Home Screen. Import your monthly bank statements (PDF or CSV) from all your banks and it shows you:

- **Monthly breakdown**: income, spending, savings and left-over; spending by category; top merchants; a 6-month trend.
- **What changed**: each category against last month and your 3-month average, new merchants, price rises on bills.
- **A budget for every category**, built from your real spending: bills and essentials at what they actually cost, a **savings goal** (default 20%), and **fun money**, which is what's left, split the way you usually spend.
- **"Can I afford this?"**: type a price, or snap a photo or screenshot of the item. It checks four things: fun money left this month, that category's budget, whether your savings goal still holds, and whether your current-account balance covers every bill before payday. You get **Yes / Yes, if… / Not right now**, plus what to do instead.
- **Monthly suggestions**: subscriptions, duplicate streaming services, fees and interest, takeaway habits, small spends adding up, categories over budget. Optionally, Claude writes a full monthly review and plan.
- **Duplicate & missing statement checks**: importing the exact same file again is caught before it's read, and re-importing the same transactions (even under another account) is flagged in the review. Each account gets a month-by-month grid of imported and missing statements, and you can mark months where no statement is expected.
- **Monthly record**: a row per month (income, spent, savings rate, change vs previous), averages over complete months, category trend lines, and CSV export. Months missing a statement are flagged so they don't skew averages.
- **Accounts & consolidation**: every regular payment (Direct Debits, standing orders, card subscriptions) detected per account, plus a checklist for moving them all onto one main account, including when to use the Current Account Switch Service instead.

- **Fast imports**: pick every statement at once. Files are read in parallel on the phone and checked against the printed balances; if they add up, no AI is needed. Only unverifiable or scanned PDFs go to Claude, as text (or page images), split into parts read in parallel. Accounts are matched by the last 4 digits of the account number.
- **Credit cards → £0**: cards are tracked separately from your debit/current accounts. See what you owe on each card, new card spending this month (goal £0, with a streak), and a payoff plan (highest interest or smallest balance first) that's set aside in your budget before fun money. Accounts that look like cards but were filed as current accounts are flagged.
- **Check my numbers**: see exactly which transactions make up a month's income and spending, per account, and fix the big ones in one tap (own transfer, refund, saving, not mine). Transfers between your own accounts are detected by matching amounts within 7 days, your name, "top up" wording, and banks you hold; savings-account movements never count as income or spending.
- **Duplicate cleanup**: payments are matched fuzzily (same amount, within 3 days, similar wording), so overlapping statements or a PDF + CSV of the same month don't double count, and any duplicates already saved can be removed in one tap.
- **Monthly check-in**: a 4-step routine (import every statement, sort "Other" transactions, review, plan next month).
- **Bills & subscriptions**: calendar of what's due and paid this month, annual cost, price rises, and a cancel list.
- **Wishlist**: save a "not right now" item; it's re-checked against your budget every time you open the page.

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
