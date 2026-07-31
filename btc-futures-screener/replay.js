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

const { listBtcSymbols, resolveSymbolMeta, getKlines, requiredBars, buildSeries, detectEntries } = require("./lib");

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

async function replaySymbol(symMeta) {
  const { barsInWindow, warmupBars, total } = requiredBars({
    interval: INTERVAL, days: DAYS, rsiPeriod: RSI_PERIOD, volLookback: VOL_LOOKBACK,
  });
  const klines = await getKlines(symMeta, { interval: INTERVAL, limit: total });

  if (klines.length < warmupBars + 1) {
    return { symbol: symMeta.symbol, market: symMeta.market, entries: [], error: "not enough history returned" };
  }

  const windowStartIdx = Math.max(0, klines.length - barsInWindow);
  const series = buildSeries(klines, { rsiPeriod: RSI_PERIOD, volLookback: VOL_LOOKBACK, volThreshold: VOL_THRESHOLD_PCT });

  const entries = detectEntries(series, { windowStartIdx }).map((e) => ({
    time: new Date(e.time).toISOString(),
    symbol: symMeta.symbol,
    market: symMeta.market,
    entryClose: e.close,
    rsi: Number(e.rsi.toFixed(2)),
    volumeChangePct: Number(e.volPct.toFixed(1)),
    "+4barsPct": e.f4 !== null ? Number(e.f4.toFixed(2)) : "n/a",
    toNowPct: Number(e.toNow.toFixed(2)),
  }));

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
