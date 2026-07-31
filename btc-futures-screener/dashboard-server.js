#!/usr/bin/env node
/**
 * Live local dashboard for the BTC futures RSI/volume entry system.
 *
 * Serves a single-page dashboard on a local port. The server polls Binance
 * on an interval (default 60s) and caches the result; the page polls the
 * server (default 15s) and re-renders, so it stays live without a full
 * reload. A stale/error banner shows if Binance can't be reached, using the
 * last good data underneath it rather than blanking the page.
 *
 * Usage:
 *   node dashboard-server.js [--port=8787] [--symbol=BTCUSDT] [--market=USDM]
 *                             [--interval=1h] [--days=7] [--rsiPeriod=14]
 *                             [--volLookback=20] [--volThreshold=200]
 *                             [--refreshSeconds=60]
 *
 * Then open http://localhost:<port> (default 8787).
 *
 * Requires Node 18+ (uses global fetch). No API key needed - public market
 * data only.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const {
  listBtcSymbols, resolveSymbolMeta, getKlines, requiredBars, buildSeries, detectEntries,
} = require("./lib");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);

const PORT = Number(args.port || 8787);
const SYMBOL = args.symbol || "BTCUSDT";
const MARKET = (args.market || "USDM").toUpperCase();
const INTERVAL = args.interval || "1h";
const DAYS = Number(args.days || 7);
const RSI_PERIOD = Number(args.rsiPeriod || 14);
const VOL_LOOKBACK = Number(args.volLookback || 20);
const VOL_THRESHOLD = Number(args.volThreshold || 200);
const REFRESH_SECONDS = Number(args.refreshSeconds || 60);

const state = {
  series: null,
  windowStartIdx: 0,
  entries: [],
  liveMatches: [],
  lastUpdated: null,
  lastError: null,
  refreshing: false,
};

async function fetchMainSeries() {
  const symMeta = resolveSymbolMeta(SYMBOL, MARKET);
  const { barsInWindow, warmupBars, total } = requiredBars({
    interval: INTERVAL, days: DAYS, rsiPeriod: RSI_PERIOD, volLookback: VOL_LOOKBACK,
  });
  const klines = await getKlines(symMeta, { interval: INTERVAL, limit: total });
  if (klines.length < warmupBars + 1) throw new Error(`Not enough history returned for ${SYMBOL}`);

  const windowStartIdx = Math.max(0, klines.length - barsInWindow);
  const series = buildSeries(klines, { rsiPeriod: RSI_PERIOD, volLookback: VOL_LOOKBACK, volThreshold: VOL_THRESHOLD });
  const entries = detectEntries(series, { windowStartIdx });
  return { series, entries, windowStartIdx };
}

async function fetchLiveScreen() {
  const symbols = await listBtcSymbols();
  const limit = Math.max(RSI_PERIOD + 5, VOL_LOOKBACK + 5, 60);
  const matches = [];
  for (const sym of symbols) {
    try {
      const klines = await getKlines(sym, { interval: INTERVAL, limit });
      const series = buildSeries(klines, { rsiPeriod: RSI_PERIOD, volLookback: VOL_LOOKBACK, volThreshold: VOL_THRESHOLD });
      const i = series.signalSeries.length - 1;
      if (i >= 0 && series.signalSeries[i]) {
        matches.push({
          symbol: sym.symbol,
          market: sym.market,
          rsi: Number(series.rsiSeries[i].toFixed(2)),
          volumeChangePct: Number(series.volPctSeries[i].toFixed(1)),
          lastClose: series.closes[i],
        });
      }
    } catch (err) {
      // One bad symbol shouldn't sink the whole live screen.
    }
  }
  return matches;
}

async function refresh() {
  if (state.refreshing) return;
  state.refreshing = true;
  try {
    const [{ series, entries, windowStartIdx }, liveMatches] = await Promise.all([
      fetchMainSeries(),
      fetchLiveScreen(),
    ]);
    state.series = series;
    state.entries = entries;
    state.windowStartIdx = windowStartIdx;
    state.liveMatches = liveMatches;
    state.lastUpdated = new Date().toISOString();
    state.lastError = null;
  } catch (err) {
    state.lastError = err.message;
  } finally {
    state.refreshing = false;
  }
}

function payload() {
  return {
    meta: {
      symbol: SYMBOL, market: MARKET, interval: INTERVAL, days: DAYS,
      rsiPeriod: RSI_PERIOD, volLookback: VOL_LOOKBACK, volThreshold: VOL_THRESHOLD,
      refreshSeconds: REFRESH_SECONDS,
    },
    lastUpdated: state.lastUpdated,
    lastError: state.lastError,
    refreshing: state.refreshing,
    windowStartIdx: state.windowStartIdx,
    series: state.series,
    entries: state.entries,
    liveMatches: state.liveMatches,
  };
}

const DASHBOARD_HTML = fs.readFileSync(path.join(__dirname, "dashboard.html"));

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(DASHBOARD_HTML);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/data") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload()));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/refresh") {
    await refresh();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload()));
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`BTC futures dashboard: http://localhost:${PORT}`);
  console.log(
    `Tracking ${SYMBOL} (${MARKET}), ${INTERVAL} candles, ${DAYS}d window. ` +
      `Server refetches Binance every ${REFRESH_SECONDS}s.\n`
  );
  refresh();
  setInterval(refresh, REFRESH_SECONDS * 1000);
});
