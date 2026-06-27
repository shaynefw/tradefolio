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
  // 4:1 profit factor — the dataset's actual strategy uses a 1:4 win:loss
  // dollar ratio (e.g. +$80 per win, -$320 per loss). Computed against unit R
  // so it stays meaningful even before user supplies real dollar sizing.
  profitFactor41: number;
}

const valid = (t: BacktestTrade) => t.validEntry;
const winners = (t: BacktestTrade) => valid(t) && t.outcome === "Took Profit";
const losers = (t: BacktestTrade) => valid(t) && t.outcome === "Took Loss";

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

  // 1:4 dollar ratio — wins pay 1R, losses lose 4R, in unit R.
  const grossWinR = wins.length * 1;
  const grossLossR = losses.length * 4;
  const profitFactor41 = grossLossR > 0 ? grossWinR / grossLossR : grossWinR > 0 ? Infinity : 0;

  return {
    totalRows: ds.trades.length,
    validTrades: validTrades.length,
    invalidTrades: ds.trades.length - validTrades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: decisive > 0 ? wins.length / decisive : 0,
    longCount: longs.length,
    shortCount: shorts.length,
    longWinRate: longs.length > 0 ? longWins / longs.length : 0,
    shortWinRate: shorts.length > 0 ? shortWins / shorts.length : 0,
    maxWinStreak: streaks.maxWin,
    maxLossStreak: streaks.maxLoss,
    avgWinStreak: streaks.avgWin,
    avgMfeWinners: Math.round(mean(winnerMfes)),
    avgMaeWinners: Math.round(mean(winnerMaes)),
    avgMfeLosers: Math.round(mean(loserMfes)),
    avgMaeLosers: Math.round(mean(loserMaes)),
    profitFactor41,
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
    if (!t.validEntry || !t.outcome) continue;
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
    if (!t.validEntry || !t.outcome || t.tradeNo === 0) continue;
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
// Interpretation: a trade "reaches" an N-R level when its favorable excursion
// (MFE) hit at least N × brickPoints points before exit. With the spreadsheet's
// stop at 8R, this is a useful approximation of "could you have exited there?"
// — but the original sheet's PF/Ez$ columns appear to use a different
// closed-form that we don't yet have. Surface this as an approximation in the
// UI and we'll refine once the exact formula is shared.
// ---------------------------------------------------------------------------

export interface RrBucket {
  r: number;            // 1..5
  label: string;        // "1:1RR"
  hitCount: number;     // trades with MFE ≥ r × brick
  hitRate: number;      // hitCount / validDecisive
  ez: number;           // hitCount / (hitCount + remainingNotHit) — placeholder
  profitFactor: number; // hitCount × r / (validDecisive − hitCount) × stopBricks
}

export function computeRrBuckets(ds: BacktestDataset): RrBucket[] {
  const decisive = ds.trades.filter(
    (t) => t.validEntry && t.outcome != null,
  );
  const denom = decisive.length;
  const stop = ds.stopBricks;
  const buckets: RrBucket[] = [];

  for (let r = 1; r <= 5; r++) {
    const thresh = r * ds.brickPoints;
    const hitCount = decisive.filter((t) => (t.mfe ?? -Infinity) >= thresh).length;
    const miss = denom - hitCount;
    const grossWin = hitCount * r;
    const grossLoss = miss * stop;
    const pf = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;
    buckets.push({
      r,
      label: `1:${r}RR`,
      hitCount,
      hitRate: denom > 0 ? hitCount / denom : 0,
      ez: denom > 0 ? hitCount / denom : 0,
      profitFactor: pf,
    });
  }
  return buckets;
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
  const firsts = valid.filter((t) => t.recoveryStage === "first");
  const seconds = valid.filter((t) => t.recoveryStage === "second");
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
// We trust the source spreadsheet's per-row balance value when present rather
// than re-deriving from PnL (the source uses non-uniform sizing late in the
// dataset, which we want to preserve).
// ---------------------------------------------------------------------------

export interface ScalingPoint {
  index: number;       // ordinal in the scaling sequence (1-based for display)
  date: string;        // "Feb 27" — for x-axis ticks
  balance: number;
  pnl: number;
  label: string | null;
  isMilestone: boolean; // true when label is set
}

export interface ScalingSeries {
  start: number;
  end: number;
  netPnl: number;
  trades: number;
  maxBalance: number;
  minBalance: number;
  maxDrawdown: number;       // peak − trough in dollars
  maxDrawdownPercent: number; // % of peak
  milestones: number;        // count of labeled events
  points: ScalingPoint[];
}

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const formatShort = (d: Date) => `${MONTH[d.getMonth()]} ${d.getDate()}`;

export function computeScaling(
  ds: BacktestDataset,
  which: "premium" | "speed",
): ScalingSeries {
  const points: ScalingPoint[] = [];
  let netPnl = 0;
  let start = 0;
  let i = 1;
  for (const t of ds.trades) {
    const row = which === "premium" ? t.premium : t.speed;
    if (!row) continue;
    if (start === 0) start = row.balance - row.pnl;
    netPnl += row.pnl;
    points.push({
      index: i++,
      date: formatShort(t.date),
      balance: row.balance,
      pnl: row.pnl,
      label: row.label,
      isMilestone: row.label != null,
    });
  }

  if (points.length === 0) {
    return {
      start: 0,
      end: 0,
      netPnl: 0,
      trades: 0,
      maxBalance: 0,
      minBalance: 0,
      maxDrawdown: 0,
      maxDrawdownPercent: 0,
      milestones: 0,
      points,
    };
  }

  let maxBalance = -Infinity;
  let minBalance = Infinity;
  let peak = -Infinity;
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

  const milestones = points.filter((p) => p.isMilestone).length;

  return {
    start,
    end: points[points.length - 1].balance,
    netPnl,
    trades: points.length,
    maxBalance,
    minBalance,
    maxDrawdown: maxDd,
    maxDrawdownPercent: maxDdPct,
    milestones,
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
      (t) => t.validEntry && t.side === side && t.outcome != null,
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
