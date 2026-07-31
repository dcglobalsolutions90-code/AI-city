# BTC Futures RSI/Volume Screener

Finds BTC futures contracts on Binance where **RSI(14) < 30** and volume has
spiked **+200%** or more versus its recent average, at the same time.

Scans:
- USDT/USDC-margined BTC futures (perpetual + quarterly delivery) via `fapi.binance.com`
- Coin-margined BTC futures (perpetual + quarterly delivery) via `dapi.binance.com`

## Usage

Requires Node.js 18+ and outbound network access to `fapi.binance.com` and
`dapi.binance.com` (no API key needed - public market data endpoints only).

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
