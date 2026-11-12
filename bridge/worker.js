// TradingView -> Trading 212 bridge (Cloudflare Worker)
// Receives TradingView webhook alerts and places orders through the Trading 212 Public API (beta).
// Safety rails: demo by default, kill switch, ticker allow-list, max order value,
// one position per ticker, daily order cap, automatic stop-loss after every buy.

const BASE = { demo: "https://demo.trading212.com", live: "https://live.trading212.com" };

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return json({ error: "POST only" }, 405);
    let alert;
    try { alert = await request.json(); } catch { return json({ error: "Body must be JSON" }, 400); }
    try {
      const result = await handleAlert(alert, env, fetch);
      return json(result, result.ok ? 200 : 400);
    } catch (err) {
      return json({ ok: false, error: String(err.message || err) }, 502);
    }
  },
};

export async function handleAlert(alert, env, fetchFn) {
  // 1. Authenticate the alert
  if (!env.WEBHOOK_SECRET || alert.token !== env.WEBHOOK_SECRET) return { ok: false, error: "Bad token" };

  // 2. Kill switch
  if (env.TRADING_ENABLED !== "true") return { ok: false, error: "Trading disabled (TRADING_ENABLED is not \"true\")" };

  // 3. Environment: demo unless LIVE is set explicitly
  const mode = env.T212_ENV === "live" ? "live" : "demo";
  if (mode === "live" && env.I_ACCEPT_LIVE_RISK !== "yes") return { ok: false, error: "Live mode needs I_ACCEPT_LIVE_RISK=yes" };

  // 4. Ticker allow-list, e.g. {"NVDA":"NVDA_US_EQ","INTC":"INTC_US_EQ"}
  const map = JSON.parse(env.TICKER_MAP || "{}");
  const tvTicker = String(alert.ticker || "").toUpperCase().split(":").pop();
  const t212Ticker = map[tvTicker];
  if (!t212Ticker) return { ok: false, error: `Ticker ${tvTicker} is not in TICKER_MAP` };

  const action = String(alert.action || "").toLowerCase();
  const price = Number(alert.price);
  const api = makeApi(mode, env, fetchFn);

  if (action === "buy") {
    if (!(price > 0)) return { ok: false, error: "Missing price" };

    // 5. Daily order cap
    const today = new Date().toISOString().slice(0, 10);
    const countKey = `orders:${today}`;
    const count = Number((env.STATE && (await env.STATE.get(countKey))) || 0);
    const dailyMax = Number(env.MAX_ORDERS_PER_DAY || 3);
    if (count >= dailyMax) return { ok: false, error: `Daily cap of ${dailyMax} buys reached` };

    // 6. One position per ticker
    const positions = await api.get("/api/v0/equity/portfolio");
    if (positions.some((p) => p.ticker === t212Ticker && Number(p.quantity) > 0)) {
      return { ok: false, error: `Already holding ${t212Ticker}; not adding` };
    }

    // 7. Size from a fixed cash amount, capped
    const maxValue = Math.min(Number(env.MAX_ORDER_VALUE || 25), Number(env.HARD_CAP_VALUE || 100));
    const quantity = Math.floor((maxValue / price) * 100) / 100; // 2 decimals
    if (!(quantity > 0)) return { ok: false, error: "Order value too small for one hundredth of a share" };

    const buy = await api.post("/api/v0/equity/orders/market", { ticker: t212Ticker, quantity });

    // 8. Protective stop right after the buy (short pause: order rate limit, and the buy must fill first)
    await sleep(2500);
    const stopPct = Number(env.STOP_PCT || 2) / 100;
    const stopPrice = Math.round(price * (1 - stopPct) * 100) / 100;
    let stop = null, stopError = null;
    try {
      stop = await api.post("/api/v0/equity/orders/stop", {
        ticker: t212Ticker, quantity: -quantity, stopPrice, timeValidity: "GOOD_TILL_CANCEL",
      });
    } catch (e) { stopError = String(e.message || e); }

    if (env.STATE) await env.STATE.put(countKey, String(count + 1), { expirationTtl: 172800 });
    return { ok: true, mode, action, ticker: t212Ticker, quantity, buy, stopPrice, stop, stopError,
             warning: stopError ? "BUY FILLED WITHOUT A STOP. Set one by hand in the app now." : undefined };
  }

  if (action === "exit") {
    const positions = await api.get("/api/v0/equity/portfolio");
    const pos = positions.find((p) => p.ticker === t212Ticker && Number(p.quantity) > 0);
    if (!pos) return { ok: true, mode, action, note: `No open ${t212Ticker} position` };

    // Cancel resting stop orders for this ticker first, so they cannot fire after the exit
    const orders = await api.get("/api/v0/equity/orders");
    for (const o of orders.filter((o) => o.ticker === t212Ticker)) {
      await api.del(`/api/v0/equity/orders/${o.id}`);
      await sleep(1500);
    }
    const sell = await api.post("/api/v0/equity/orders/market", { ticker: t212Ticker, quantity: -Number(pos.quantity) });
    return { ok: true, mode, action, ticker: t212Ticker, quantity: Number(pos.quantity), sell };
  }

  return { ok: false, error: `Unknown action "${action}" (use "buy" or "exit")` };
}

function makeApi(mode, env, fetchFn) {
  const auth = "Basic " + btoa(`${env.T212_API_KEY}:${env.T212_API_SECRET}`);
  const call = async (method, path, body) => {
    const res = await fetchFn(BASE[mode] + path, {
      method,
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  };
  return { get: (p) => call("GET", p), post: (p, b) => call("POST", p, b), del: (p) => call("DELETE", p) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
