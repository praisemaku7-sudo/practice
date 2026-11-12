import { handleAlert } from "./worker.js";
const calls = [];
let portfolio = [];
const fakeFetch = async (url, opts) => {
  calls.push(`${opts.method} ${url.replace(/https:\/\/\w+\.trading212\.com/, "")} ${opts.body || ""}`);
  let body = {};
  if (url.endsWith("/portfolio")) body = portfolio;
  else if (url.endsWith("/equity/orders") && opts.method === "GET") body = [{ id: 7, ticker: "NVDA_US_EQ" }];
  else body = { id: 99, status: "NEW" };
  return { ok: true, status: 200, text: async () => JSON.stringify(body) };
};
const kv = new Map();
const env = { WEBHOOK_SECRET: "s", TRADING_ENABLED: "true", T212_API_KEY: "k", T212_API_SECRET: "x",
  TICKER_MAP: '{"NVDA":"NVDA_US_EQ"}', MAX_ORDER_VALUE: "25", MAX_ORDERS_PER_DAY: "1",
  STATE: { get: async (k) => kv.get(k), put: async (k, v) => kv.set(k, v) } };
const log = (n, r) => console.log(n, JSON.stringify(r));
log("bad token", await handleAlert({ token: "no", action: "buy", ticker: "NVDA", price: 166 }, env, fakeFetch));
log("not allowed", await handleAlert({ token: "s", action: "buy", ticker: "TSLA", price: 300 }, env, fakeFetch));
log("live blocked", await handleAlert({ token: "s", action: "buy", ticker: "NVDA", price: 166 }, { ...env, T212_ENV: "live" }, fakeFetch));
log("buy", await handleAlert({ token: "s", action: "buy", ticker: "NASDAQ:NVDA", price: 166.19 }, env, fakeFetch));
log("daily cap", await handleAlert({ token: "s", action: "buy", ticker: "NVDA", price: 166 }, env, fakeFetch));
portfolio = [{ ticker: "NVDA_US_EQ", quantity: 0.15 }];
log("exit", await handleAlert({ token: "s", action: "exit", ticker: "NVDA", price: 170 }, env, fakeFetch));
console.log(calls.join("\n"));
