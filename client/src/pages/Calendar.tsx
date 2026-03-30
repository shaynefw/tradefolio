import { useState, useMemo } from "react";
import { trpc } from "../lib/trpc";
import { useAccount } from "../contexts/AccountContext";
import { cn, formatCurrency, pnlColor } from "../lib/utils";
import DashboardLayout from "../components/DashboardLayout";
import { Card, CardContent } from "../components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Button } from "../components/ui/button";
import { Separator } from "../components/ui/separator";
import {
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  Loader2,
  CalendarDays,
} from "lucide-react";
import {
  format,
  startOfMonth,
  endOfMonth,
  getDaysInMonth,
  getDate,
  getDay,
  isSameDay,
  addMonths,
  subMonths,
} from "date-fns";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DayStats {
  date: Date;
  pnl: number;
  count: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a timestamp (ms) to MM/dd/yyyy string for the tRPC query. */
function tsToStr(ts: number): string {
  return format(new Date(ts), "MM/dd/yyyy");
}

/** Tailwind classes for a calendar day cell based on the day's P&L. */
function dayCellBg(stats: DayStats | undefined, isCurrentMonth: boolean): string {
  if (!isCurrentMonth) return "bg-transparent opacity-0 pointer-events-none";
  if (!stats || stats.count === 0) return "bg-card/50 text-muted-foreground";
  const pnl = stats.pnl;
  if (pnl === 0) return "bg-muted/30";
  if (pnl > 500) return "bg-green-500/40";
  if (pnl > 100) return "bg-green-500/25";
  if (pnl > 0) return "bg-green-500/15";
  if (pnl < -500) return "bg-red-500/40";
  if (pnl < -100) return "bg-red-500/25";
  return "bg-red-500/15";
}

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ---------------------------------------------------------------------------
// Calendar page
// ---------------------------------------------------------------------------

export default function Calendar() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const { selectedAccountId, accounts, setSelectedAccountId } = useAccount();

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);

  const { data: trades = [], isLoading } = trpc.trade.list.useQuery({
    accountId: selectedAccountId ?? undefined,
    startDate: tsToStr(monthStart.getTime()),
    endDate: tsToStr(monthEnd.getTime()),
  });

  // ---------------------------------------------------------------------------
  // Build per-day stats map
  // ---------------------------------------------------------------------------

  const dayStatsMap = useMemo(() => {
    const map = new Map<string, DayStats>();

    for (const trade of trades) {
      if (trade.status !== "closed" || trade.netPnl == null) continue;
      const exitTs = trade.exitDate;
      if (!exitTs) continue;

      const exitDate = new Date(exitTs);
      const key = format(exitDate, "yyyy-MM-dd");

      if (!map.has(key)) {
        map.set(key, { date: exitDate, pnl: 0, count: 0 });
      }
      const entry = map.get(key)!;
      entry.pnl += trade.netPnl;
      entry.count += 1;
    }

    // Round pnl values
    for (const [key, val] of map.entries()) {
      map.set(key, { ...val, pnl: parseFloat(val.pnl.toFixed(2)) });
    }

    return map;
  }, [trades]);

  // ---------------------------------------------------------------------------
  // Build 6x7 calendar grid
  // ---------------------------------------------------------------------------

  const calendarGrid = useMemo(() => {
    const daysInMonth = getDaysInMonth(currentMonth);
    const firstDow = getDay(monthStart); // 0 = Sunday

    // Total cells in a 6-row grid
    const totalCells = 42;

    return Array.from({ length: totalCells }, (_, i) => {
      const dayNum = i - firstDow + 1; // 1-indexed day
      if (dayNum < 1 || dayNum > daysInMonth) {
        return { dayNum: null, date: null, inMonth: false };
      }
      const date = new Date(
        currentMonth.getFullYear(),
        currentMonth.getMonth(),
        dayNum
      );
      const key = format(date, "yyyy-MM-dd");
      const stats = dayStatsMap.get(key);
      return { dayNum, date, inMonth: true, stats };
    });
  }, [currentMonth, monthStart, dayStatsMap]);

  // ---------------------------------------------------------------------------
  // Monthly summary stats
  // ---------------------------------------------------------------------------

  const monthlySummary = useMemo(() => {
    const closedTrades = trades.filter(
      (t) => t.status === "closed" && t.netPnl != null && t.exitDate
    );

    const totalPnl = closedTrades.reduce((s, t) => s + (t.netPnl ?? 0), 0);
    const totalCount = closedTrades.length;

    // Best and worst day
    let bestDay: { date: Date; pnl: number } | null = null;
    let worstDay: { date: Date; pnl: number } | null = null;

    for (const [, stats] of dayStatsMap.entries()) {
      if (bestDay === null || stats.pnl > bestDay.pnl) {
        bestDay = { date: stats.date, pnl: stats.pnl };
      }
      if (worstDay === null || stats.pnl < worstDay.pnl) {
        worstDay = { date: stats.date, pnl: stats.pnl };
      }
    }

    return {
      totalPnl: parseFloat(totalPnl.toFixed(2)),
      totalCount,
      bestDay,
      worstDay,
    };
  }, [trades, dayStatsMap]);

  const today = new Date();

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Calendar</h1>
            <p className="text-sm text-muted-foreground">
              Daily P&L heatmap view
            </p>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
                aria-label="Previous month"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              <span className="w-36 text-center text-sm font-semibold tabular-nums">
                {format(currentMonth, "MMMM yyyy")}
              </span>

              <Button
                variant="outline"
                size="icon"
                onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
                aria-label="Next month"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={() => setCurrentMonth(new Date())}
            >
              Today
            </Button>

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

        {/* Loading spinner */}
        {isLoading && (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Calendar grid */}
        {!isLoading && (
          <Card className="bg-card/60 overflow-hidden">
            <CardContent className="p-0">
              {/* Day of week header */}
              <div className="grid grid-cols-7 border-b border-border">
                {DOW_LABELS.map((d) => (
                  <div
                    key={d}
                    className="py-2 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider"
                  >
                    {d}
                  </div>
                ))}
              </div>

              {/* Days grid */}
              <div className="grid grid-cols-7">
                {calendarGrid.map((cell, idx) => {
                  const isToday =
                    cell.date ? isSameDay(cell.date, today) : false;
                  const stats = cell.inMonth ? cell.stats : undefined;
                  const hasTrades = stats && stats.count > 0;

                  return (
                    <div
                      key={idx}
                      className={cn(
                        "min-h-[90px] border-b border-r border-border/50 p-2 transition-colors",
                        "last:border-r-0",
                        // remove right border on every 7th cell
                        (idx + 1) % 7 === 0 ? "border-r-0" : "",
                        cell.inMonth
                          ? cn(
                              dayCellBg(stats, true),
                              "hover:brightness-110 cursor-default"
                            )
                          : "bg-transparent"
                      )}
                    >
                      {cell.inMonth && (
                        <div className="flex flex-col h-full gap-1">
                          {/* Day number */}
                          <div className="flex items-start justify-between">
                            <span
                              className={cn(
                                "text-xs font-medium leading-none",
                                isToday
                                  ? "flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-[11px]"
                                  : hasTrades
                                  ? "text-foreground/80"
                                  : "text-muted-foreground/50"
                              )}
                            >
                              {cell.dayNum}
                            </span>

                            {/* Trade count badge */}
                            {hasTrades && (
                              <span className="text-[10px] font-medium text-muted-foreground bg-black/20 rounded px-1 leading-4">
                                {stats.count}
                              </span>
                            )}
                          </div>

                          {/* P&L amount */}
                          {hasTrades && (
                            <div className="flex-1 flex items-end">
                              <span
                                className={cn(
                                  "text-xs font-semibold leading-none",
                                  pnlColor(stats.pnl)
                                )}
                              >
                                {stats.pnl >= 0 ? "+" : ""}
                                {formatCurrency(stats.pnl, 0)}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Empty state when loaded but no closed trades */}
        {!isLoading && monthlySummary.totalCount === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
            <CalendarDays className="h-10 w-10 text-muted-foreground/40" />
            <div>
              <p className="text-base font-medium">No closed trades this month</p>
              <p className="text-sm text-muted-foreground mt-1">
                Trades you close during {format(currentMonth, "MMMM yyyy")} will appear here.
              </p>
            </div>
          </div>
        )}

        {/* Legend */}
        {!isLoading && (
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="font-medium">P&L Legend:</span>
            {[
              { label: "> +$500", cls: "bg-green-500/40" },
              { label: "+$100 – +$500", cls: "bg-green-500/25" },
              { label: "+$1 – +$100", cls: "bg-green-500/15" },
              { label: "$0", cls: "bg-muted/30" },
              { label: "-$1 – -$100", cls: "bg-red-500/15" },
              { label: "-$100 – -$500", cls: "bg-red-500/25" },
              { label: "< -$500", cls: "bg-red-500/40" },
            ].map(({ label, cls }) => (
              <div key={label} className="flex items-center gap-1.5">
                <span className={cn("w-3 h-3 rounded-sm inline-block", cls)} />
                <span>{label}</span>
              </div>
            ))}
          </div>
        )}

        <Separator />

        {/* Monthly summary */}
        {!isLoading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Card className="bg-card/60">
              <CardContent className="pt-5 pb-5">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                  Monthly P&L
                </p>
                <p
                  className={cn(
                    "text-2xl font-bold",
                    pnlColor(monthlySummary.totalPnl)
                  )}
                >
                  {formatCurrency(monthlySummary.totalPnl)}
                </p>
              </CardContent>
            </Card>

            <Card className="bg-card/60">
              <CardContent className="pt-5 pb-5">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                  Total Trades
                </p>
                <p className="text-2xl font-bold">{monthlySummary.totalCount}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  closed trades
                </p>
              </CardContent>
            </Card>

            <Card className="bg-card/60">
              <CardContent className="pt-5 pb-5">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                  Best Day
                </p>
                {monthlySummary.bestDay ? (
                  <>
                    <p className="text-2xl font-bold text-green-400">
                      {formatCurrency(monthlySummary.bestDay.pnl)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {format(monthlySummary.bestDay.date, "MMM d")}
                    </p>
                  </>
                ) : (
                  <p className="text-2xl font-bold text-muted-foreground">—</p>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card/60">
              <CardContent className="pt-5 pb-5">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                  Worst Day
                </p>
                {monthlySummary.worstDay ? (
                  <>
                    <p className="text-2xl font-bold text-red-400">
                      {formatCurrency(monthlySummary.worstDay.pnl)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {format(monthlySummary.worstDay.date, "MMM d")}
                    </p>
                  </>
                ) : (
                  <p className="text-2xl font-bold text-muted-foreground">—</p>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
