# TradingView → Trading 212 bridge

A Cloudflare Worker that receives alerts from the `VWAP Deviation Z` TradingView indicator
(`../tradingview/vwap_deviation_z.pine`) and places orders through the Trading 212 Public API (beta).

It starts on the **Trading 212 practice account**. Live orders need two settings changed on purpose.

## What it does

| Alert | Bridge action |
|---|---|
| `VWAP Z long` (`action: buy`) | Market buy worth `MAX_ORDER_VALUE`, then a stop-loss sell `STOP_PCT` below the alert price |
| `VWAP Z exit long` (`action: exit`) | Cancels open orders for that ticker, then market-sells the whole position |

Safety rails, all checked before any order:

- The alert must carry your `WEBHOOK_SECRET`.
- `TRADING_ENABLED` must be `"true"`. Set it to `"false"` and redeploy to stop everything.
- Demo unless `T212_ENV = "live"` **and** `I_ACCEPT_LIVE_RISK = "yes"`.
- Only tickers listed in `TICKER_MAP` can trade.
- Each buy is capped at `MAX_ORDER_VALUE`, which can never exceed `HARD_CAP_VALUE`.
- No second buy while a position in that ticker is open.
- At most `MAX_ORDERS_PER_DAY` buys per UTC day.
- Every buy is followed by a stop order. If the stop is rejected, the response says
  `BUY FILLED WITHOUT A STOP` and you must set one by hand.

## Setup

You need a Cloudflare account (free plan is enough), Node.js, and a TradingView plan that allows
webhook alerts.

1. **Trading 212 API key.** In the Trading 212 app: Settings → API (Beta) → generate a key on the
   **Practice** account first. Copy the key and the secret (the secret is shown once). Allow order
   placement, portfolio, account and orders permissions.
2. **Deploy the worker**, from this folder:
   ```sh
   npx wrangler login
   npx wrangler kv namespace create STATE      # paste the id into wrangler.toml
   npx wrangler secret put T212_API_KEY
   npx wrangler secret put T212_API_SECRET
   npx wrangler secret put WEBHOOK_SECRET      # any long random string you make up
   npx wrangler deploy
   ```
   Wrangler prints a URL like `https://tv-t212-bridge.<you>.workers.dev`.
3. **Edit `TICKER_MAP`** in `wrangler.toml` to the symbols you trade. Left side is the TradingView
   symbol, right side is the Trading 212 ticker (US stocks are usually `SYMBOL_US_EQ`; check the
   instrument list if an order is rejected). Redeploy after any change.
4. **TradingView alerts**, on each chart you want traded:
   - Add `VWAP Deviation Z`, then Alerts → Create → Condition: `VWAP Deviation Z` → `VWAP Z long`.
   - Trigger: *Once per bar close*.
   - Notifications → Webhook URL: your worker URL.
   - Message: keep the JSON, replace `CHANGE_ME` with your `WEBHOOK_SECRET`.
   - Repeat for `VWAP Z exit long`.

## Going live

Run on the practice account for several weeks first and compare its trades with the chart. Then:

1. Generate a key on the **live** account and replace both secrets.
2. In `wrangler.toml` set `T212_ENV = "live"` and `I_ACCEPT_LIVE_RISK = "yes"`.
3. Keep `MAX_ORDER_VALUE` small, then `npx wrangler deploy`.

## Known limits

- The Trading 212 API is in beta. Endpoint paths and stop-order fields in `worker.js` come from
  community docs and Trading 212's announcements, not a direct check of the official docs. Test on
  the practice account first; if an order is rejected, the error text is returned in the webhook
  response and in `npx wrangler tail`.
- Stop orders on that API are not idempotent; a retried alert can create a duplicate stop.
- Market orders slip. The stop becomes a market order when hit, so the fill can be worse than
  `STOP_PCT`, especially across an overnight gap or earnings.
- Fractional quantity is rounded down to 0.01 shares; some instruments allow less precision.

## Test locally

```sh
node test.mjs
```
Runs the bridge logic against a fake Trading 212 API and prints every request it would send.
