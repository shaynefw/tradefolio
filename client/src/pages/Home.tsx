import React, { useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Target,
  Trophy,
  Flame,
  BarChart3,
  Calendar,
} from "lucide-react";
import { format } from "date-fns";

import { trpc } from "../lib/trpc";
import { useAccount } from "../contexts/AccountContext";
import { useDateRange } from "../contexts/DateRangeContext";
import { useStrategy } from "../contexts/StrategyContext";
import { cn, formatCurrency, formatDate, pnlColor } from "../lib/utils";
import { DashboardLayout } from "../components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Separator } from "../components/ui/separator";

// ---------------------------------------------------------------------------
// Types inferred from API
// ---------------------------------------------------------------------------

type Trade = {
  id: number;
  symbol: string;
  side: "long" | "short";
  entryDate: number | null;
  exitDate: number | null;
  netPnl: number | null;
  pnl: number | null;
  fees: number | null;
  status: string;
  accountName: string | null;
};

// ---------------------------------------------------------------------------
// Stats helpers
// ---------------------------------------------------------------------------

function computeStats(trades: Trade[]) {
  const closed = trades.filter(
    (t) => t.status === "closed" && t.netPnl !== null
  );

  const totalPnl = closed.reduce((sum, t) => sum + (t.netPnl ?? 0), 0);

  const wins = closed.filter((t) => (t.netPnl ?? 0) > 0);
  const losses = closed.filter((t) => (t.netPnl ?? 0) < 0);
  const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;

  const grossProfit = wins.reduce((sum, t) => sum + (t.netPnl ?? 0), 0);
  const grossLoss = Math.abs(
    losses.reduce((sum, t) => sum + (t.netPnl ?? 0), 0)
  );
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;

  const bestTrade =
    closed.length > 0
      ? closed.reduce((best, t) =>
          (t.netPnl ?? 0) > (best.netPnl ?? 0) ? t : best
        )
      : null;

  const worstTrade =
    closed.length > 0
      ? closed.reduce((worst, t) =>
          (t.netPnl ?? 0) < (worst.netPnl ?? 0) ? t : worst
        )
      : null;

  // Streak calculation
  let maxWinStreak = 0;
  let maxLossStreak = 0;
  let currentWin = 0;
  let currentLoss = 0;

  // Sort by entry date ascending for streak calc
  const sorted = [...closed].sort(
    (a, b) => (a.entryDate ?? 0) - (b.entryDate ?? 0)
  );

  for (const t of sorted) {
    if ((t.netPnl ?? 0) > 0) {
      currentWin++;
      currentLoss = 0;
      maxWinStreak = Math.max(maxWinStreak, currentWin);
    } else {
      currentLoss++;
      currentWin = 0;
      maxLossStreak = Math.max(maxLossStreak, currentLoss);
    }
  }

  // currentWin / currentLoss after loop = active streak
  // positive = win streak, negative = loss streak
  const currentStreak = currentWin > 0 ? currentWin : -currentLoss;

  return {
    totalPnl,
    winRate,
    totalTrades: closed.length,
    openTrades: trades.filter((t) => t.status === "open").length,
    profitFactor,
    avgWin,
    avgLoss,
    bestTrade,
    worstTrade,
    maxWinStreak,
    maxLossStreak,
    currentStreak,
  };
}

// ---------------------------------------------------------------------------
// Cumulative P&L chart data
// ---------------------------------------------------------------------------

function buildChartData(trades: Trade[]) {
  const closed = trades
    .filter((t) => t.status === "closed" && t.netPnl !== null && t.entryDate)
    .sort((a, b) => (a.entryDate ?? 0) - (b.entryDate ?? 0));

  let cumulative = 0;
  const points: Array<{ date: string; pnl: number; cumPnl: number }> = [];

  for (const t of closed) {
    cumulative += t.netPnl ?? 0;
    points.push({
      date: format(new Date(t.entryDate!), "MM/dd"),
      pnl: t.netPnl ?? 0,
      cumPnl: cumulative,
    });
  }

  return points;
}

// ---------------------------------------------------------------------------
// DateRangePicker (inline)
// ---------------------------------------------------------------------------

function DateRangePicker() {
  const { dateRange, setDateRange } = useDateRange();

  const fromValue = dateRange.from
    ? format(dateRange.from, "yyyy-MM-dd")
    : "";
  const toValue = dateRange.to ? format(dateRange.to, "yyyy-MM-dd") : "";

  return (
    <div className="flex items-center gap-2">
      <Calendar className="h-4 w-4 text-muted-foreground" />
      <div className="flex items-center gap-1.5">
        <input
          type="date"
          value={fromValue}
          onChange={(e) =>
            setDateRange({
              ...dateRange,
              from: e.target.value ? new Date(e.target.value + "T00:00:00") : undefined,
            })
          }
          className="rounded-md border border-border bg-muted/50 px-2 py-1 text-sm text-foreground [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <span className="text-muted-foreground text-xs">to</span>
        <input
          type="date"
          value={toValue}
          onChange={(e) =>
            setDateRange({
              ...dateRange,
              to: e.target.value ? new Date(e.target.value + "T23:59:59") : undefined,
            })
          }
          className="rounded-md border border-border bg-muted/50 px-2 py-1 text-sm text-foreground [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
  icon: React.ComponentType<{ className?: string }>;
  iconClass?: string;
}

function StatCard({
  label,
  value,
  sub,
  valueClass,
  icon: Icon,
  iconClass,
}: StatCardProps) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {label}
            </p>
            <p className={cn("text-2xl font-bold", valueClass ?? "text-foreground")}>
              {value}
            </p>
            {sub && (
              <p className="text-xs text-muted-foreground">{sub}</p>
            )}
          </div>
          <div
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-md",
              iconClass ?? "bg-muted text-muted-foreground"
            )}
          >
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Custom tooltip for recharts
// ---------------------------------------------------------------------------

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const val = payload[0].value;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 shadow-lg">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "text-sm font-semibold",
          val >= 0 ? "text-green-400" : "text-red-400"
        )}
      >
        {formatCurrency(val)}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function HomePage() {
  const [, navigate] = useLocation();
  const { selectedAccountId } = useAccount();
  const { selectedStrategyId } = useStrategy();
  const { startDate, endDate } = useDateRange();

  const { data: trades = [], isLoading } = trpc.trade.list.useQuery({
    accountId: selectedAccountId ?? undefined,
    strategyId: selectedStrategyId ?? undefined,
    startDate: startDate ? new Date(startDate).toISOString() : undefined,
    endDate: endDate ? new Date(endDate).toISOString() : undefined,
  });

  const stats = useMemo(() => computeStats(trades as Trade[]), [trades]);
  const chartData = useMemo(() => buildChartData(trades as Trade[]), [trades]);

  const recentTrades = useMemo(
    () =>
      [...(trades as Trade[])]
        .sort((a, b) => (b.entryDate ?? 0) - (a.entryDate ?? 0))
        .slice(0, 10),
    [trades]
  );

  const finalPnl = chartData.length > 0 ? chartData[chartData.length - 1].cumPnl : 0;
  const chartColor = finalPnl >= 0 ? "#4ade80" : "#f87171"; // green-400 / red-400

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Dashboard
            </h1>
            <p className="text-sm text-muted-foreground">
              Overview of your trading performance
            </p>
          </div>
          <DateRangePicker />
        </div>

        <Separator className="bg-border" />

        {/* Stats grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Card key={i} className="bg-card border-border">
                <CardContent className="p-5">
                  <div className="h-16 animate-pulse rounded-md bg-muted" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Total P&L"
              value={formatCurrency(stats.totalPnl)}
              sub={`${stats.totalTrades} closed trades`}
              valueClass={
                stats.totalPnl > 0
                  ? "text-green-400"
                  : stats.totalPnl < 0
                  ? "text-red-400"
                  : "text-foreground"
              }
              icon={stats.totalPnl >= 0 ? TrendingUp : TrendingDown}
              iconClass={
                stats.totalPnl >= 0
                  ? "bg-green-500/10 text-green-400"
                  : "bg-red-500/10 text-red-400"
              }
            />

            <StatCard
              label="Win Rate"
              value={`${stats.winRate.toFixed(1)}%`}
              sub={`${stats.totalTrades} closed trades`}
              valueClass={
                stats.winRate >= 50 ? "text-green-400" : "text-red-400"
              }
              icon={Target}
              iconClass={
                stats.winRate >= 50
                  ? "bg-green-500/10 text-green-400"
                  : "bg-red-500/10 text-red-400"
              }
            />

            <StatCard
              label="Profit Factor"
              value={
                stats.profitFactor === Infinity
                  ? "∞"
                  : stats.profitFactor.toFixed(2)
              }
              sub="Gross profit / gross loss"
              valueClass={
                stats.profitFactor >= 1 ? "text-green-400" : "text-red-400"
              }
              icon={BarChart3}
              iconClass="bg-muted text-muted-foreground"
            />

            <StatCard
              label="Open Trades"
              value={String(stats.openTrades)}
              sub="Currently active"
              icon={Activity}
              iconClass="bg-blue-500/10 text-blue-400"
            />

            <StatCard
              label="Avg Win"
              value={formatCurrency(stats.avgWin)}
              valueClass="text-green-400"
              icon={TrendingUp}
              iconClass="bg-green-500/10 text-green-400"
            />

            <StatCard
              label="Avg Loss"
              value={formatCurrency(-stats.avgLoss)}
              valueClass="text-red-400"
              icon={TrendingDown}
              iconClass="bg-red-500/10 text-red-400"
            />

            <StatCard
              label="Best Trade"
              value={
                stats.bestTrade
                  ? formatCurrency(stats.bestTrade.netPnl)
                  : "—"
              }
              sub={stats.bestTrade?.symbol ?? undefined}
              valueClass="text-green-400"
              icon={Trophy}
              iconClass="bg-yellow-500/10 text-yellow-400"
            />

            <StatCard
              label="Win / Loss Streak"
              value={`${stats.maxWinStreak}W / ${stats.maxLossStreak}L`}
              sub={
                stats.currentStreak === 0
                  ? "No active streak"
                  : stats.currentStreak > 0
                  ? `Current: ${stats.currentStreak} win streak`
                  : `Current: ${Math.abs(stats.currentStreak)} loss streak`
              }
              icon={Flame}
              iconClass="bg-orange-500/10 text-orange-400"
            />
          </div>
        )}

        {/* P&L Chart */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-foreground">
              Cumulative P&L
            </CardTitle>
          </CardHeader>
          <CardContent className="pr-4">
            {isLoading ? (
              <div className="h-64 animate-pulse rounded-md bg-muted" />
            ) : chartData.length === 0 ? (
              <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
                No closed trades in selected period
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart
                  data={chartData}
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="5%"
                        stopColor={chartColor}
                        stopOpacity={0.25}
                      />
                      <stop
                        offset="95%"
                        stopColor={chartColor}
                        stopOpacity={0.02}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(216 34% 17%)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "hsl(215.4 16.3% 56.9%)", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fill: "hsl(215.4 16.3% 56.9%)", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) =>
                      v >= 0
                        ? `$${(v / 1000).toFixed(0)}k`
                        : `-$${(Math.abs(v) / 1000).toFixed(0)}k`
                    }
                    width={52}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="cumPnl"
                    stroke={chartColor}
                    strokeWidth={2}
                    fill="url(#pnlGradient)"
                    dot={false}
                    activeDot={{
                      r: 4,
                      fill: chartColor,
                      stroke: "hsl(224 71% 4%)",
                      strokeWidth: 2,
                    }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Recent Trades */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-foreground">
              Recent Trades
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-10 animate-pulse rounded-md bg-muted"
                  />
                ))}
              </div>
            ) : recentTrades.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                No trades in selected period
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Date
                      </th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Symbol
                      </th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Side
                      </th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Status
                      </th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Net P&L
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentTrades.map((trade) => (
                      <tr
                        key={trade.id}
                        className="cursor-pointer border-b border-border/50 transition-colors last:border-0 hover:bg-accent/40"
                        onClick={() => navigate(`/trades/${trade.id}`)}
                      >
                        <td className="px-4 py-3 text-muted-foreground">
                          {formatDate(trade.entryDate)}
                        </td>
                        <td className="px-4 py-3 font-medium text-foreground">
                          {trade.symbol}
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            className={cn(
                              "text-xs font-medium",
                              trade.side === "long"
                                ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                                : "bg-purple-500/10 text-purple-400 border-purple-500/20"
                            )}
                          >
                            {trade.side === "long" ? "Long" : "Short"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            className={cn(
                              "text-xs font-medium",
                              trade.status === "closed"
                                ? "bg-muted text-muted-foreground border-border"
                                : "bg-green-500/10 text-green-400 border-green-500/20"
                            )}
                          >
                            {trade.status === "closed" ? "Closed" : "Open"}
                          </Badge>
                        </td>
                        <td
                          className={cn(
                            "px-4 py-3 text-right font-semibold tabular-nums",
                            pnlColor(trade.netPnl)
                          )}
                        >
                          {trade.status === "closed"
                            ? formatCurrency(trade.netPnl)
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
