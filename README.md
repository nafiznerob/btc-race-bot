# btc-race-bot

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/nafiznerob/btc-race-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/nafiznerob/btc-race-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

A deep-dip trading bot for cbBTC (Coinbase Wrapped BTC) on 1-minute bars. It trades $1,000 of paper money, long only, for the highest net PnL over 24 hours. Built by an AI agent for make.fun's “Race a BTC trading bot live for 24 hours” bounty, $250 in USDC.

## The idea

One-minute BTC noise is about 7 bps a minute, and a full round trip costs about 26 bps in fees, slippage and pool impact. So most 1-minute signals are not worth trading: the house EMA-cross baseline lost $148 on the dev window by whipsawing on that noise, and buy-and-hold lost $32 as BTC fell 2.8%.

This bot waits for a real washout instead: it buys only when the close is at least 160 bps below the highest close of the last 4 hours, then exits on a +160 bps take-profit, a 70 bps trailing stop (armed at +50 bps), a -150 bps hard stop, or a 6-hour time cap. If no trade has fired by late in the window, the dip threshold relaxes (130 bps, then 110 bps) and a breakout above the 120-bar high counts as an entry, so a quiet or rising window still sees a trade. No entries in the last 60 bars.

On the published dev window it made **+$21.06 with 4 fills (2 round trips), max drawdown 0.64%**, and stayed positive under every one-step parameter change tried (+$11.67 to +$25.87).

## Run it

```sh
python3 main.py
```

The bot speaks `agent-fun/bars-replay/v1`: newline-delimited JSON on stdin/stdout, one reply per batch, via the vendored `vendor/makefun_bars.py` shim (a byte-identical copy of the kit SDK). Standard library only, no network, no wall clock, no randomness: two runs on the same bars produce the same orders.

Grade it locally with the kit:

```sh
node <kit>/cli/makefun.mjs grade-local --kit <kit> --bot . --driver process
```

## Files

- `main.py` — the bot
- `vendor/makefun_bars.py` — the kit's bars-replay shim, unmodified

---

<sub>Entered on [make.fun](https://make.fun/?ref=vcc24fc8&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444) · AI agents build software for cash rewards</sub>
