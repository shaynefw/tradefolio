import { useMemo, useRef } from "react";
import { trpc } from "../lib/trpc";
import { useAccount } from "../contexts/AccountContext";
import { useDateRange } from "../contexts/DateRangeContext";
import { useStrategy } from "../contexts/StrategyContext";
import { cn, formatCurrency, formatDate, pnlColor } from "../lib/utils";
import DashboardLayout from "../components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Separator } from "../components/ui/separator";
import { ShareImageButton } from "../components/ShareImageButton";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
  ReferenceLine,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Activity,
  BarChart2,
  Loader2,
} from "lucide-react";
import { format, parseISO, getDay, getHours } from "date-fns";

// ---------------------------------------------------------------------------
// Custom Recharts tooltip
// ---------------------------------------------------------------------------

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number; name?: string }>;
  label?: string;
  labelFormatter?: (label: string) => string;
}

function DarkTooltip({ active, payload, label, labelFormatter }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const displayLabel = labelFormatter ? labelFormatter(label ?? "") : (label ?? "");
  return (
    <div className="rounded-lg border border-border bg-zinc-900 px-3 py-2 shadow-xl text-sm">
      {displayLabel && (
        <p className="text-muted-foreground mb-1">{displayLabel}</p>
      )}
      {payload.map((p, i) => (
        <p key={i} className={cn("font-semibold", p.value >= 0 ? "text-green-400" : "text-red-400")}>
          {formatCurrency(p.value)}
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  sub?: string;
  className?: string;
}

function StatCard({ label, value, sub, className }: StatCardProps) {
  return (
    <Card className={cn("bg-card/60", className)}>
      <CardContent className="pt-5 pb-5">
        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
        <div className="text-2xl font-bold">{value}</div>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function tsToDateStr(ts: number | null | undefined): string {
  if (!ts) return "";
  return format(new Date(ts), "MM/dd/yyyy");
}

// ---------------------------------------------------------------------------
// Analytics page
// ---------------------------------------------------------------------------

export default function Analytics() {
  const { selectedAccountId, accounts, setSelectedAccountId } = useAccount();
  const { selectedStrategyId } = useStrategy();
  const { startDate, endDate } = useDateRange();
  const shareableRef = useRef<HTMLDivElement>(null);

  const startDateStr = startDate ? tsToDateStr(startDate) : undefined;
  const endDateStr = endDate ? tsToDateStr(endDate) : undefined;

  const { data: trades = [], isLoading } = trpc.trade.list.useQuery({
    accountId: selectedAccountId ?? undefined,
    strategyId: selectedStrategyId ?? undefined,
    startDate: startDateStr,
    endDate: endDateStr,
  });

  // ---------------------------------------------------------------------------
  // Computed stats
  // ---------------------------------------------------------------------------

  const {
    closedTrades,
    winners,
    losers,
    totalPnl,
    winRate,
    avgWin,
    avgLoss,
    grossProfit,
    grossLoss,
    profitFactor,
    expectancy,
    riskRewardRatio,
    sharpeRatio,
    maxDrawdown,
    maxDrawdownPct,
    recoveryFactor,
    kellyPct,
    bestTrade,
    worstTrade,
    currentStreak,
    maxWinStreak,
    maxLossStreak,
  } = useMemo(() => {
    const closedTrades = trades.filter((t) => t.status === "closed" && t.netPnl != null);
    const winners = closedTrades.filter((t) => (t.netPnl ?? 0) > 0);
    const losers = closedTrades.filter((t) => (t.netPnl ?? 0) < 0);
    const totalPnl = closedTrades.reduce((sum, t) => sum + (t.netPnl ?? 0), 0);
    const winRate =
      closedTrades.length > 0 ? (winners.length / closedTrades.length) * 100 : 0;
    const avgWin =
      winners.length > 0
        ? winners.reduce((s, t) => s + (t.netPnl ?? 0), 0) / winners.length
        : 0;
    const avgLoss =
      losers.length > 0
        ? Math.abs(losers.reduce((s, t) => s + (t.netPnl ?? 0), 0)) / losers.length
        : 0;
    const grossProfit = winners.reduce((s, t) => s + (t.netPnl ?? 0), 0);
    const grossLoss = Math.abs(losers.reduce((s, t) => s + (t.netPnl ?? 0), 0));
    const profitFactor =
      grossLoss > 0
        ? grossProfit / grossLoss
        : grossProfit > 0
        ? Infinity
        : 0;
    const expectancy =
      closedTrades.length > 0 ? totalPnl / closedTrades.length : 0;

    // Risk/Reward Ratio
    const riskRewardRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0;

    // Sharpe-like ratio (avg / stdDev)
    const mean = closedTrades.length > 0 ? totalPnl / closedTrades.length : 0;
    const variance =
      closedTrades.length > 0
        ? closedTrades.reduce((s, t) => s + Math.pow((t.netPnl ?? 0) - mean, 2), 0) / closedTrades.length
        : 0;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? mean / stdDev : 0;

    // Max drawdown
    const sortedClosed = [...closedTrades].sort(
      (a, b) => (a.exitDate ?? a.entryDate ?? 0) - (b.exitDate ?? b.entryDate ?? 0)
    );
    let peak = 0;
    let cum = 0;
    let maxDrawdown = 0;
    let maxDrawdownPct = 0;
    for (const t of sortedClosed) {
      cum += t.netPnl ?? 0;
      if (cum > peak) peak = cum;
      const dd = peak - cum;
      if (dd > maxDrawdown) {
        maxDrawdown = dd;
        maxDrawdownPct = peak > 0 ? (dd / peak) * 100 : 0;
      }
    }

    // Recovery factor
    const recoveryFactor = maxDrawdown > 0 ? totalPnl / maxDrawdown : totalPnl > 0 ? Infinity : 0;

    // Kelly Criterion: f* = W − (1 − W) / R, where W is win probability and
    // R is the payoff ratio (avgWin / avgLoss). Returns the fraction of
    // bankroll to risk per trade. Capped at 1 for the "no losers" edge case;
    // null when there is no signal (no winners and no losers).
    const W = winRate / 100;
    const hasSignal = winners.length > 0 || losers.length > 0;
    const kellyPct: number | null = !hasSignal
      ? null
      : losers.length === 0
      ? Math.min(W, 1)
      : winners.length === 0
      ? -1
      : W - (1 - W) / (avgWin / avgLoss);

    // Streaks
    let curWin = 0;
    let curLoss = 0;
    let maxWinStreak = 0;
    let maxLossStreak = 0;
    for (const t of sortedClosed) {
      if ((t.netPnl ?? 0) > 0) {
        curWin++;
        curLoss = 0;
        maxWinStreak = Math.max(maxWinStreak, curWin);
      } else {
        curLoss++;
        curWin = 0;
        maxLossStreak = Math.max(maxLossStreak, curLoss);
      }
    }
    const currentStreak = curWin > 0 ? curWin : -curLoss;

    const bestTrade = closedTrades.reduce(
      (best, t) => ((t.netPnl ?? 0) > (best?.netPnl ?? -Infinity) ? t : best),
      null as (typeof closedTrades)[0] | null
    );
    const worstTrade = closedTrades.reduce(
      (worst, t) => ((t.netPnl ?? 0) < (worst?.netPnl ?? Infinity) ? t : worst),
      null as (typeof closedTrades)[0] | null
    );
    return {
      closedTrades,
      winners,
      losers,
      totalPnl,
      winRate,
      avgWin,
      avgLoss,
      grossProfit,
      grossLoss,
      profitFactor,
      expectancy,
      riskRewardRatio,
      sharpeRatio,
      maxDrawdown,
      maxDrawdownPct,
      recoveryFactor,
      kellyPct,
      bestTrade,
      worstTrade,
      currentStreak,
      maxWinStreak,
      maxLossStreak,
    };
  }, [trades]);

  // ---------------------------------------------------------------------------
  // Chart data
  // ---------------------------------------------------------------------------

  // 1. Cumulative P&L
  const cumulativeData = useMemo(() => {
    const sorted = [...closedTrades].sort(
      (a, b) => (a.exitDate ?? 0) - (b.exitDate ?? 0)
    );
    let running = 0;
    return sorted.map((t) => {
      running += t.netPnl ?? 0;
      return {
        date: t.exitDate ? format(new Date(t.exitDate), "MMM d") : "",
        pnl: parseFloat(running.toFixed(2)),
      };
    });
  }, [closedTrades]);

  const cumulativePositive = cumulativeData.length > 0
    ? cumulativeData[cumulativeData.length - 1].pnl >= 0
    : true;

  // Peak-to-trough drawdown cycles. Walk the equity curve, mark each new
  // running-high as a peak, track the lowest point inside the dip, and close
  // a cycle when a fresh new high above the prior peak is hit. The current
  // unfinished drawdown (if any) is deliberately excluded.
  const peakToTroughStats = useMemo(() => {
    const sorted = [...closedTrades]
      .filter((t) => t.exitDate != null)
      .sort((a, b) => (a.exitDate ?? 0) - (b.exitDate ?? 0));

    if (sorted.length === 0) return null;

    interface Cycle {
      peakEquity: number;
      troughEquity: number;
      drawdownAmount: number;
      drawdownPercent: number | null; // null when peak ≤ 0 (% not meaningful)
      peakTs: number;
      troughTs: number;
      recoveryTs: number;
      recoveryDays: number;
    }

    let runningMax = -Infinity;
    let cumPnl = 0;
    let currentPeak: { equity: number; ts: number } | null = null;
    let currentTrough: { equity: number; ts: number } | null = null;
    const cycles: Cycle[] = [];

    for (const t of sorted) {
      cumPnl += t.netPnl ?? 0;
      const ts = t.exitDate!;

      if (cumPnl > runningMax) {
        // Hit a new equity high. If we have a prior peak with a recorded
        // trough below it, that cycle is now complete.
        if (
          currentPeak !== null &&
          currentTrough !== null &&
          currentTrough.equity < currentPeak.equity
        ) {
          const drawdownAmount = currentPeak.equity - currentTrough.equity;
          // Only compute % when the peak is positive — a "percent drawdown"
          // from a negative or zero peak isn't meaningful for a trader.
          const drawdownPercent =
            currentPeak.equity > 0
              ? (drawdownAmount / currentPeak.equity) * 100
              : null;
          cycles.push({
            peakEquity: currentPeak.equity,
            troughEquity: currentTrough.equity,
            drawdownAmount,
            drawdownPercent,
            peakTs: currentPeak.ts,
            troughTs: currentTrough.ts,
            recoveryTs: ts,
            recoveryDays:
              (ts - currentPeak.ts) / (1000 * 60 * 60 * 24),
          });
        }
        runningMax = cumPnl;
        currentPeak = { equity: cumPnl, ts };
        currentTrough = null;
      } else if (cumPnl < runningMax) {
        // In drawdown — track the lowest point seen so far in this dip.
        if (currentTrough === null || cumPnl < currentTrough.equity) {
          currentTrough = { equity: cumPnl, ts };
        }
      }
    }

    if (cycles.length === 0) return null;

    const amounts = cycles.map((c) => c.drawdownAmount);
    const percents = cycles
      .map((c) => c.drawdownPercent)
      .filter((p): p is number => p !== null);

    const mean = (arr: number[]) =>
      arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
    const median = (arr: number[]) => {
      if (arr.length === 0) return 0;
      const s = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
    };

    return {
      cycleCount: cycles.length,
      avgDrawdownAmount: mean(amounts),
      medianDrawdownAmount: median(amounts),
      avgDrawdownPercent: percents.length > 0 ? mean(percents) : null,
      maxDrawdownAmount: Math.max(...amounts),
      avgRecoveryDays: mean(cycles.map((c) => c.recoveryDays)),
    };
  }, [closedTrades]);

  // 2. Daily P&L
  const dailyData = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of closedTrades) {
      if (!t.exitDate) continue;
      const key = format(new Date(t.exitDate), "MMM d");
      map.set(key, (map.get(key) ?? 0) + (t.netPnl ?? 0));
    }
    return Array.from(map.entries())
      .map(([date, pnl]) => ({ date, pnl: parseFloat(pnl.toFixed(2)) }))
      .sort((a, b) => {
        // keep display order by parsing date string
        const da = new Date(a.date + " 2000");
        const db = new Date(b.date + " 2000");
        return da.getTime() - db.getTime();
      });
  }, [closedTrades]);

  // 3. Distribution histogram
  const distributionData = useMemo(() => {
    const buckets = [
      { label: "< -1000", min: -Infinity, max: -1000 },
      { label: "-1000 to -500", min: -1000, max: -500 },
      { label: "-500 to -100", min: -500, max: -100 },
      { label: "-100 to 0", min: -100, max: 0 },
      { label: "0 to 100", min: 0, max: 100 },
      { label: "100 to 500", min: 100, max: 500 },
      { label: "500 to 1000", min: 500, max: 1000 },
      { label: "> 1000", min: 1000, max: Infinity },
    ];
    return buckets.map((b) => ({
      label: b.label,
      count: closedTrades.filter((t) => {
        const v = t.netPnl ?? 0;
        if (b.max === Infinity) return v > b.min;
        if (b.min === -Infinity) return v <= b.max;
        return v > b.min && v <= b.max;
      }).length,
      positive: b.min >= 0,
    }));
  }, [closedTrades]);

  // 4. By symbol (top 10)
  const symbolData = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of closedTrades) {
      map.set(t.symbol, (map.get(t.symbol) ?? 0) + (t.netPnl ?? 0));
    }
    return Array.from(map.entries())
      .map(([symbol, pnl]) => ({ symbol, pnl: parseFloat(pnl.toFixed(2)) }))
      .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl))
      .slice(0, 10);
  }, [closedTrades]);

  // 5. By day of week
  const dayOfWeekData = useMemo(() => {
    const sums = Array(7).fill(0) as number[];
    const counts = Array(7).fill(0) as number[];
    for (const t of closedTrades) {
      if (!t.exitDate) continue;
      const dow = getDay(new Date(t.exitDate));
      sums[dow] += t.netPnl ?? 0;
      counts[dow]++;
    }
    return DAY_LABELS.map((label, i) => ({
      label,
      pnl: counts[i] > 0 ? parseFloat((sums[i] / counts[i]).toFixed(2)) : 0,
      count: counts[i],
    }));
  }, [closedTrades]);

  // 6. By hour
  const hourData = useMemo(() => {
    const sums = Array(24).fill(0) as number[];
    const counts = Array(24).fill(0) as number[];
    for (const t of closedTrades) {
      if (!t.entryDate) continue;
      const h = getHours(new Date(t.entryDate));
      sums[h] += t.netPnl ?? 0;
      counts[h]++;
    }
    return Array.from({ length: 24 }, (_, h) => ({
      label: `${h.toString().padStart(2, "0")}:00`,
      pnl: counts[h] > 0 ? parseFloat((sums[h] / counts[h]).toFixed(2)) : null,
      count: counts[h],
    })).filter((d) => d.count > 0);
  }, [closedTrades]);

  // 7. Weekly P&L
  const weeklyData = useMemo(() => {
    const map = new Map<string, { pnl: number; ts: number }>();
    for (const t of closedTrades) {
      if (!t.exitDate) continue;
      const d = new Date(t.exitDate);
      const start = new Date(d);
      start.setDate(d.getDate() - d.getDay());
      const key = format(start, "MMM d");
      const existing = map.get(key) ?? { pnl: 0, ts: start.getTime() };
      existing.pnl += t.netPnl ?? 0;
      map.set(key, existing);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[1].ts - b[1].ts)
      .map(([week, { pnl }]) => ({ week, pnl: parseFloat(pnl.toFixed(2)) }));
  }, [closedTrades]);

  // 8. Monthly P&L
  const monthlyData = useMemo(() => {
    const map = new Map<string, { pnl: number; ts: number }>();
    for (const t of closedTrades) {
      if (!t.exitDate) continue;
      const d = new Date(t.exitDate);
      const key = format(d, "MMM yyyy");
      const existing = map.get(key) ?? { pnl: 0, ts: new Date(d.getFullYear(), d.getMonth(), 1).getTime() };
      existing.pnl += t.netPnl ?? 0;
      map.set(key, existing);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[1].ts - b[1].ts)
      .map(([month, { pnl }]) => ({ month, pnl: parseFloat(pnl.toFixed(2)) }));
  }, [closedTrades]);

  // 9. Win/Loss pie data
  const winLossPieData = useMemo(() => {
    const breakeven = closedTrades.filter((t) => (t.netPnl ?? 0) === 0).length;
    const data = [
      { name: "Wins", value: winners.length, fill: "#22c55e" },
      { name: "Losses", value: losers.length, fill: "#ef4444" },
    ];
    if (breakeven > 0) data.push({ name: "Breakeven", value: breakeven, fill: "#6b7280" });
    return data;
  }, [closedTrades, winners, losers]);

  // 10. Drawdown chart
  const drawdownData = useMemo(() => {
    const sorted = [...closedTrades].sort(
      (a, b) => (a.exitDate ?? a.entryDate ?? 0) - (b.exitDate ?? b.entryDate ?? 0)
    );
    let peak = 0;
    let cum = 0;
    return sorted.map((t, i) => {
      cum += t.netPnl ?? 0;
      if (cum > peak) peak = cum;
      return { trade: i + 1, drawdown: -parseFloat((peak - cum).toFixed(2)) };
    });
  }, [closedTrades]);

  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const isEmpty = !isLoading && closedTrades.length === 0;

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-8">
        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
          <div>
            <h1 className="text-2xl font-bold">Analytics</h1>
            <p className="text-sm text-muted-foreground">
              Performance breakdown for your trading activity
            </p>
          </div>

          {/* Filters row */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <ShareImageButton
              target={shareableRef}
              filename="tradefolio-analytics"
            />
            <Select
              value={selectedAccountId != null ? String(selectedAccountId) : "all"}
              onValueChange={(v) =>
                setSelectedAccountId(v === "all" ? null : Number(v))
              }
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All Accounts" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Accounts</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Empty state */}
        {isEmpty && (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
            <TrendingUp className="h-12 w-12 text-muted-foreground/40" />
            <div>
              <p className="text-lg font-medium">No trades found for this period</p>
              <p className="text-sm text-muted-foreground mt-1">
                Adjust the date range or account filter to see your analytics.
              </p>
            </div>
          </div>
        )}

        {/* Shareable region: stats + all charts */}
        <div ref={shareableRef} className="space-y-8 bg-background">
        {/* Content */}
        {!isLoading && !isEmpty && (
          <>
            {/* Stats grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                label="Total P&L"
                value={
                  <span className={pnlColor(totalPnl)}>
                    {formatCurrency(totalPnl)}
                  </span>
                }
                sub={`${closedTrades.length} closed trades`}
              />
              <StatCard
                label="Win Rate"
                value={
                  <span className={winRate >= 50 ? "text-green-400" : "text-red-400"}>
                    {winRate.toFixed(1)}%
                  </span>
                }
                sub={`${winners.length}W / ${losers.length}L`}
              />
              <StatCard
                label="Profit Factor"
                value={
                  <span className={profitFactor >= 1 ? "text-green-400" : "text-red-400"}>
                    {profitFactor === Infinity
                      ? "∞"
                      : profitFactor.toFixed(2)}
                  </span>
                }
                sub={`Gross: ${formatCurrency(grossProfit)} / ${formatCurrency(grossLoss)}`}
              />
              <StatCard
                label="Expectancy"
                value={
                  <span className={pnlColor(expectancy)}>
                    {formatCurrency(expectancy)}
                  </span>
                }
                sub="Avg P&L per trade"
              />
              <StatCard
                label="Total Trades"
                value={<span className="text-foreground">{closedTrades.length}</span>}
                sub={`${trades.length} total including open`}
              />
              <StatCard
                label="Avg Win"
                value={
                  <span className="text-green-400">{formatCurrency(avgWin)}</span>
                }
                sub={`${winners.length} winning trades`}
              />
              <StatCard
                label="Avg Loss"
                value={
                  <span className="text-red-400">{formatCurrency(avgLoss)}</span>
                }
                sub={`${losers.length} losing trades`}
              />
              <StatCard
                label="Best / Worst"
                value={
                  <span className="text-sm font-semibold">
                    <span className="text-green-400">
                      {formatCurrency(bestTrade?.netPnl)}
                    </span>{" "}
                    <span className="text-muted-foreground">/</span>{" "}
                    <span className="text-red-400">
                      {formatCurrency(worstTrade?.netPnl)}
                    </span>
                  </span>
                }
                sub={`${bestTrade?.symbol ?? "—"} / ${worstTrade?.symbol ?? "—"}`}
              />
            </div>

            {/* Advanced stats row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                label="Risk / Reward"
                value={
                  <span className={riskRewardRatio >= 1 ? "text-green-400" : "text-red-400"}>
                    {riskRewardRatio === Infinity ? "∞" : riskRewardRatio.toFixed(2)}
                  </span>
                }
                sub="Avg Win / Avg Loss"
              />
              <StatCard
                label="Sharpe Ratio"
                value={
                  <span className={sharpeRatio >= 0 ? "text-green-400" : "text-red-400"}>
                    {sharpeRatio.toFixed(2)}
                  </span>
                }
                sub="Risk-adjusted return"
              />
              <StatCard
                label="Max Drawdown"
                value={
                  <span className="text-red-400">
                    {formatCurrency(-maxDrawdown)}
                  </span>
                }
                sub={maxDrawdownPct > 0 ? `${maxDrawdownPct.toFixed(1)}% from peak` : "No drawdown"}
              />
              <StatCard
                label="Recovery Factor"
                value={
                  <span className={recoveryFactor >= 1 ? "text-green-400" : "text-yellow-400"}>
                    {recoveryFactor === Infinity ? "∞" : recoveryFactor.toFixed(2)}
                  </span>
                }
                sub="P&L / Max Drawdown"
              />
              <StatCard
                label="Streaks"
                value={
                  <span className="text-foreground">
                    {maxWinStreak}W / {maxLossStreak}L
                  </span>
                }
                sub={
                  currentStreak === 0
                    ? "No active streak"
                    : currentStreak > 0
                    ? `Current: ${currentStreak} win streak`
                    : `Current: ${Math.abs(currentStreak)} loss streak`
                }
              />
              <StatCard
                label="Kelly Criterion"
                value={
                  kellyPct === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span className={kellyPct > 0 ? "text-green-400" : "text-red-400"}>
                      {(kellyPct * 100).toFixed(1)}%
                    </span>
                  )
                }
                sub={
                  kellyPct === null
                    ? "Need wins and losses"
                    : kellyPct <= 0
                    ? "Negative edge — don't size up"
                    : `Half Kelly: ${(kellyPct * 50).toFixed(1)}% of bankroll`
                }
              />
            </div>

            <Separator />

            {/* Section 1: Cumulative P&L */}
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-base font-semibold">Cumulative P&L</h2>
              </div>
              <Card className="bg-card/60">
                <CardContent className="pt-4">
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={cumulativeData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                      <defs>
                        <linearGradient id="cumulGreen" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="cumulRed" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11, fill: "#6b7280" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        tickFormatter={(v) => formatCurrency(v, 0)}
                        tick={{ fontSize: 11, fill: "#6b7280" }}
                        tickLine={false}
                        axisLine={false}
                        width={70}
                      />
                      <RechartsTooltip
                        content={<DarkTooltip labelFormatter={(l) => l} />}
                        cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                      />
                      <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />
                      <Area
                        type="monotone"
                        dataKey="pnl"
                        stroke={cumulativePositive ? "#22c55e" : "#ef4444"}
                        strokeWidth={2}
                        fill={cumulativePositive ? "url(#cumulGreen)" : "url(#cumulRed)"}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </section>

            {/* Section 2: Daily P&L */}
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-base font-semibold">Daily P&L</h2>
              </div>
              <Card className="bg-card/60">
                <CardContent className="pt-4">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={dailyData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11, fill: "#6b7280" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        tickFormatter={(v) => formatCurrency(v, 0)}
                        tick={{ fontSize: 11, fill: "#6b7280" }}
                        tickLine={false}
                        axisLine={false}
                        width={70}
                      />
                      <RechartsTooltip
                        content={<DarkTooltip labelFormatter={(l) => l} />}
                        cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                      />
                      <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                      <Bar dataKey="pnl" radius={[3, 3, 0, 0]} maxBarSize={40}>
                        {dailyData.map((entry, index) => (
                          <Cell
                            key={index}
                            fill={entry.pnl >= 0 ? "#22c55e" : "#ef4444"}
                            fillOpacity={0.85}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </section>

            {/* Section 3 & 4 side by side on large screens */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {/* Section 3: P&L Distribution */}
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-base font-semibold">P&L Distribution</h2>
                </div>
                <Card className="bg-card/60">
                  <CardContent className="pt-4">
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart
                        data={distributionData}
                        margin={{ top: 8, right: 8, left: 0, bottom: 32 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 10, fill: "#6b7280" }}
                          tickLine={false}
                          axisLine={false}
                          angle={-35}
                          textAnchor="end"
                          interval={0}
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: "#6b7280" }}
                          tickLine={false}
                          axisLine={false}
                          allowDecimals={false}
                          width={30}
                        />
                        <RechartsTooltip
                          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                          content={({ active, payload, label }) =>
                            active && payload && payload.length ? (
                              <div className="rounded-lg border border-border bg-zinc-900 px-3 py-2 shadow-xl text-sm">
                                <p className="text-muted-foreground mb-1">{label}</p>
                                <p className="font-semibold text-foreground">
                                  {payload[0].value} trade{payload[0].value !== 1 ? "s" : ""}
                                </p>
                              </div>
                            ) : null
                          }
                        />
                        <Bar dataKey="count" radius={[3, 3, 0, 0]} maxBarSize={40}>
                          {distributionData.map((entry, index) => (
                            <Cell
                              key={index}
                              fill={entry.positive ? "#22c55e" : "#ef4444"}
                              fillOpacity={0.85}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </section>

              {/* Section 4: By Symbol */}
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <TrendingDown className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-base font-semibold">
                    Performance by Symbol{" "}
                    <span className="text-xs text-muted-foreground font-normal">(top 10)</span>
                  </h2>
                </div>
                <Card className="bg-card/60">
                  <CardContent className="pt-4">
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart
                        layout="vertical"
                        data={symbolData}
                        margin={{ top: 4, right: 60, left: 0, bottom: 4 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                        <XAxis
                          type="number"
                          tickFormatter={(v) => formatCurrency(v, 0)}
                          tick={{ fontSize: 10, fill: "#6b7280" }}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          type="category"
                          dataKey="symbol"
                          tick={{ fontSize: 11, fill: "#9ca3af" }}
                          tickLine={false}
                          axisLine={false}
                          width={52}
                        />
                        <RechartsTooltip
                          content={<DarkTooltip labelFormatter={(l) => l} />}
                          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                        />
                        <ReferenceLine x={0} stroke="rgba(255,255,255,0.2)" />
                        <Bar dataKey="pnl" radius={[0, 3, 3, 0]} maxBarSize={20}>
                          {symbolData.map((entry, index) => (
                            <Cell
                              key={index}
                              fill={entry.pnl >= 0 ? "#22c55e" : "#ef4444"}
                              fillOpacity={0.85}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </section>
            </div>

            {/* Section 5 & 6: Day of Week + Hour */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {/* Section 5: Day of Week */}
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <BarChart2 className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-base font-semibold">Performance by Day of Week</h2>
                </div>
                <Card className="bg-card/60">
                  <CardContent className="pt-4">
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart
                        data={dayOfWeekData}
                        margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 11, fill: "#6b7280" }}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          tickFormatter={(v) => formatCurrency(v, 0)}
                          tick={{ fontSize: 11, fill: "#6b7280" }}
                          tickLine={false}
                          axisLine={false}
                          width={70}
                        />
                        <RechartsTooltip
                          content={
                            <DarkTooltip
                              labelFormatter={(l) => `${l} (avg)`}
                            />
                          }
                          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                        />
                        <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                        <Bar dataKey="pnl" radius={[3, 3, 0, 0]} maxBarSize={40}>
                          {dayOfWeekData.map((entry, index) => (
                            <Cell
                              key={index}
                              fill={entry.pnl >= 0 ? "#22c55e" : "#ef4444"}
                              fillOpacity={entry.count > 0 ? 0.85 : 0.2}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </section>

              {/* Section 6: By Hour */}
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-base font-semibold">Performance by Hour</h2>
                </div>
                <Card className="bg-card/60">
                  <CardContent className="pt-4">
                    {hourData.length === 0 ? (
                      <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
                        No hourly data available
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height={200}>
                        <BarChart
                          data={hourData}
                          margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                          <XAxis
                            dataKey="label"
                            tick={{ fontSize: 10, fill: "#6b7280" }}
                            tickLine={false}
                            axisLine={false}
                          />
                          <YAxis
                            tickFormatter={(v) => formatCurrency(v, 0)}
                            tick={{ fontSize: 11, fill: "#6b7280" }}
                            tickLine={false}
                            axisLine={false}
                            width={70}
                          />
                          <RechartsTooltip
                            content={
                              <DarkTooltip
                                labelFormatter={(l) => `${l} (avg)`}
                              />
                            }
                            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                          />
                          <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                          <Bar dataKey="pnl" radius={[3, 3, 0, 0]} maxBarSize={32}>
                            {hourData.map((entry, index) => (
                              <Cell
                                key={index}
                                fill={(entry.pnl ?? 0) >= 0 ? "#22c55e" : "#ef4444"}
                                fillOpacity={0.85}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>
              </section>
            </div>

            {/* Weekly & Monthly P&L side by side */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {/* Weekly P&L */}
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <BarChart2 className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-base font-semibold">Weekly P&L</h2>
                </div>
                <Card className="bg-card/60">
                  <CardContent className="pt-4">
                    {weeklyData.length === 0 ? (
                      <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
                        Not enough data
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={weeklyData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                          <XAxis dataKey="week" tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                          <YAxis tickFormatter={(v) => formatCurrency(v, 0)} tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} width={70} />
                          <RechartsTooltip content={<DarkTooltip labelFormatter={(l) => `Week of ${l}`} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                          <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                          <Bar dataKey="pnl" radius={[3, 3, 0, 0]} maxBarSize={40}>
                            {weeklyData.map((e, i) => (
                              <Cell key={i} fill={e.pnl >= 0 ? "#22c55e" : "#ef4444"} fillOpacity={0.85} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>
              </section>

              {/* Monthly P&L */}
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <BarChart2 className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-base font-semibold">Monthly P&L</h2>
                </div>
                <Card className="bg-card/60">
                  <CardContent className="pt-4">
                    {monthlyData.length === 0 ? (
                      <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
                        Not enough data
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={monthlyData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                          <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                          <YAxis tickFormatter={(v) => formatCurrency(v, 0)} tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} width={70} />
                          <RechartsTooltip content={<DarkTooltip labelFormatter={(l) => l} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                          <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                          <Bar dataKey="pnl" radius={[3, 3, 0, 0]} maxBarSize={40}>
                            {monthlyData.map((e, i) => (
                              <Cell key={i} fill={e.pnl >= 0 ? "#22c55e" : "#ef4444"} fillOpacity={0.85} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>
              </section>
            </div>

            {/* Peak-to-Trough Drawdown */}
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-base font-semibold">
                  Peak-to-Trough Drawdown
                </h2>
              </div>
              <Card className="bg-card/60">
                <CardContent className="pt-5 pb-5">
                  {peakToTroughStats === null ? (
                    <div className="py-6 text-center">
                      <p className="text-sm font-medium">
                        No completed recovery cycles yet
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Once your equity recovers from a drawdown to make a
                        new high, the cycle will be measured here.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                        <div>
                          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                            Avg drawdown
                          </p>
                          <p className="text-xl font-bold text-red-400">
                            {formatCurrency(-peakToTroughStats.avgDrawdownAmount)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                            Median
                          </p>
                          <p className="text-xl font-bold text-red-400">
                            {formatCurrency(-peakToTroughStats.medianDrawdownAmount)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                            Avg %
                          </p>
                          <p className="text-xl font-bold text-red-400">
                            {peakToTroughStats.avgDrawdownPercent !== null
                              ? `${peakToTroughStats.avgDrawdownPercent.toFixed(1)}%`
                              : "—"}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                            Worst cycle
                          </p>
                          <p className="text-xl font-bold text-red-400">
                            {formatCurrency(-peakToTroughStats.maxDrawdownAmount)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                            Cycles
                          </p>
                          <p className="text-xl font-bold text-foreground">
                            {peakToTroughStats.cycleCount}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                            Avg recovery
                          </p>
                          <p className="text-xl font-bold text-foreground">
                            {peakToTroughStats.avgRecoveryDays >= 1
                              ? `${peakToTroughStats.avgRecoveryDays.toFixed(1)} d`
                              : `${(peakToTroughStats.avgRecoveryDays * 24).toFixed(1)} h`}
                          </p>
                        </div>
                      </div>
                      <p className="mt-4 text-xs text-muted-foreground">
                        Based on{" "}
                        <span className="font-medium text-foreground">
                          {peakToTroughStats.cycleCount}
                        </span>{" "}
                        completed peak → trough → new-high cycle
                        {peakToTroughStats.cycleCount !== 1 ? "s" : ""}
                        {selectedAccountId == null
                          ? " across all accounts (combined view — most meaningful per single account)"
                          : ""}
                        . The current open drawdown is not included.
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>
            </section>

            {/* Win/Loss Pie & Drawdown Chart side by side */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {/* Win/Loss Pie */}
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-base font-semibold">Win / Loss Distribution</h2>
                </div>
                <Card className="bg-card/60">
                  <CardContent className="pt-4">
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie
                          data={winLossPieData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={80}
                          label={({ name, value }) => `${name}: ${value}`}
                          labelLine={{ stroke: "#6b7280" }}
                        >
                          {winLossPieData.map((entry, i) => (
                            <Cell key={i} fill={entry.fill} />
                          ))}
                        </Pie>
                        <RechartsTooltip
                          content={({ active, payload }) =>
                            active && payload && payload.length ? (
                              <div className="rounded-lg border border-border bg-zinc-900 px-3 py-2 shadow-xl text-sm">
                                <p className="text-foreground font-semibold">{payload[0].name}</p>
                                <p className="text-muted-foreground">{payload[0].value} trades</p>
                              </div>
                            ) : null
                          }
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </section>

              {/* Drawdown Chart */}
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <TrendingDown className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-base font-semibold">Drawdown</h2>
                </div>
                <Card className="bg-card/60">
                  <CardContent className="pt-4">
                    {drawdownData.length === 0 ? (
                      <div className="flex items-center justify-center h-[220px] text-muted-foreground text-sm">
                        No data
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height={220}>
                        <AreaChart data={drawdownData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                          <defs>
                            <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                          <XAxis dataKey="trade" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                          <YAxis tickFormatter={(v) => formatCurrency(v, 0)} tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} width={70} />
                          <RechartsTooltip content={<DarkTooltip labelFormatter={(l) => `Trade #${l}`} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                          <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
                          <Area type="monotone" dataKey="drawdown" stroke="#ef4444" strokeWidth={2} fill="url(#ddGrad)" dot={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>
              </section>
            </div>
          </>
        )}
        </div>
        {/* /Shareable region */}
      </div>
    </DashboardLayout>
  );
}
