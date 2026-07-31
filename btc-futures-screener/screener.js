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

const USDM_BASE = "https://fapi.binance.com";
const COINM_BASE = "https://dapi.binance.com";

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function listBtcSymbols() {
  const symbols = [];

  const usdm = await getJson(`${USDM_BASE}/fapi/v1/exchangeInfo`);
  for (const s of usdm.symbols) {
    if (s.baseAsset === "BTC" && s.status === "TRADING") {
      symbols.push({ symbol: s.symbol, market: "USDM", base: USDM_BASE, klinePath: "/fapi/v1/klines" });
    }
  }

  const coinm = await getJson(`${COINM_BASE}/dapi/v1/exchangeInfo`);
  for (const s of coinm.symbols) {
    if (s.baseAsset === "BTC" && s.contractStatus === "TRADING") {
      symbols.push({ symbol: s.symbol, market: "COINM", base: COINM_BASE, klinePath: "/dapi/v1/klines" });
    }
  }

  return symbols;
}

async function getKlines({ base, klinePath, symbol }) {
  const url = `${base}${klinePath}?symbol=${symbol}&interval=${INTERVAL}&limit=${KLINE_LIMIT}`;
  const raw = await getJson(url);
  // kline fields: [openTime, open, high, low, close, volume, closeTime, ...]
  return raw.map((k) => ({
    close: Number(k[4]),
    volume: Number(k[5]),
  }));
}

// Wilder's RSI
function rsi(closes, period) {
  if (closes.length < period + 1) return null;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function volumeSpikePct(volumes, lookback) {
  if (volumes.length < lookback + 1) return null;
  const current = volumes[volumes.length - 1];
  const window = volumes.slice(-lookback - 1, -1); // the `lookback` candles before current
  const avg = window.reduce((a, b) => a + b, 0) / window.length;
  if (avg === 0) return null;
  return ((current - avg) / avg) * 100;
}

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
      const klines = await getKlines(sym);
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
