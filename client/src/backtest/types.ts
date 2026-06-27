// Domain types for the Backtesting product area.
//
// A BacktestTrade is one row of the raw trade log. ScalingRow is the per-trade
// snapshot of one of the two scaling strategies (Premium / Speed). A
// BacktestDataset is the parsed result handed off to the calculations engine
// and the UI.

export type Side = "LONG" | "SHORT";
export type Outcome = "Took Profit" | "Took Loss";

export interface ScalingRow {
  pnl: number;       // signed dollars credited on this trade
  balance: number;   // account balance AFTER this trade
  label: string | null; // e.g. "lossA", "Art1c", "Trade recov" — event marker
}

export interface BacktestTrade {
  index: number;          // 0-based position in the parsed sequence
  date: Date;             // entry date (midnight in local TZ)
  time: string;           // raw "9:00:00 AM" — kept verbatim for display
  hour: number;           // 0-23
  side: Side;
  tradeNo: number;        // intraday trade #, parsed from "T7" → 7
  validEntry: boolean;    // YES → true, NO/blank → false
  outcome: Outcome | null;
  mae: number | null;     // points; null when the CSV had "-"
  mfe: number | null;     // points
  isRecovery: boolean;    // the "Recovery" flag column
  premium: ScalingRow | null;
  speed: ScalingRow | null;
  // running streak counters as written by the source spreadsheet; only valid
  // for "YES" trades. Kept so we can prefer source-of-truth over recompute.
  winStreakAt: number | null;
  lossStreakAt: number | null;
}

export interface BacktestDataset {
  name: string;          // e.g. "MNQ Inverse Renko20 (sample)"
  source: "sample" | "upload";
  brickPoints: number;   // points per brick; 20 for this dataset
  stopBricks: number;    // 8 = 160 points
  takeProfitBricks: number; // 2 = 40 points
  trades: BacktestTrade[];
}
