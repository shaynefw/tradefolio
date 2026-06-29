// Sources of truth for backtest datasets.
//
// The bundled MNQ sample is used only to populate a brand-new user-owned
// dataset via the "Load MNQ sample" button — the rendered Backtest page
// always reads from the server. That separation keeps the sample bundle out
// of any persistent state and gives us one editable surface from day one.

import sampleCsv from "./sample/mnq.csv?raw";
import { parseBacktestCsv } from "./parser";
import type {
  BacktestDataset,
  BacktestTrade,
  RecoveryStage,
  Side,
} from "./types";

// ---------------------------------------------------------------------------
// Sample seed
// ---------------------------------------------------------------------------

// Server-side input shape (a trimmed mirror of tradeCreateInput in
// server/routers/backtest.ts). Kept local to avoid pulling server zod types
// into the client bundle.
export interface SeedTradeInput {
  date: number; // ms since epoch
  time: string;
  side: Side;
  tradeNo: number;
  validEntry: boolean;
  outcome: "Took Profit" | "Took Loss" | null;
  mae: number | null;
  mfe: number | null;
  recoveryStage: RecoveryStage;
  premiumPnl: number | null;
  premiumBalance: number | null;
  premiumLabel: string | null;
  premiumResetBalance: number | null;
  speedPnl: number | null;
  speedBalance: number | null;
  speedLabel: string | null;
  speedResetBalance: number | null;
  notes: string | null;
}

export interface SampleSeed {
  premiumStartBalance: number | null;
  speedStartBalance: number | null;
  trades: SeedTradeInput[];
}

// Parse the bundled MNQ CSV into seed payloads ready for dataset.create —
// including the inferred starting balances so the new dataset is immediately
// ready to render its scaling charts.
export function buildSampleSeed(): SampleSeed {
  const parsed = parseBacktestCsv(sampleCsv, {
    name: "MNQ Inverse Renko20",
    source: "sample",
    brickPoints: 20,
    stopBricks: 8,
    takeProfitBricks: 2,
  });
  return {
    premiumStartBalance: parsed.premiumStartBalance,
    speedStartBalance: parsed.speedStartBalance,
    trades: parsed.trades.map((t) => ({
      date: t.date.getTime(),
      time: t.time,
      side: t.side,
      tradeNo: t.tradeNo,
      validEntry: t.validEntry,
      outcome: t.outcome,
      mae: t.mae,
      mfe: t.mfe,
      recoveryStage: t.recoveryStage,
      premiumPnl: t.premium?.pnl ?? null,
      premiumBalance: t.premium?.balance ?? null,
      premiumLabel: t.premium?.label ?? null,
      premiumResetBalance: null,
      speedPnl: t.speed?.pnl ?? null,
      speedBalance: t.speed?.balance ?? null,
      speedLabel: t.speed?.label ?? null,
      speedResetBalance: null,
      notes: null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Server → BacktestDataset transform
// ---------------------------------------------------------------------------

// What backtest.dataset.list returns per row (kept loose so we don't have to
// re-derive the tRPC RouterOutput type here — the page narrows as needed).
export interface ServerDatasetMeta {
  id: number;
  name: string;
  brickPoints: number;
  stopBricks: number;
  takeProfitBricks: number;
  premiumStartBalance: number | null;
  speedStartBalance: number | null;
}

// What backtest.trade.list returns per row.
export interface ServerTradeRow {
  id: number;
  datasetId: number;
  sequenceIdx: number;
  date: number; // ms
  time: string;
  side: Side;
  tradeNo: number;
  validEntry: boolean;
  outcome: "Took Profit" | "Took Loss" | null;
  mae: number | null;
  mfe: number | null;
  recoveryStage: RecoveryStage;
  premiumPnl: number | null;
  premiumBalance: number | null;
  premiumLabel: string | null;
  premiumResetBalance: number | null;
  speedPnl: number | null;
  speedBalance: number | null;
  speedLabel: string | null;
  speedResetBalance: number | null;
  notes: string | null;
}

function parseHourFromTime(time: string, fallbackDate: Date): number {
  // Accepts "9:00:00 AM" / "13:30" / etc. Falls back to the date's hour if
  // the time string can't be parsed (e.g. blank).
  const m = time.trim().match(/^(\d{1,2})(?::(\d{1,2}))?(?::\d{1,2})?\s*([AP]M)?$/i);
  if (!m) return fallbackDate.getHours();
  let h = Number(m[1]);
  const period = m[3]?.toUpperCase();
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return h;
}

export function serverRowToBacktestTrade(
  row: ServerTradeRow,
  index: number,
): BacktestTrade {
  const date = new Date(row.date);
  return {
    index,
    // Stash the server id so the UI can route edit/delete back to the right row.
    id: row.id,
    date,
    time: row.time,
    hour: parseHourFromTime(row.time, date),
    side: row.side,
    tradeNo: row.tradeNo,
    validEntry: row.validEntry,
    outcome: row.outcome,
    mae: row.mae,
    mfe: row.mfe,
    recoveryStage: row.recoveryStage,
    premium:
      // Even with no stored balance, a non-zero pnl still belongs to a
      // scaling row so the running-balance compute can pick it up. We
      // synthesize a balance=0 placeholder; the new computeScaling derives
      // the real balance from start + cumulative pnl.
      row.premiumPnl != null || row.premiumBalance != null
        ? {
            pnl: row.premiumPnl ?? 0,
            balance: row.premiumBalance ?? 0,
            label: row.premiumLabel,
          }
        : null,
    speed:
      row.speedPnl != null || row.speedBalance != null
        ? {
            pnl: row.speedPnl ?? 0,
            balance: row.speedBalance ?? 0,
            label: row.speedLabel,
          }
        : null,
    premiumResetBalance: row.premiumResetBalance,
    speedResetBalance: row.speedResetBalance,
    winStreakAt: null,
    lossStreakAt: null,
  };
}

export function buildDatasetFromServer(
  meta: ServerDatasetMeta,
  rows: ServerTradeRow[],
): BacktestDataset {
  return {
    id: meta.id,
    name: meta.name,
    source: "upload",
    brickPoints: meta.brickPoints,
    stopBricks: meta.stopBricks,
    takeProfitBricks: meta.takeProfitBricks,
    premiumStartBalance: meta.premiumStartBalance,
    speedStartBalance: meta.speedStartBalance,
    trades: rows.map(serverRowToBacktestTrade),
  };
}
