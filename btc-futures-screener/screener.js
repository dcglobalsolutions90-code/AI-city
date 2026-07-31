#!/usr/bin/env node
/**
 * BTC futures screener: RSI(14) < 30 AND volume spike >= +200% vs recent average.
 *
 * Scans every BTC-denominated futures contract on Binance (USDT/USDC-margined
 * perpetuals + quarterly delivery contracts via fapi.binance.com, and
 * coin-margined perpetuals + quarterly contracts via dapi.binance.com).
 *
 * Usage:
 *   node screener.js [--interval=1h] [--rsiPeriod=14] [--volLookback=20] [--volThreshold=200]
 *
 * Requires Node 18+ (uses global fetch). No API key needed - all endpoints used
 * are public market-data endpoints.
 */

const { listBtcSymbols, getKlines, rsi, volumeSpikePct } = require("./lib");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);

const INTERVAL = args.interval || "1h";
const RSI_PERIOD = Number(args.rsiPeriod || 14);
const VOL_LOOKBACK = Number(args.volLookback || 20);
const VOL_THRESHOLD_PCT = Number(args.volThreshold || 200);
const KLINE_LIMIT = Math.max(RSI_PERIOD + 5, VOL_LOOKBACK + 5, 60);

async function main() {
  console.log(
    `Scanning BTC futures contracts | interval=${INTERVAL} rsiPeriod=${RSI_PERIOD} ` +
      `volLookback=${VOL_LOOKBACK} volThreshold=+${VOL_THRESHOLD_PCT}%\n`
  );

  const symbols = await listBtcSymbols();
  console.log(`Found ${symbols.length} BTC futures contracts to check.\n`);

  const matches = [];
  const errors = [];

  for (const sym of symbols) {
    try {
      const klines = await getKlines(sym, { interval: INTERVAL, limit: KLINE_LIMIT });
      const closes = klines.map((k) => k.close);
      const volumes = klines.map((k) => k.volume);

      const rsiValue = rsi(closes, RSI_PERIOD);
      const volPct = volumeSpikePct(volumes, VOL_LOOKBACK);

      if (rsiValue === null || volPct === null) continue;

      if (rsiValue < 30 && volPct >= VOL_THRESHOLD_PCT) {
        matches.push({
          symbol: sym.symbol,
          market: sym.market,
          rsi: Number(rsiValue.toFixed(2)),
          volumeChangePct: Number(volPct.toFixed(1)),
          lastClose: closes[closes.length - 1],
        });
      }
    } catch (err) {
      errors.push({ symbol: sym.symbol, error: err.message });
    }
  }

  if (matches.length === 0) {
    console.log("No BTC futures contracts currently match RSI < 30 AND volume spike >= +200%.");
  } else {
    console.table(matches);
  }

  if (errors.length) {
    console.log(`\n${errors.length} symbol(s) failed to fetch:`);
    for (const e of errors) console.log(`  ${e.symbol}: ${e.error}`);
  }
}

main().catch((err) => {
  console.error("Screener failed:", err);
  process.exit(1);
});
