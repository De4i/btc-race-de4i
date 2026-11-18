import { runBars, type OrderInput } from './vendor/makefun-bars.ts';

// Connect only after a retraced 80-bar high breakout, then manage risk using close bars.
const symbol = 'CBBTC';
const closes: number[] = [];
const bps = (price: number, reference: number) => 10_000 * (price / reference - 1);
const min = (left: bigint, right: bigint) => left < right ? left : right;
let positionStarted = -1;
let lastExit = -100;
let peakPrice = 0;
let peakEquity = 0n;
let riskHalt = false;
let exitPending = false;

await runBars({
  onBatch(state, batch): OrderInput[] {
    const bar = batch.bars.find(item => item.symbol === symbol);
    if (!bar) return [];
    const close = Number(bar.c);
    const seq = batch.seq;
    closes.push(close);
    if (closes.length > 81) closes.shift();
    if (state.warmingUp) return [];

    const held = state.positions.get(symbol);
    peakEquity = state.equity > peakEquity ? state.equity : peakEquity;
    riskHalt ||= state.equity * 100n < peakEquity * 91n;

    if (held) {
      if (positionStarted < 0) {
        positionStarted = seq;
        peakPrice = close;
      }
      peakPrice = Math.max(peakPrice, close);
      const marked = state.value(symbol, held.qty);
      const gain = bps(Number(marked), Number(held.cost));
      const pullback = bps(close, peakPrice);
      exitPending ||= riskHalt || gain <= -65 || pullback <= -75 || seq - positionStarted >= 270;
      return exitPending ? [{ side: 'sell', symbol, qty: held.qty, max_slippage_bps: 240 }] : [];
    }

    if (positionStarted >= 0) lastExit = seq;
    positionStarted = -1;
    exitPending = false;
    if (riskHalt || closes.length < 81 || seq - lastExit < 16) return [];

    const previous = closes.slice(0, -1);
    const recentHigh = Math.max(...previous);
    const signal = close > recentHigh && bps(close, previous[0]) >= 30 &&
      bps(close, previous[previous.length - 25]) >= 10;
    if (!signal) return [];

    const notional = min(state.weightRoom(symbol), state.cash * 89n / 100n);
    if (notional < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    const impact = state.impactBps(symbol, notional);
    if (impact === null || impact > 22n) return [];
    return [{ side: 'buy', symbol, notional_quote_units: notional, max_slippage_bps: 48 }];
  },
});
