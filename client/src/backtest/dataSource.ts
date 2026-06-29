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
  speedPnl: number | null;
  speedBalance: number | null;
  speedLabel: string | null;
  notes: string | null;
}

// Parse the bundled MNQ CSV into seed payloads ready for dataset.create.
export function buildSampleSeedTrades(): SeedTradeInput[] {
  const parsed = parseBacktestCsv(sampleCsv, {
    name: "MNQ Inverse Renko20",
    source: "sample",
    brickPoints: 20,
    stopBricks: 8,
    takeProfitBricks: 2,
  });
  return parsed.trades.map((t) => ({
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
    speedPnl: t.speed?.pnl ?? null,
    speedBalance: t.speed?.balance ?? null,
    speedLabel: t.speed?.label ?? null,
    notes: null,
  }));
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
  speedPnl: number | null;
  speedBalance: number | null;
  speedLabel: string | null;
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
      row.premiumBalance != null
        ? {
            pnl: row.premiumPnl ?? 0,
            balance: row.premiumBalance,
            label: row.premiumLabel,
          }
        : null,
    speed:
      row.speedBalance != null
        ? {
            pnl: row.speedPnl ?? 0,
            balance: row.speedBalance,
            label: row.speedLabel,
          }
        : null,
    winStreakAt: null,
    lossStreakAt: null,
  };
}

export function buildDatasetFromServer(
  meta: ServerDatasetMeta,
  rows: ServerTradeRow[],
): BacktestDataset {
  return {
    name: meta.name,
    source: "upload",
    brickPoints: meta.brickPoints,
    stopBricks: meta.stopBricks,
    takeProfitBricks: meta.takeProfitBricks,
    trades: rows.map(serverRowToBacktestTrade),
  };
}
