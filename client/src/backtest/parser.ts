// CSV parser for the spreadsheet-export format used by the iRenko20 backtest.
// Designed to also accept user uploads later (phase 2) — the row → trade mapping
// is the only piece tied to this specific layout.

import type {
  BacktestDataset,
  BacktestTrade,
  RecoveryStage,
  ScalingRow,
  Side,
  Outcome,
} from "./types";

// ---------------------------------------------------------------------------
// Generic CSV tokenizer — handles quoted fields with embedded commas/newlines
// (some cells in the source contain multi-line strategy notes).
// ---------------------------------------------------------------------------

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      // CRLF: skip the \n that follows \r
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }

  // flush the final field/row if the file doesn't end with a newline
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Field coercers
// ---------------------------------------------------------------------------

// Parse "$10,080.00" or "-$320.00" → number; blank → null.
function parseDollar(raw: string | undefined): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "-") return null;
  const neg = trimmed.startsWith("-");
  const stripped = trimmed.replace(/[-$,\s]/g, "");
  if (!stripped) return null;
  const n = Number(stripped);
  if (Number.isNaN(n)) return null;
  return neg ? -n : n;
}

// Parse "20" / "180" / "-" / "" → number | null
function parsePoints(raw: string | undefined): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "-") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

// Parse "T7" → 7
function parseTradeNo(raw: string | undefined): number {
  if (!raw) return 0;
  const m = raw.trim().match(/^T(\d+)$/i);
  return m ? Number(m[1]) : 0;
}

// Parse "2/17/2026" → Date at local midnight.
function parseDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  return new Date(year, month - 1, day);
}

// ---------------------------------------------------------------------------
// Row → BacktestTrade
// ---------------------------------------------------------------------------

// Build a ScalingRow when we have a balance. PnL may be blank on the very
// first scaling row (the "Trade recov" anchor), so default it to 0 there.
function buildScalingRow(
  pnlRaw: string | undefined,
  balanceRaw: string | undefined,
  labelRaw: string | undefined,
): ScalingRow | null {
  const balance = parseDollar(balanceRaw);
  if (balance == null) return null;
  const pnl = parseDollar(pnlRaw) ?? 0;
  const label = (labelRaw ?? "").trim() || null;
  return { pnl, balance, label };
}

function rowToTrade(row: string[], index: number): BacktestTrade | null {
  const date = parseDate(row[0]);
  if (!date) return null; // skip empty rows and trailing balance-only carry rows

  const time = (row[1] ?? "").trim();
  const sideRaw = (row[2] ?? "").trim().toUpperCase();
  const side: Side = sideRaw === "SHORT" ? "SHORT" : "LONG";
  const tradeNo = parseTradeNo(row[3]);
  const validEntry = (row[4] ?? "").trim().toUpperCase() === "YES";
  const mae = parsePoints(row[5]);
  const mfe = parsePoints(row[6]);

  const outcomeRaw = (row[7] ?? "").trim();
  const outcome: Outcome | null =
    outcomeRaw === "Took Profit"
      ? "Took Profit"
      : outcomeRaw === "Took Loss"
      ? "Took Loss"
      : null;

  // Recovery markers in the source sheet are free-form text — the same
  // logical state can appear as "Recovery", "recovery", or with a note
  // attached like "PA 12 recovery 2". Match on substring, and check
  // "recovery 2" first so first-recovery doesn't swallow second-recovery.
  const recoveryRaw = (row[8] ?? "").toLowerCase();
  const recoveryStage: RecoveryStage = recoveryRaw.includes("recovery 2")
    ? "second"
    : recoveryRaw.includes("recovery")
    ? "first"
    : "none";

  const premium = buildScalingRow(row[9], row[10], row[11]);
  const speed = buildScalingRow(row[12], row[13], row[14]);

  const hourRaw = (row[17] ?? "").trim();
  const hour = hourRaw ? Number(hourRaw) : new Date(`${row[0]} ${time}`).getHours();
  const winStreakAt = parsePoints(row[18]);
  const lossStreakAt = parsePoints(row[19]);

  return {
    index,
    date,
    time,
    hour: Number.isFinite(hour) ? hour : 0,
    side,
    tradeNo,
    validEntry,
    outcome,
    mae,
    mfe,
    resultPoints: null,
    recoveryStage,
    premium,
    speed,
    premiumResetBalance: null,
    speedResetBalance: null,
    notes: null,
    isPending: false,
    winStreakAt,
    lossStreakAt,
  };
}

// ---------------------------------------------------------------------------
// Top-level entry
// ---------------------------------------------------------------------------

export interface ParseOptions {
  name?: string;
  source?: "sample" | "upload";
  brickPoints?: number;
  stopBricks?: number;
  takeProfitBricks?: number;
}

export function parseBacktestCsv(
  csvText: string,
  opts: ParseOptions = {},
): BacktestDataset {
  const rows = parseCsv(csvText);
  // First row is the header. Subsequent rows are trades; ignore those that
  // lack a parseable date (trailing carry-forward rows in the source sheet).
  const trades: BacktestTrade[] = [];
  let idx = 0;
  for (let i = 1; i < rows.length; i++) {
    const trade = rowToTrade(rows[i], idx);
    if (trade) {
      trades.push(trade);
      idx++;
    }
  }

  // Derive starting balances from the first trade that has a balance
  // recorded in the source CSV. This gives the "Load MNQ sample" path a
  // sensible default ($10k / $3k) without the user having to enter it.
  const firstPremium = trades.find((t) => t.premium != null)?.premium;
  const firstSpeed = trades.find((t) => t.speed != null)?.speed;
  const premiumStartBalance = firstPremium
    ? firstPremium.balance - firstPremium.pnl
    : null;
  const speedStartBalance = firstSpeed
    ? firstSpeed.balance - firstSpeed.pnl
    : null;

  return {
    name: opts.name ?? "MNQ Inverse Renko20 (sample)",
    source: opts.source ?? "sample",
    brickPoints: opts.brickPoints ?? 20,
    stopBricks: opts.stopBricks ?? 8,
    takeProfitBricks: opts.takeProfitBricks ?? 2,
    tpMode: "fixed",
    slMode: "fixed",
    premiumStartBalance,
    speedStartBalance,
    notes: null,
    rrBuckets: null,
    premiumScalingSchedule: null,
    speedScalingSchedule: null,
    trades,
  };
}
