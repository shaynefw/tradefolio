// Domain types for the Backtesting product area.
//
// A BacktestTrade is one row of the raw trade log. ScalingRow is the per-trade
// snapshot of one of the two scaling strategies (Premium / Speed). A
// BacktestDataset is the parsed result handed off to the calculations engine
// and the UI.

export type Side = "LONG" | "SHORT";
export type Outcome = "Took Profit" | "Took Loss";

// Recovery stage of a single trade.
//   - "first":  the planned re-entry after a paper loss (the source spreadsheet
//               annotates these as "Recovery" or "<note> recovery").
//   - "second": the re-entry after a *failed* first recovery, annotated
//               "recovery 2" / "<note> recovery 2".
//   - "none":   regular trade.
export type RecoveryStage = "none" | "first" | "second";

export interface ScalingRow {
  pnl: number;       // signed dollars credited on this trade
  balance: number;   // account balance AFTER this trade
  label: string | null; // e.g. "lossA", "Art1c", "Trade recov" — event marker
}

export interface BacktestTrade {
  index: number;          // 0-based position in the parsed sequence
  id?: number;            // server id when sourced from the DB (undefined for sample-parse)
  date: Date;             // entry date (midnight in local TZ)
  time: string;           // raw "9:00:00 AM" — kept verbatim for display
  hour: number;           // 0-23
  side: Side;
  tradeNo: number;        // intraday trade #, parsed from "T7" → 7
  validEntry: boolean;    // YES → true, NO/blank → false
  outcome: Outcome | null;
  mae: number | null;     // points; null when the CSV had "-"
  mfe: number | null;     // points
  recoveryStage: RecoveryStage; // parsed from the spreadsheet's recovery col
  // Placeholder for an upcoming recovery — user reserves a row before the
  // trade fires. Combined with recoveryStage to indicate R1 vs R2 pending.
  isPending: boolean;
  premium: ScalingRow | null;
  speed: ScalingRow | null;
  // Per-trade manual balance reset for each scaling. Non-null means the
  // running-balance computation jumps to this value before applying this
  // trade's pnl — used by the user to recover from a blown account.
  premiumResetBalance: number | null;
  speedResetBalance: number | null;
  // Free-form per-trade notes.
  notes: string | null;
  // running streak counters as written by the source spreadsheet; only valid
  // for "YES" trades. Kept so we can prefer source-of-truth over recompute.
  winStreakAt: number | null;
  lossStreakAt: number | null;
}

export interface BacktestDataset {
  id?: number;           // server id; undefined when built from a bundled CSV
  name: string;          // e.g. "MNQ Inverse Renko20 (sample)"
  source: "sample" | "upload";
  brickPoints: number;   // points per brick; 20 for this dataset
  stopBricks: number;    // 8 = 160 points
  takeProfitBricks: number; // 2 = 40 points
  // Optional starting balances for each scaling. When set, the Scaling tab
  // walks trades from this base, applying each trade's pnl. null = the
  // scaling isn't being tracked for this dataset.
  premiumStartBalance: number | null;
  speedStartBalance: number | null;
  // Free-form notes the user keeps about how this backtest is tracked.
  notes: string | null;
  // User-customized RR buckets. Null = fall back to the default 1:NRR
  // ladder. Each bucket holds the take-profit and stop thresholds in
  // points; RR is derived as tpPoints / stopPoints.
  rrBuckets: RrBucketConfig[] | null;
  trades: BacktestTrade[];
}

export interface RrBucketConfig {
  tpPoints: number;
  stopPoints: number;
}
