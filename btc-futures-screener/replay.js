#!/usr/bin/env node
/**
 * Replay past candles and show where the RSI/volume entry system would have
 * triggered: RSI(14) < 30 AND volume spike >= +200% vs its recent average.
 *
 * Walks the candles bar-by-bar and computes RSI/volume-spike at each bar using
 * only data up to and including that bar (no lookahead). An "entry" is the
 * first bar where the condition becomes true after not having been true on
 * the previous bar (so a multi-bar dip only counts as one entry, not one per
 * bar).
 *
 * Usage:
 *   node replay.js [--symbol=BTCUSDT] [--market=USDM] [--days=7] [--interval=1h]
 *                  [--rsiPeriod=14] [--volLookback=20] [--volThreshold=200] [--all]
 *
 * --all replays every BTC futures contract (like screener.js) instead of a
 * single symbol.
 *
 * Requires Node 18+ (uses global fetch). No API key needed - public market
 * data only.
 */

const { listBtcSymbols, resolveSymbolMeta, getKlines, rsi, volumeSpikePct } = require("./lib");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);

const SYMBOL = args.symbol || "BTCUSDT";
const MARKET = (args.market || "USDM").toUpperCase();
const DAYS = Number(args.days || 7);
const INTERVAL = args.interval || "1h";
const RSI_PERIOD = Number(args.rsiPeriod || 14);
const VOL_LOOKBACK = Number(args.volLookback || 20);
const VOL_THRESHOLD_PCT = Number(args.volThreshold || 200);
const SCAN_ALL = Boolean(args.all);

const INTERVAL_MS = {
  "1m": 60_000,
  "3m": 3 * 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "2h": 2 * 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "6h": 6 * 60 * 60_000,
  "8h": 8 * 60 * 60_000,
  "12h": 12 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "3d": 3 * 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
};

function requiredBars() {
  const intervalMs = INTERVAL_MS[INTERVAL];
  if (!intervalMs) throw new Error(`Unknown interval "${INTERVAL}"`);
  const barsInWindow = Math.ceil((DAYS * 24 * 60 * 60_000) / intervalMs);
  const warmupBars = Math.max(RSI_PERIOD, VOL_LOOKBACK) + 5;
  return { barsInWindow, warmupBars, total: Math.min(barsInWindow + warmupBars, 1500) };
}

async function replaySymbol(symMeta) {
  const { barsInWindow, warmupBars, total } = requiredBars();
  const klines = await getKlines(symMeta, { interval: INTERVAL, limit: total });

  if (klines.length < warmupBars + 1) {
    return { symbol: symMeta.symbol, market: symMeta.market, entries: [], error: "not enough history returned" };
  }

  const windowStartIdx = Math.max(0, klines.length - barsInWindow);
  const closes = klines.map((k) => k.close);
  const volumes = klines.map((k) => k.volume);

  const entries = [];
  let prevSignal = false;

  for (let i = 0; i < klines.length; i++) {
    if (i < Math.max(RSI_PERIOD, VOL_LOOKBACK)) continue;

    const rsiValue = rsi(closes.slice(0, i + 1), RSI_PERIOD);
    const volPct = volumeSpikePct(volumes.slice(0, i + 1), VOL_LOOKBACK);
    if (rsiValue === null || volPct === null) continue;

    const signal = rsiValue < 30 && volPct >= VOL_THRESHOLD_PCT;

    if (signal && !prevSignal && i >= windowStartIdx) {
      const forward4 = closes[i + 4] != null ? ((closes[i + 4] - closes[i]) / closes[i]) * 100 : null;
      const forwardToNow = ((closes[closes.length - 1] - closes[i]) / closes[i]) * 100;

      entries.push({
        time: new Date(klines[i].openTime).toISOString(),
        symbol: symMeta.symbol,
        market: symMeta.market,
        entryClose: closes[i],
        rsi: Number(rsiValue.toFixed(2)),
        volumeChangePct: Number(volPct.toFixed(1)),
        "+4barsPct": forward4 !== null ? Number(forward4.toFixed(2)) : "n/a",
        toNowPct: Number(forwardToNow.toFixed(2)),
      });
    }

    prevSignal = signal;
  }

  return { symbol: symMeta.symbol, market: symMeta.market, entries };
}

async function main() {
  console.log(
    `Replaying last ${DAYS} day(s) | interval=${INTERVAL} rsiPeriod=${RSI_PERIOD} ` +
      `volLookback=${VOL_LOOKBACK} volThreshold=+${VOL_THRESHOLD_PCT}%\n`
  );

  const targets = SCAN_ALL ? await listBtcSymbols() : [resolveSymbolMeta(SYMBOL, MARKET)];

  const allEntries = [];
  const errors = [];

  for (const sym of targets) {
    try {
      const { entries, error } = await replaySymbol(sym);
      if (error) errors.push({ symbol: sym.symbol, error });
      allEntries.push(...entries);
    } catch (err) {
      errors.push({ symbol: sym.symbol, error: err.message });
    }
  }

  allEntries.sort((a, b) => new Date(a.time) - new Date(b.time));

  if (allEntries.length === 0) {
    console.log("No entries: the system would not have triggered in this window.");
  } else {
    console.log(`${allEntries.length} entry signal(s) found:\n`);
    console.table(allEntries);
  }

  if (errors.length) {
    console.log(`\n${errors.length} symbol(s) failed:`);
    for (const e of errors) console.log(`  ${e.symbol}: ${e.error}`);
  }
}

main().catch((err) => {
  console.error("Replay failed:", err);
  process.exit(1);
});
