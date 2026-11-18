// Deep-dip cbBTC bot for make.fun's "Race a BTC trading bot live for 24 hours".
//
// Strategy (long only, one asset CBBTC, $1,000 paper, 1-minute bars):
//   * Entries: buy a deep pullback, not a wiggle. A buy fires only when the
//     latest close sits at least 160 bps below the highest close of the last
//     240 bars (4 hours). A full round trip costs about 26 bps in fee,
//     slippage and pool impact, and 1-minute noise is only ~7 bps, so a
//     160 bps dip is one of the few pullbacks big enough to be worth trading.
//   * Patience insurance: if no trade has filled yet, the dip threshold
//     relaxes to 130 bps from scored bar 960 and 110 bps from bar 1200, and
//     from bar 1200 a breakout above the 120-bar high (by 15 bps) also
//     counts as an entry, so a quiet or steadily rising race window still
//     sees at least one trade (the race guardrail needs >= 1 trade).
//   * No entries in the last 60 scored bars: a position opened there would
//     be flattened almost at once and the fees would eat it.
//   * Exits, on the filled cost basis (the account the harness reports):
//     take profit at +160 bps, a trailing stop of 70 bps once the trade is
//     +50 bps up, a hard stop at -150 bps, and a 360-bar (6-hour) time cap.
//   * One position at a time, full cash on every entry, max slippage 100 bps.
//
// Why this shape: on the published dev window (BTC -2.8% over 24h) the
// house EMA-cross baseline lost $148 by whipsawing on 1-minute noise and
// buy-and-hold lost $32. The deep-dip rule made +$21.06 there with 4 fills
// (2 round trips), max drawdown 0.64%, and stayed positive under every
// one-step parameter change tried (+$11.67 to +$25.87). It trades rarely,
// only after a real washout, and lets the bounce pay for the round trip.
//
// Verified with the kit's local grader (grade-local, process driver):
// net PnL $21.064272, 4 trades, 0 rejected, max drawdown 0.64%,
// win rate 100%, net PnL at 2x fees $19.43, and the two runs reproduced
// byte for byte (deterministic).
//
// Determinism: no wall clock, no network, no randomness, no files outside
// the repository. Every decision comes from the bars the harness sent and
// the account it reports, so two runs on the same data give the same
// orders byte for byte. Prices are compared as bigints (raw, price_scale 5)
// so no float rounding can flip a threshold.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch, OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// --- tuned constants (bps unless noted) -------------------------------------
const HI_BARS = 240; // trailing-high window for the dip test (bars)
const HI_BARS_SHORT = 120; // trailing-high window for the breakout test (bars)
const DROP_BPS = 160n; // dip below the 240-bar high that triggers a buy
const DROP_LATE_BPS = 130n; // relaxed dip once the window is 2/3 gone, no trade yet
const DROP_LAST_BPS = 110n; // relaxed dip in the final quarter, no trade yet
const LATE_BAR = 960; // scored bar where the first relaxation starts
const LAST_BAR = 1200; // scored bar where the second relaxation starts
const BREAK_BPS = 15n; // breakout above the 120-bar high (insurance entry)
const NO_ENTRY_BAR = 1380; // no new entries from this scored bar on
const TAKE_BPS = 160n; // take profit, vs the filled cost basis
const ARM_BPS = 50n; // gain at which the trailing stop arms
const TRAIL_BPS = 70n; // trailing stop, vs the highest close since entry
const STOP_BPS = 150n; // hard stop loss, vs the filled cost basis
const HOLD_MAX = 360; // time cap, in bars
const MAX_SLIPPAGE_BPS = 100; // 1%: a fill that moved further than this is refused

const BPS = 10_000n;

/** Keeps the close history and the open trade's bookkeeping. */
class Bot {
  closes: bigint[] = []; // raw closes (price_scale 5), oldest first
  entryBar = -1; // scored bar the current position was opened on
  peak = 0n; // highest raw close seen while holding
  trades = 0; // entries that actually filled so far this run
  counted = false; // the current position has been counted already

  /** Bars of the scored window seen so far (warm-up bars don't count). */
  scoredBar(state: BarsState): number {
    return state.seq - state.warmupBars;
  }

  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    // Warm-up bars still build history (they are real bars before the
    // scored window); only orders are held back while warming up.
    for (const bar of batch.bars) {
      if (bar.symbol === SYMBOL) this.closes.push(BigInt(bar.c));
    }
    if (this.closes.length > HI_BARS) {
      this.closes.splice(0, this.closes.length - HI_BARS);
    }
    if (state.warmingUp || this.closes.length === 0) return [];

    const close = this.closes[this.closes.length - 1]!;
    const held = state.positions.get(SYMBOL);
    const barNo = this.scoredBar(state);

    if (held === undefined) {
      this.counted = false;
      return this.maybeBuy(state, close, barNo);
    }
    if (!this.counted) {
      // A buy sent on an earlier batch has filled: count the entry here,
      // from the account, so a rejected order never counts.
      this.trades += 1;
      this.counted = true;
    }
    return this.maybeSell(state, held, close, barNo);
  }

  maybeBuy(state: BarsState, close: bigint, barNo: number): OrderInput[] {
    if (barNo < HI_BARS || barNo >= NO_ENTRY_BAR) return [];
    if (this.closes.length < HI_BARS) return [];

    let hiLong = 0n;
    for (const c of this.closes) if (c > hiLong) hiLong = c;

    let drop = DROP_BPS;
    if (this.trades === 0) {
      if (barNo >= LAST_BAR) drop = DROP_LAST_BPS;
      else if (barNo >= LATE_BAR) drop = DROP_LATE_BPS;
    }

    let buy = (close * BPS) <= (hiLong * (BPS - drop));
    if (!buy && this.trades === 0 && barNo >= LAST_BAR) {
      // Grind-up insurance: a window with no 110+ bps dip at all still
      // needs a trade, so take a breakout above the 120-bar high.
      const recent = this.closes.slice(-HI_BARS_SHORT);
      let hiShort = 0n;
      for (let i = 0; i < recent.length - 1; i++) {
        if (recent[i]! > hiShort) hiShort = recent[i]!;
      }
      buy = hiShort > 0n && (close * BPS) >= (hiShort * (BPS + BREAK_BPS));
    }

    if (!buy || state.cash <= 0n) return [];
    this.entryBar = barNo;
    this.peak = close;
    return [{
      side: 'buy',
      symbol: SYMBOL,
      notional_quote_units: state.cash,
      max_slippage_bps: MAX_SLIPPAGE_BPS,
    }];
  }

  maybeSell(
    _state: BarsState,
    held: { qty: bigint; cost: bigint },
    close: bigint,
    barNo: number,
  ): OrderInput[] {
    if (close > this.peak) this.peak = close;
    // Value of the holding at this close, in micro-USDC (quote_scale 6):
    // qty is at qty_scale 8, close at price_scale 5.
    const value = (held.qty * close) / 10n ** 7n;
    const cost = held.cost;
    if (cost <= 0n || value <= 0n) return [];
    // Gain in bps, integer arithmetic: +160 means value is 1.6% over cost.
    const gainBps = ((value - cost) * BPS) / cost;

    let sell = false;
    if (gainBps >= TAKE_BPS) {
      sell = true;
    } else if (gainBps >= ARM_BPS && (close * BPS) <= (this.peak * (BPS - TRAIL_BPS))) {
      sell = true;
    } else if (gainBps <= -STOP_BPS) {
      sell = true;
    } else if (barNo - this.entryBar >= HOLD_MAX) {
      sell = true;
    }

    if (!sell) return [];
    this.entryBar = -1;
    this.peak = 0n;
    return [{
      side: 'sell',
      symbol: SYMBOL,
      qty: held.qty,
      max_slippage_bps: MAX_SLIPPAGE_BPS,
    }];
  }
}

const bot = new Bot();
await runBars({ onBatch: (state, batch) => bot.onBatch(state, batch) });
