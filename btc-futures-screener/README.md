# BTC Futures RSI/Volume Screener

Finds BTC futures contracts on Binance where **RSI(14) < 30** and volume has
spiked **+200%** or more versus its recent average, at the same time.

Scans:
- USDT/USDC-margined BTC futures (perpetual + quarterly delivery) via `fapi.binance.com`
- Coin-margined BTC futures (perpetual + quarterly delivery) via `dapi.binance.com`

Two scripts share this logic (`lib.js`):

- `screener.js` - checks the condition right now, across all BTC futures contracts.
- `replay.js` - walks back over recent history and reports every bar where the
  condition would have triggered an entry (bar-by-bar, no lookahead).

## Usage

Requires Node.js 18+ and outbound network access to `fapi.binance.com` and
`dapi.binance.com` (no API key needed - public market data endpoints only).

### Live screen

```
node screener.js
```

Optional flags (defaults shown):

```
node screener.js --interval=1h --rsiPeriod=14 --volLookback=20 --volThreshold=200
```

- `--interval`: kline interval (e.g. `15m`, `1h`, `4h`, `1d`)
- `--rsiPeriod`: RSI lookback period (Wilder's smoothing)
- `--volLookback`: number of prior candles used to compute the baseline average volume
- `--volThreshold`: minimum % increase of current candle volume over that baseline to count as a "spike"

### Replay / backtest entries

```
node replay.js --symbol=BTCUSDT --market=USDM --days=7 --interval=1h
```

- `--symbol` / `--market`: which contract to replay (`market` is `USDM` or `COINM`); default `BTCUSDT` / `USDM`
- `--all`: replay every BTC futures contract instead of a single symbol
- `--days`: how many days back to look for entries (default 7, i.e. "last week")
- same `--interval` / `--rsiPeriod` / `--volLookback` / `--volThreshold` flags as the screener

For each entry it prints the bar's timestamp, price, RSI, volume spike %, and
two informational forward-return columns (`+4barsPct`, `toNowPct`) showing how
price moved after that entry - useful for judging whether the signal would
have been profitable. Those columns are computed only after the fact; they
play no part in the entry decision itself, so there's no lookahead bias in
the signal.

Consecutive bars that all satisfy the condition count as a single entry (the
first bar where it turns true) rather than one entry per bar.

## Definitions

- **RSI**: standard Wilder's RSI computed from candle close prices.
- **Volume spike**: `(currentVolume - avg(previous N volumes)) / avg(previous N volumes) * 100`,
  where N is `--volLookback`. A value of `200` means current volume is 3x the
  recent average.

## Note

This script could not be run live from the sandboxed environment that
generated it (outbound access to Binance's API was blocked by network
policy there). Run it from an environment with normal internet access to get
live results.
