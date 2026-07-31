// Shared helpers for the BTC futures screener + replay tools.
// Requires Node 18+ (uses global fetch). No API key needed - public market data only.

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

function resolveSymbolMeta(symbol, market) {
  if (market === "COINM") {
    return { symbol, market: "COINM", base: COINM_BASE, klinePath: "/dapi/v1/klines" };
  }
  return { symbol, market: "USDM", base: USDM_BASE, klinePath: "/fapi/v1/klines" };
}

async function getKlines({ base, klinePath, symbol }, { interval, limit, startTime, endTime }) {
  const params = new URLSearchParams({ symbol, interval, limit: String(limit) });
  if (startTime) params.set("startTime", String(startTime));
  if (endTime) params.set("endTime", String(endTime));
  const url = `${base}${klinePath}?${params.toString()}`;
  const raw = await getJson(url);
  // kline fields: [openTime, open, high, low, close, volume, closeTime, ...]
  return raw.map((k) => ({
    openTime: k[0],
    close: Number(k[4]),
    volume: Number(k[5]),
  }));
}

// Wilder's RSI. Returns the RSI value using closes[0..closes.length-1],
// i.e. only the data passed in - callers control lookahead by slicing first.
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

module.exports = { listBtcSymbols, resolveSymbolMeta, getKlines, rsi, volumeSpikePct };
