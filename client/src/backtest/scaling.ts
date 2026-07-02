// Scaling-schedule helpers. The schedule is an ordered list of levels; the
// "current level" for a given running balance is the highest one whose
// recommendedBalance ≤ balance. From that level + a trade outcome + recovery
// stage, we can compute the exact PnL the strategy prescribes for the trade.

import type { Outcome, RecoveryStage, ScalingLevel, ScalingSchedule } from "./types";

// The iRenko20 Real Money Scaling System from the user's spreadsheet.
// Two ladders (s* = Speed, P* = Premium) with matching profit/risk numbers
// except R2 risk (n/a for s levels, 5× R1 for P levels).
export const IRENKO20_SPEED_SCHEDULE: ScalingSchedule = [
  { name: "s1", recommendedBalance: 2560,    profitPerTrade: 80,   initialRisk: 320,   recovery1Risk: 1280,  recovery2Risk: null },
  { name: "s2", recommendedBalance: 5120,    profitPerTrade: 160,  initialRisk: 640,   recovery1Risk: 2560,  recovery2Risk: null },
  { name: "s3", recommendedBalance: 10240,   profitPerTrade: 320,  initialRisk: 1280,  recovery1Risk: 5120,  recovery2Risk: null },
  { name: "s4", recommendedBalance: 20480,   profitPerTrade: 640,  initialRisk: 2560,  recovery1Risk: 10240, recovery2Risk: null },
  { name: "s5", recommendedBalance: 40960,   profitPerTrade: 1280, initialRisk: 5120,  recovery1Risk: 20480, recovery2Risk: null },
  { name: "s6", recommendedBalance: 81920,   profitPerTrade: 2560, initialRisk: 10240, recovery1Risk: 40960, recovery2Risk: null },
  { name: "s7", recommendedBalance: 163840,  profitPerTrade: 5120, initialRisk: 20480, recovery1Risk: 81920, recovery2Risk: null },
];

export const IRENKO20_PREMIUM_SCHEDULE: ScalingSchedule = [
  { name: "P1", recommendedBalance: 12800,   profitPerTrade: 80,   initialRisk: 320,   recovery1Risk: 1280,  recovery2Risk: 6400 },
  { name: "P2", recommendedBalance: 25600,   profitPerTrade: 160,  initialRisk: 640,   recovery1Risk: 2560,  recovery2Risk: 12800 },
  { name: "P3", recommendedBalance: 51200,   profitPerTrade: 320,  initialRisk: 1280,  recovery1Risk: 5120,  recovery2Risk: 25600 },
  { name: "P4", recommendedBalance: 102400,  profitPerTrade: 640,  initialRisk: 2560,  recovery1Risk: 10240, recovery2Risk: 51200 },
  { name: "P5", recommendedBalance: 204800,  profitPerTrade: 1280, initialRisk: 5120,  recovery1Risk: 20480, recovery2Risk: 102400 },
  { name: "P6", recommendedBalance: 409600,  profitPerTrade: 2560, initialRisk: 10240, recovery1Risk: 40960, recovery2Risk: 204800 },
  { name: "P7", recommendedBalance: 819200,  profitPerTrade: 5120, initialRisk: 20480, recovery1Risk: 81920, recovery2Risk: 409600 },
];

// Returns the highest level whose recommendedBalance ≤ balance. When the
// balance is below the first threshold, returns null so the caller can
// fall back to manual entry.
export function findCurrentLevel(
  balance: number,
  schedule: ScalingSchedule | null,
): ScalingLevel | null {
  if (!schedule || schedule.length === 0) return null;
  const sorted = [...schedule].sort(
    (a, b) => a.recommendedBalance - b.recommendedBalance,
  );
  let current: ScalingLevel | null = null;
  for (const lvl of sorted) {
    if (balance >= lvl.recommendedBalance) current = lvl;
    else break;
  }
  // Fall back to the first level when balance is below the ladder — the
  // user is still trading at "starter" sizing while working toward the
  // first threshold.
  return current ?? sorted[0];
}

// PnL the strategy prescribes for this outcome + recovery combo, given the
// running balance at trade entry. Returns null when there's no schedule,
// balance is below the first level, or the level lacks the specific risk
// (e.g. R2 = "n/a" on a Speed level).
export function suggestedPnl(
  balance: number,
  schedule: ScalingSchedule | null,
  outcome: Outcome | null,
  recoveryStage: RecoveryStage,
): number | null {
  if (!outcome) return null;
  const level = findCurrentLevel(balance, schedule);
  if (!level) return null;
  if (outcome === "Took Profit") return level.profitPerTrade;
  // outcome === "Took Loss"
  if (recoveryStage === "none") return -level.initialRisk;
  if (recoveryStage === "first") return -level.recovery1Risk;
  // "second"
  return level.recovery2Risk != null ? -level.recovery2Risk : null;
}
