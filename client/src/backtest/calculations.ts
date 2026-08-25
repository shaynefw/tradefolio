// Pure metric computations over a parsed BacktestDataset.
// All functions are deterministic, allocation-light, and side-effect free, so
// the UI can wrap them in useMemo without surprises.

import type { BacktestDataset, BacktestTrade, Side } from "./types";

// ---------------------------------------------------------------------------
// Headline counts
// ---------------------------------------------------------------------------

export interface CoreSummary {
  totalRows: number;
  validTrades: number;
  invalidTrades: number;
  wins: number;
  losses: number;
  winRate: number;          // 0..1, of (wins + losses)
  longCount: number;
  shortCount: number;
  longWinRate: number;
  shortWinRate: number;
  maxWinStreak: number;
  maxLossStreak: number;
  avgWinStreak: number;
  avgMfeWinners: number;
  avgMaeWinners: number;
  avgMfeLosers: number;
  avgMaeLosers: number;
  // Profit factor derived from the dataset's own take-profit / stop distances:
  //   PF = (wins × TP) / (losses × stop)
  // so it self-adjusts to each strategy's reward:risk instead of assuming a
  // fixed ratio. tpPoints/slPoints/rewardRisk are surfaced so the UI can
  // label the card with the actual R:R.
  profitFactor: number;
  tpPoints: number; // effective TP — brick value (fixed) or avg winner (fluid)
  slPoints: number; // effective SL — brick value (fixed) or avg loser (fluid)
  tpFluid: boolean; // TP derived from average realized winner points
  slFluid: boolean; // SL derived from average realized loser points
  rewardRisk: number; // TP ÷ stop, e.g. 1.25 for 200/160
  // Kelly criterion — the bankroll fraction that maximizes long-run growth for
  // this win rate and payoff:
  //   f* = p − q/b     (p = win rate, q = 1−p, b = reward:risk)
  // Expressed as a fraction of account equity risked per trade. ≤ 0 means the
  // edge doesn't cover the payoff odds (bet nothing). Full Kelly is famously
  // aggressive — halfKelly is the practical figure most traders size from.
  kelly: number;
  halfKelly: number;
  // Average net wins per calendar month spanned (wins − losses ÷ months).
  // Matches the source spreadsheet's "Avg Net Wins/m".
  avgNetWinsPerMonth: number;
  monthsSpanned: number;
}

const valid = (t: BacktestTrade) => t.validEntry;
const winners = (t: BacktestTrade) => valid(t) && t.outcome === "Took Profit";
const losers = (t: BacktestTrade) => valid(t) && t.outcome === "Took Loss";
// Breakeven trades are closed but neither win nor loss — excluded from every
// win-rate denominator and contribute 0 to profit factor. Only TP/TL count.
const isDecisive = (t: BacktestTrade) =>
  t.outcome === "Took Profit" || t.outcome === "Took Loss";

const mean = (xs: number[]) =>
  xs.length === 0 ? 0 : xs.reduce((s, n) => s + n, 0) / xs.length;

export function computeCoreSummary(ds: BacktestDataset): CoreSummary {
  const validTrades = ds.trades.filter(valid);
  const wins = validTrades.filter((t) => t.outcome === "Took Profit");
  const losses = validTrades.filter((t) => t.outcome === "Took Loss");
  const decisive = wins.length + losses.length;
  const longs = validTrades.filter((t) => t.side === "LONG");
  const shorts = validTrades.filter((t) => t.side === "SHORT");
  const longWins = longs.filter((t) => t.outcome === "Took Profit").length;
  const shortWins = shorts.filter((t) => t.outcome === "Took Profit").length;
  const longDecisive = longs.filter(isDecisive).length;
  const shortDecisive = shorts.filter(isDecisive).length;

  const streaks = computeStreaks(validTrades);

  // Mean only over rows where the value was recorded — the source spreadsheet
  // leaves MAE/MFE blank rather than zero when there was no excursion, and its
  // AVERAGE formula skips blanks the same way.
  const nonNull = (xs: (number | null)[]) =>
    xs.filter((v): v is number => v != null);
  const winnerMfes = nonNull(wins.map((t) => t.mfe));
  const winnerMaes = nonNull(wins.map((t) => t.mae));
  const loserMfes = nonNull(losses.map((t) => t.mfe));
  const loserMaes = nonNull(losses.map((t) => t.mae));

  // Profit factor / reward:risk. In "fixed" mode TP and SL are the dataset's
  // brick distances. In "fluid" mode (exit-on-signal strategies with no set
  // target/stop) the effective TP is the average realized points on winners and
  // SL the average on losers — realized points per trade come from
  // `resultPoints`, falling back to MFE (win) / MAE (loss).
  const tpFluid = ds.tpMode === "fluid";
  const slFluid = ds.slMode === "fluid";
  const realized = (t: BacktestTrade, isWin: boolean): number | null => {
    const v = t.resultPoints ?? (isWin ? t.mfe : t.mae);
    return v == null ? null : Math.abs(v);
  };
  const winPts = nonNull(wins.map((t) => realized(t, true)));
  const lossPts = nonNull(losses.map((t) => realized(t, false)));
  const fixedTp = ds.takeProfitBricks * ds.brickPoints;
  const fixedSl = ds.stopBricks * ds.brickPoints;
  // Effective per-trade TP/SL used for R:R, Kelly and the card label.
  const tpPoints = tpFluid ? (winPts.length ? mean(winPts) : 0) : fixedTp;
  const slPoints = slFluid ? (lossPts.length ? mean(lossPts) : 0) : fixedSl;
  const rewardRisk = slPoints > 0 ? tpPoints / slPoints : 0;
  // Gross win/loss: sum actual realized points when fluid, else count × fixed.
  const grossWin = tpFluid
    ? winPts.reduce((s, v) => s + v, 0)
    : wins.length * fixedTp;
  const grossLoss = slFluid
    ? lossPts.reduce((s, v) => s + v, 0)
    : losses.length * fixedSl;
  const profitFactor =
    grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;

  // Span in distinct YYYY-MM buckets — partial months count as 1 month each,
  // mirroring how the source spreadsheet counts.
  const monthKeys = new Set<string>();
  for (const t of validTrades) {
    monthKeys.add(`${t.date.getFullYear()}-${t.date.getMonth()}`);
  }
  const monthsSpanned = monthKeys.size;
  const netWins = wins.length - losses.length;
  const avgNetWinsPerMonth = monthsSpanned > 0 ? netWins / monthsSpanned : 0;

  // Kelly: f* = p − q/b, using the same decisive-only win rate as the WR card
  // (breakevens excluded from both numerator and denominator). Clamped at 0 —
  // a negative Kelly means "no edge at these odds", not "bet the other way",
  // since the entry signal isn't reversible.
  const p = decisive > 0 ? wins.length / decisive : 0;
  const rawKelly =
    decisive > 0 && rewardRisk > 0 ? p - (1 - p) / rewardRisk : 0;
  const kelly = Math.max(0, rawKelly);

  return {
    totalRows: ds.trades.length,
    validTrades: validTrades.length,
    invalidTrades: ds.trades.length - validTrades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: decisive > 0 ? wins.length / decisive : 0,
    longCount: longs.length,
    shortCount: shorts.length,
    longWinRate: longDecisive > 0 ? longWins / longDecisive : 0,
    shortWinRate: shortDecisive > 0 ? shortWins / shortDecisive : 0,
    maxWinStreak: streaks.maxWin,
    maxLossStreak: streaks.maxLoss,
    avgWinStreak: streaks.avgWin,
    avgMfeWinners: Math.round(mean(winnerMfes)),
    avgMaeWinners: Math.round(mean(winnerMaes)),
    avgMfeLosers: Math.round(mean(loserMfes)),
    avgMaeLosers: Math.round(mean(loserMaes)),
    profitFactor,
    tpPoints,
    slPoints,
    tpFluid,
    slFluid,
    rewardRisk,
    kelly,
    halfKelly: kelly / 2,
    avgNetWinsPerMonth,
    monthsSpanned,
  };
}

// ---------------------------------------------------------------------------
// Streaks — walks the *valid decisive* sequence (skips invalid/non-decisive).
// ---------------------------------------------------------------------------

interface StreakResult {
  maxWin: number;
  maxLoss: number;
  avgWin: number;
}

export function computeStreaks(trades: BacktestTrade[]): StreakResult {
  let curWin = 0;
  let curLoss = 0;
  let maxWin = 0;
  let maxLoss = 0;
  const winStreaks: number[] = [];

  for (const t of trades) {
    if (t.outcome === "Took Profit") {
      if (curLoss > 0) {
        curLoss = 0;
      }
      curWin++;
      if (curWin > maxWin) maxWin = curWin;
    } else if (t.outcome === "Took Loss") {
      if (curWin > 0) {
        winStreaks.push(curWin);
        curWin = 0;
      }
      curLoss++;
      if (curLoss > maxLoss) maxLoss = curLoss;
    }
  }
  if (curWin > 0) winStreaks.push(curWin);

  return {
    maxWin,
    maxLoss,
    avgWin: winStreaks.length > 0 ? Math.round(mean(winStreaks)) : 0,
  };
}

// ---------------------------------------------------------------------------
// By hour of day
// ---------------------------------------------------------------------------

export interface HourBucket {
  hour: number;
  hourLabel: string; // "8:00 AM"
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
}

const HOUR_LABEL = (h: number) => {
  const period = h >= 12 ? "PM" : "AM";
  const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${display}:00 ${period}`;
};

export function computeByHour(ds: BacktestDataset): HourBucket[] {
  const map = new Map<number, HourBucket>();
  for (const t of ds.trades) {
    if (!t.validEntry || !isDecisive(t)) continue;
    const bucket =
      map.get(t.hour) ??
      ({
        hour: t.hour,
        hourLabel: HOUR_LABEL(t.hour),
        trades: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
      } as HourBucket);
    bucket.trades++;
    if (t.outcome === "Took Profit") bucket.wins++;
    else bucket.losses++;
    map.set(t.hour, bucket);
  }
  for (const b of map.values()) {
    b.winRate = b.trades > 0 ? b.wins / b.trades : 0;
  }
  return Array.from(map.values()).sort((a, b) => a.hour - b.hour);
}

// ---------------------------------------------------------------------------
// By trade number (T1..Tn) — intraday sequence position.
// ---------------------------------------------------------------------------

export interface TradeNoBucket {
  tradeNo: number;
  label: string; // "T1"
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  longWinRate: number;
  shortWinRate: number;
  longCount: number;
  shortCount: number;
}

export function computeByTradeNo(ds: BacktestDataset): TradeNoBucket[] {
  const map = new Map<number, TradeNoBucket>();
  for (const t of ds.trades) {
    if (!t.validEntry || !isDecisive(t) || t.tradeNo === 0) continue;
    const bucket =
      map.get(t.tradeNo) ??
      ({
        tradeNo: t.tradeNo,
        label: `T${t.tradeNo}`,
        trades: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        longWinRate: 0,
        shortWinRate: 0,
        longCount: 0,
        shortCount: 0,
      } as TradeNoBucket);
    bucket.trades++;
    if (t.outcome === "Took Profit") bucket.wins++;
    else bucket.losses++;
    if (t.side === "LONG") {
      bucket.longCount++;
      if (t.outcome === "Took Profit") {
        // accumulate wins; we'll divide later
        (bucket as { _lWins?: number })._lWins =
          ((bucket as { _lWins?: number })._lWins ?? 0) + 1;
      }
    } else {
      bucket.shortCount++;
      if (t.outcome === "Took Profit") {
        (bucket as { _sWins?: number })._sWins =
          ((bucket as { _sWins?: number })._sWins ?? 0) + 1;
      }
    }
    map.set(t.tradeNo, bucket);
  }
  for (const b of map.values()) {
    b.winRate = b.trades > 0 ? b.wins / b.trades : 0;
    const lw = (b as { _lWins?: number })._lWins ?? 0;
    const sw = (b as { _sWins?: number })._sWins ?? 0;
    b.longWinRate = b.longCount > 0 ? lw / b.longCount : 0;
    b.shortWinRate = b.shortCount > 0 ? sw / b.shortCount : 0;
    delete (b as { _lWins?: number })._lWins;
    delete (b as { _sWins?: number })._sWins;
  }
  return Array.from(map.values()).sort((a, b) => a.tradeNo - b.tradeNo);
}

// ---------------------------------------------------------------------------
// RR-bucket analysis (1:1RR … 1:5RR).
//
// A trade "counts" at level 1:NRR when its favorable excursion reached at
// least N times the strategy's stop distance — i.e. it would have hit a 1:N
// risk-reward target before the stop. So at brick=20 and stopBricks=8, the
// stop is 160 points and the 1:3RR threshold is 480 points of MFE.
//
//   tradeCount = |{ valid trades : MFE ≥ N × stopPoints }|
//   winRate    = tradeCount / validTrades
//   ez         = 1 − winRate   ("easy" exits — trades that didn't push that far)
//
// Matches the source spreadsheet within rounding (sheet rounds to whole %).
// ---------------------------------------------------------------------------

export interface RrBucket {
  ratio: number;      // tpPoints / stopPoints (e.g. 1, 2, 3 → "1:1RR", "1:2RR")
  label: string;      // "1:2RR" — formatted from the ratio
  tpPoints: number;
  stopPoints: number;
  tradeCount: number; // trades whose MFE met or exceeded tpPoints
  winRate: number;    // tradeCount / total valid
  ez: number;         // 1 − winRate
  fluidStop: boolean; // stopPoints came from the fluid average, not a fixed stop
}

// Effective stop distance in points: the fixed brick stop, or — when the
// dataset's SL is fluid — the average realized loss (|resultPoints| ?? |MAE|).
// Falls back to the brick stop when there are no losses to average yet, so a
// fresh fluid dataset still produces a sensible ladder. Returns whether the
// fluid average was actually used so the UI can label it.
export function effectiveStopPoints(ds: BacktestDataset): {
  stopPoints: number;
  fluid: boolean;
} {
  const brickStop = ds.stopBricks * ds.brickPoints;
  if (ds.slMode !== "fluid") return { stopPoints: brickStop, fluid: false };
  const lossPts = ds.trades
    .filter((t) => t.validEntry && t.outcome === "Took Loss")
    .map((t) => {
      const v = t.resultPoints ?? t.mae;
      return v == null ? null : Math.abs(v);
    })
    .filter((v): v is number => v != null);
  if (lossPts.length === 0) return { stopPoints: brickStop, fluid: false };
  const avg = lossPts.reduce((s, v) => s + v, 0) / lossPts.length;
  return { stopPoints: avg, fluid: true };
}

// Formats a numeric ratio as "1:N" — uses up to 2 decimals so user-chosen
// ratios like 2.5 still display readably.
function formatRrLabel(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return "—";
  const rounded = Math.abs(ratio - Math.round(ratio)) < 0.005
    ? String(Math.round(ratio))
    : ratio.toFixed(2).replace(/\.?0+$/, "");
  return `1:${rounded}RR`;
}

// Default ladder when the dataset hasn't customized buckets: 1:NRR rows where
// the target = N × the effective stop. For a fluid-SL dataset that stop is the
// average realized loss, so the ladder reads as multiples of real average risk.
function defaultRrBuckets(stopPoints: number) {
  return Array.from({ length: 5 }, (_, i) => ({
    tpPoints: (i + 1) * stopPoints,
    stopPoints,
  }));
}

export function computeRrBuckets(ds: BacktestDataset): RrBucket[] {
  const valid = ds.trades.filter((t) => t.validEntry);
  const denom = valid.length;
  const { stopPoints: effStop, fluid } = effectiveStopPoints(ds);
  // Custom buckets are respected verbatim (they carry their own stops); only
  // the auto ladder adapts to the fluid average.
  const usingCustom = !!(ds.rrBuckets && ds.rrBuckets.length > 0);
  const configs = usingCustom ? ds.rrBuckets! : defaultRrBuckets(effStop);

  return configs.map((c) => {
    const tradeCount = valid.filter(
      (t) => (t.mfe ?? -Infinity) >= c.tpPoints,
    ).length;
    const winRate = denom > 0 ? tradeCount / denom : 0;
    const ratio = c.stopPoints > 0 ? c.tpPoints / c.stopPoints : 0;
    return {
      ratio,
      label: formatRrLabel(ratio),
      tpPoints: c.tpPoints,
      stopPoints: c.stopPoints,
      tradeCount,
      winRate,
      ez: 1 - winRate,
      fluidStop: fluid && !usingCustom,
    };
  });
}

// ---------------------------------------------------------------------------
// Target ladder ("what if my TP were X?").
//
// For a fixed stop, sweep a set of take-profit levels and, for each, model a
// "hold to target" rule from the recorded excursions: a trade is a win if its
// favorable excursion (MFE) reached the target before the stop could fire, and
// a loss otherwise. This is the corrected version of the reach table — it turns
// each candidate TP into a hit rate, the win rate you'd *need* to break even at
// that TP:stop ratio, and the expected value per trade in points.
//
// Encoding note (matches the source spreadsheet): a blank/"—" MFE means the
// favorable excursion never reached one brick, i.e. MFE < brickPoints — NOT
// missing data. We treat it as 0, so such trades never clear a target.
//
// Path caveat: MFE alone can't prove the target was reached *before* the stop.
// When a trade's adverse excursion (MAE) also reached the stop, the order is
// unknowable from this data, so we flag it as `ambiguous` and (conservatively)
// do NOT count it as a win. Forward-testing the actual TP resolves these.
// ---------------------------------------------------------------------------

export interface TargetRung {
  tpPoints: number;
  stopPoints: number;
  hits: number;        // trades whose MFE reached tpPoints (clean, non-ambiguous)
  ambiguous: number;   // reached tpPoints but MAE also reached stop — order unknown
  losses: number;      // never reached tpPoints
  total: number;
  hitRate: number;     // hits / total
  breakevenWinRate: number; // stop / (stop + tp) — WR needed for EV = 0
  evPoints: number;    // expected value per trade, in points, at this TP
  positive: boolean;   // evPoints > 0
}

// Default TP levels for the ladder: multiples of one brick, capped near the
// stop. At brick=20 this yields 20 / 40 / 60 / 100 / 160 — the levels the user
// asked to sweep. Always includes the strategy's own TP if it's set.
function defaultTargetLevels(ds: BacktestDataset): number[] {
  const brick = ds.brickPoints > 0 ? ds.brickPoints : 20;
  const stop = ds.stopBricks * ds.brickPoints;
  const base = [1, 2, 3, 5, 8].map((m) => m * brick).filter((p) => p <= stop);
  const own = (ds.takeProfitBricks ?? 0) * ds.brickPoints;
  const set = new Set(base);
  if (own > 0) set.add(own);
  return Array.from(set).sort((a, b) => a - b);
}

export function computeTargetLadder(
  ds: BacktestDataset,
  levels?: number[],
): TargetRung[] {
  const valid = ds.trades.filter((t) => t.validEntry);
  const total = valid.length;
  const stopPoints = ds.stopBricks * ds.brickPoints;
  const tps = levels && levels.length > 0 ? levels : defaultTargetLevels(ds);

  return tps.map((tp) => {
    let hits = 0;
    let ambiguous = 0;
    let losses = 0;
    for (const t of valid) {
      const mfe = t.mfe ?? 0; // "—" ⇒ < 1 brick ⇒ treat as 0
      if (mfe >= tp) {
        // Reached the target. If MAE also reached the stop, path order is
        // unknown → ambiguous; otherwise a clean hit.
        const mae = t.mae ?? (t.outcome === "Took Loss" ? stopPoints : 0);
        if (stopPoints > 0 && mae >= stopPoints) ambiguous += 1;
        else hits += 1;
      } else {
        losses += 1;
      }
    }
    const decided = total; // ambiguous trades stay in the denominator as non-wins
    const hitRate = decided > 0 ? hits / decided : 0;
    const breakevenWinRate =
      stopPoints + tp > 0 ? stopPoints / (stopPoints + tp) : 0;
    const evPoints = hitRate * tp - (1 - hitRate) * stopPoints;
    return {
      tpPoints: tp,
      stopPoints,
      hits,
      ambiguous,
      losses,
      total,
      hitRate,
      breakevenWinRate,
      evPoints,
      positive: evPoints > 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Recovery metrics. The source spreadsheet annotates each re-entry trade with
// either "recovery" (first attempt after a paper loss) or "recovery 2" (second
// attempt after the first recovery itself failed). The dashboard's headline
// Recovery WR % is computed across *all* recoveries; Recovery2 WR % is the
// success rate of the second-attempt subset only.
// ---------------------------------------------------------------------------

export interface RecoveryStats {
  // First-recovery attempts only.
  firstCount: number;
  firstWins: number;
  firstWinRate: number;
  // Second-recovery attempts (re-attempt after a first-recovery loss).
  secondCount: number;
  secondWins: number;
  secondWinRate: number;
  // All recoveries combined — matches the spreadsheet's "Recovery WR %".
  totalCount: number;
  totalWins: number;
  totalWinRate: number;
}

export function computeRecoveryStats(ds: BacktestDataset): RecoveryStats {
  const valid = ds.trades.filter((t) => t.validEntry);
  const firsts = valid.filter((t) => t.recoveryStage === "first" && isDecisive(t));
  const seconds = valid.filter((t) => t.recoveryStage === "second" && isDecisive(t));
  const firstWins = firsts.filter((t) => t.outcome === "Took Profit").length;
  const secondWins = seconds.filter((t) => t.outcome === "Took Profit").length;
  const totalCount = firsts.length + seconds.length;
  const totalWins = firstWins + secondWins;
  return {
    firstCount: firsts.length,
    firstWins,
    firstWinRate: firsts.length > 0 ? firstWins / firsts.length : 0,
    secondCount: seconds.length,
    secondWins,
    secondWinRate: seconds.length > 0 ? secondWins / seconds.length : 0,
    totalCount,
    totalWins,
    totalWinRate: totalCount > 0 ? totalWins / totalCount : 0,
  };
}

// ---------------------------------------------------------------------------
// Scaling progressions — drive the Premium/Speed charts and balance tables.
//
// Each ScalingSeries walks the trades from the dataset's startBalance,
// applying each trade's pnl. When a trade carries a manual resetBalance, the
// running balance jumps to that value before applying pnl — used by the user
// to recover from a blown account. A "blow" is the first trade whose post-pnl
// balance hits ≤ 0; the series records it so the UI can highlight it.
// ---------------------------------------------------------------------------

export interface ScalingPoint {
  index: number;       // ordinal in the scaling sequence (1-based for display)
  date: string;        // "Feb 27" — for x-axis ticks
  balance: number;     // computed running balance after this trade
  pnl: number;
  label: string | null;
  isMilestone: boolean; // true when label is set
  isReset: boolean;     // true when this trade carried a manual balance reset
}

export interface BlowEvent {
  index: number;       // 1-based scaling-sequence position
  date: string;        // formatted date label
  balance: number;     // post-pnl balance at the blow point (≤ 0)
}

export interface ScalingSeries {
  tracked: boolean;       // true when startBalance is set on the dataset
  start: number;
  end: number;
  netPnl: number;
  trades: number;
  maxBalance: number;
  minBalance: number;
  maxDrawdown: number;       // peak − trough in dollars
  maxDrawdownPercent: number; // % of peak
  milestones: number;        // count of labeled events
  resetCount: number;        // manual balance resets in this series
  firstBlow: BlowEvent | null;
  blows: BlowEvent[];        // all blow events (rare; typically 0 or 1)
  points: ScalingPoint[];
}

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const formatShort = (d: Date) => `${MONTH[d.getMonth()]} ${d.getDate()}`;

function emptySeries(tracked: boolean, start: number): ScalingSeries {
  return {
    tracked,
    start,
    end: start,
    netPnl: 0,
    trades: 0,
    maxBalance: start,
    minBalance: start,
    maxDrawdown: 0,
    maxDrawdownPercent: 0,
    milestones: 0,
    resetCount: 0,
    firstBlow: null,
    blows: [],
    points: [],
  };
}

export function computeScaling(
  ds: BacktestDataset,
  which: "premium" | "speed",
): ScalingSeries {
  const startBalance =
    which === "premium" ? ds.premiumStartBalance : ds.speedStartBalance;
  if (startBalance == null) {
    return emptySeries(false, 0);
  }

  const points: ScalingPoint[] = [];
  const blows: BlowEvent[] = [];
  let balance = startBalance;
  let netPnl = 0;
  let i = 1;
  let resetCount = 0;
  // "Blown" is sticky until either a reset or a new high above 0 resets it.
  // We require a reset to clear it so an account that recovers from a tiny
  // overshoot still shows a single blow marker — that matches how a trader
  // would think about it.
  let blownSticky = false;

  for (const t of ds.trades) {
    const reset =
      which === "premium" ? t.premiumResetBalance : t.speedResetBalance;
    const scaling = which === "premium" ? t.premium : t.speed;
    const pnl = scaling?.pnl ?? 0;
    const label = scaling?.label ?? null;

    const isReset = reset != null;
    if (isReset) {
      // Reset declares "the running balance after this trade is exactly X"
      // — the trade's PnL is still recorded for stats but doesn't move the
      // balance. This matches the "I blew up, here's my new starting point"
      // mental model.
      balance = reset;
      blownSticky = balance <= 0;
      resetCount++;
    } else {
      balance += pnl;
      if (!blownSticky && balance <= 0) {
        blows.push({
          index: i,
          date: formatShort(t.date),
          balance,
        });
        blownSticky = true;
      }
    }
    netPnl += pnl;

    points.push({
      index: i++,
      date: formatShort(t.date),
      balance,
      pnl,
      label,
      isMilestone: label != null,
      isReset,
    });
  }

  if (points.length === 0) {
    return emptySeries(true, startBalance);
  }

  let maxBalance = -Infinity;
  let minBalance = Infinity;
  let peak = startBalance;
  let maxDd = 0;
  let maxDdPct = 0;
  for (const p of points) {
    if (p.balance > maxBalance) maxBalance = p.balance;
    if (p.balance < minBalance) minBalance = p.balance;
    if (p.balance > peak) peak = p.balance;
    const dd = peak - p.balance;
    if (dd > maxDd) {
      maxDd = dd;
      maxDdPct = peak > 0 ? (dd / peak) * 100 : 0;
    }
  }

  return {
    tracked: true,
    start: startBalance,
    end: points[points.length - 1].balance,
    netPnl,
    trades: points.length,
    maxBalance,
    minBalance,
    maxDrawdown: maxDd,
    maxDrawdownPercent: maxDdPct,
    milestones: points.filter((p) => p.isMilestone).length,
    resetCount,
    firstBlow: blows[0] ?? null,
    blows,
    points,
  };
}

// ---------------------------------------------------------------------------
// Long / short split — separate counts and WR.
// ---------------------------------------------------------------------------

export interface SideSummary {
  side: Side;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
}

export function computeBySide(ds: BacktestDataset): SideSummary[] {
  const out: SideSummary[] = (["LONG", "SHORT"] as Side[]).map((side) => {
    const rows = ds.trades.filter(
      (t) => t.validEntry && t.side === side && isDecisive(t),
    );
    const wins = rows.filter((t) => t.outcome === "Took Profit").length;
    const losses = rows.length - wins;
    return {
      side,
      trades: rows.length,
      wins,
      losses,
      winRate: rows.length > 0 ? wins / rows.length : 0,
    };
  });
  return out;
}
