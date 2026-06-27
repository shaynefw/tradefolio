// Source-of-truth wrapper for backtest datasets.
//
// Phase 1: a single bundled sample dataset (MNQ iRenko20). The sample CSV is
// imported as a raw string at build time via Vite's `?raw` query suffix.
//
// Phase 2 will add an "upload" source — the parser already accepts any text,
// so the only change will be a setUploadedCsv() setter and a UI dropdown.

import sampleCsv from "./sample/mnq.csv?raw";
import { parseBacktestCsv } from "./parser";
import type { BacktestDataset } from "./types";

let cached: BacktestDataset | null = null;

export function getBacktestDataset(): BacktestDataset {
  if (cached) return cached;
  cached = parseBacktestCsv(sampleCsv, {
    name: "MNQ Inverse Renko20 (sample)",
    source: "sample",
    brickPoints: 20,
    stopBricks: 8,
    takeProfitBricks: 2,
  });
  return cached;
}
