import { useState, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { trpc } from "../lib/trpc";
import { useAccount } from "../contexts/AccountContext";
import { useStrategy } from "../contexts/StrategyContext";
import { useDateRange } from "../contexts/DateRangeContext";
import { cn, formatCurrency, formatDate, pnlColor } from "../lib/utils";
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
import { ShareImageButton } from "../components/ShareImageButton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Badge } from "../components/ui/badge";
import {
  ChevronLeft,
  ChevronRight,
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

interface DayTrade {
  id: number;
  symbol: string;
  side: string;
  netPnl: number | null;
  exitDate: number | null;
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
  if (pnl > 0) return "bg-green-600/30 border-green-500/40";
  if (pnl < 0) return "bg-red-600/30 border-red-500/40";
  return "bg-muted/30";
}

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ---------------------------------------------------------------------------
// Calendar page
// ---------------------------------------------------------------------------

export default function Calendar() {
  const [, navigate] = useLocation();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const { selectedAccountId, accounts, setSelectedAccountId } = useAccount();
  const { selectedStrategyId } = useStrategy();
  const { startDate, endDate } = useDateRange();
  const [selectedDay, setSelectedDay] = useState<{ date: Date; trades: DayTrade[] } | null>(null);
  const shareableRef = useRef<HTMLDivElement>(null);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);

  // The server filters by entryDate in its own (UTC on Vercel) timezone, so a
  // trade that's local-dated within this month can have a UTC timestamp on
  // the next or previous day. Widen the server query by ±2 days; the client
  // does the precise local-time filtering below in `monthTrades`.
  const DAY_MS = 86_400_000;
  const queryStartTs = monthStart.getTime() - 2 * DAY_MS;
  const queryEndTs = monthEnd.getTime() + 2 * DAY_MS;
  const queryStart = startDate
    ? tsToStr(Math.max(startDate, queryStartTs))
    : tsToStr(queryStartTs);
  const queryEnd = endDate
    ? tsToStr(Math.min(endDate, queryEndTs))
    : tsToStr(queryEndTs);

  const { data: trades = [], isLoading } = trpc.trade.list.useQuery({
    accountId: selectedAccountId ?? undefined,
    strategyId: selectedStrategyId ?? undefined,
    startDate: queryStart,
    endDate: queryEnd,
  });

  // ---------------------------------------------------------------------------
  // Filter trades to those that closed within the visible local-time month.
  // The server filters by entryDate in MM/dd/yyyy and runs in UTC, so trades
  // near midnight can leak in/out due to timezone mismatch. Clamping client-
  // side keeps the calendar self-consistent regardless of server timezone.
  // ---------------------------------------------------------------------------

  const monthTrades = useMemo(() => {
    const start = monthStart.getTime();
    const end = monthEnd.getTime();
    return trades.filter((t) => {
      if (t.status !== "closed" || t.exitDate == null) return false;
      return t.exitDate >= start && t.exitDate <= end;
    });
  }, [trades, monthStart, monthEnd]);

  // ---------------------------------------------------------------------------
  // Build per-day stats map
  // ---------------------------------------------------------------------------

  const dayStatsMap = useMemo(() => {
    const map = new Map<string, DayStats>();

    for (const trade of monthTrades) {
      if (trade.netPnl == null) continue;
      const exitTs = trade.exitDate!;
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
  }, [monthTrades]);

  // ---------------------------------------------------------------------------
  // Build per-day trades map for click dialog
  // ---------------------------------------------------------------------------

  const dayTradesMap = useMemo(() => {
    const map = new Map<string, DayTrade[]>();
    for (const trade of monthTrades) {
      const key = format(new Date(trade.exitDate!), "yyyy-MM-dd");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({
        id: trade.id,
        symbol: trade.symbol,
        side: trade.side,
        netPnl: trade.netPnl ?? null,
        exitDate: trade.exitDate ?? null,
      });
    }
    return map;
  }, [monthTrades]);

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
  // Weekly totals (one per row = 6 rows)
  // ---------------------------------------------------------------------------

  const weeklyTotals = useMemo(() => {
    const weeks: Array<{ pnl: number; count: number }> = [];
    for (let row = 0; row < 6; row++) {
      let pnl = 0;
      let count = 0;
      for (let col = 0; col < 7; col++) {
        const cell = calendarGrid[row * 7 + col];
        if (cell?.inMonth && cell.stats) {
          pnl += cell.stats.pnl;
          count += cell.stats.count;
        }
      }
      weeks.push({ pnl: parseFloat(pnl.toFixed(2)), count });
    }
    return weeks;
  }, [calendarGrid]);

  // ---------------------------------------------------------------------------
  // Monthly summary stats
  // ---------------------------------------------------------------------------

  const monthlySummary = useMemo(() => {
    const closedTrades = monthTrades.filter((t) => t.netPnl != null);

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
  }, [monthTrades, dayStatsMap]);

  const today = new Date();

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6">
        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Calendar</h1>
            <p className="text-sm text-muted-foreground">
              Daily P&L heatmap view
            </p>
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
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

            <ShareImageButton
              target={shareableRef}
              filename={`tradefolio-calendar-${format(currentMonth, "yyyy-MM")}`}
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

        {/* Loading spinner */}
        {isLoading && (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Shareable region: calendar grid + summary */}
        <div ref={shareableRef} className="flex flex-col gap-6 bg-background">
        {/* Calendar grid */}
        {!isLoading && (
          <Card className="bg-card/60 overflow-hidden">
            <CardContent className="p-0">
              {/* Day of week header + Week column */}
              <div className="grid grid-cols-[repeat(7,1fr)_minmax(60px,0.7fr)] sm:grid-cols-[repeat(7,1fr)_minmax(90px,0.8fr)] border-b border-border">
                {DOW_LABELS.map((d) => (
                  <div
                    key={d}
                    className="py-2 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider"
                  >
                    {d}
                  </div>
                ))}
                <div className="py-2 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider border-l border-border">
                  Weekly
                </div>
              </div>

              {/* Days grid with weekly totals */}
              {Array.from({ length: 6 }, (_, row) => (
                <div key={row} className="grid grid-cols-[repeat(7,1fr)_minmax(60px,0.7fr)] sm:grid-cols-[repeat(7,1fr)_minmax(90px,0.8fr)]">
                  {calendarGrid.slice(row * 7, row * 7 + 7).map((cell, colIdx) => {
                    const idx = row * 7 + colIdx;
                    const isToday =
                      cell.date ? isSameDay(cell.date, today) : false;
                    const stats = cell.inMonth ? cell.stats : undefined;
                    const hasTrades = stats && stats.count > 0;

                    return (
                      <div
                        key={idx}
                        onClick={() => {
                          if (!cell.inMonth || !cell.date) return;
                          const key = format(cell.date, "yyyy-MM-dd");
                          const dayTrades = dayTradesMap.get(key) ?? [];
                          if (dayTrades.length > 0) {
                            setSelectedDay({ date: cell.date, trades: dayTrades });
                          }
                        }}
                        className={cn(
                          "min-h-[60px] sm:min-h-[90px] border-b border-r border-border/50 p-1.5 sm:p-2 transition-colors",
                          cell.inMonth
                            ? cn(
                                dayCellBg(stats, true),
                                hasTrades
                                  ? "hover:brightness-110 cursor-pointer"
                                  : "cursor-default"
                              )
                            : "bg-transparent"
                        )}
                      >
                        {cell.inMonth && (
                          <div className="relative flex h-full flex-col">
                            {/* Day number, pinned to top-right */}
                            <span
                              className={cn(
                                "absolute top-0 right-0 text-xs font-medium leading-none",
                                isToday
                                  ? "flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-[11px]"
                                  : hasTrades
                                  ? "text-foreground/80"
                                  : "text-muted-foreground/50"
                              )}
                            >
                              {cell.dayNum}
                            </span>

                            {/* P&L + trade count, centered */}
                            {hasTrades && (
                              <div className="flex flex-1 flex-col items-center justify-center gap-0.5 pt-3">
                                <span
                                  className={cn(
                                    "text-sm sm:text-lg font-bold leading-tight tabular-nums",
                                    stats.pnl >= 0 ? "text-green-400" : "text-red-400"
                                  )}
                                >
                                  {stats.pnl >= 0 ? "" : "-"}$
                                  {Math.abs(stats.pnl) >= 1000
                                    ? `${(Math.abs(stats.pnl) / 1000).toFixed(1)}k`
                                    : Math.abs(stats.pnl).toFixed(0)}
                                </span>
                                <span className="text-[10px] sm:text-xs text-muted-foreground">
                                  {stats.count} trade{stats.count !== 1 ? "s" : ""}
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Weekly total cell */}
                  <div className="min-h-[60px] sm:min-h-[90px] border-b border-border/50 border-l border-border p-1.5 sm:p-2 flex flex-col items-center justify-center gap-0.5 bg-card/30">
                    <span className="text-[9px] sm:text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Wk {row + 1}
                    </span>
                    <span
                      className={cn(
                        "text-xs sm:text-base font-bold",
                        weeklyTotals[row].count > 0
                          ? pnlColor(weeklyTotals[row].pnl)
                          : "text-muted-foreground"
                      )}
                    >
                      {formatCurrency(weeklyTotals[row].pnl, 0)}
                    </span>
                    <span className="text-[9px] sm:text-[10px] text-muted-foreground hidden sm:block">
                      {weeklyTotals[row].count} trade{weeklyTotals[row].count !== 1 ? "s" : ""}
                    </span>
                  </div>
                </div>
              ))}
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
            <span className="font-medium">Legend:</span>
            {[
              { label: "Profit day", cls: "bg-green-600/30 border border-green-500/40" },
              { label: "Loss day", cls: "bg-red-600/30 border border-red-500/40" },
              { label: "No trades", cls: "bg-card/50 border border-border" },
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
                    <p
                      className={cn(
                        "text-2xl font-bold",
                        pnlColor(monthlySummary.bestDay.pnl)
                      )}
                    >
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
                    <p
                      className={cn(
                        "text-2xl font-bold",
                        pnlColor(monthlySummary.worstDay.pnl)
                      )}
                    >
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
        {/* /Shareable region */}
      </div>

      {/* Day detail dialog */}
      <Dialog open={selectedDay !== null} onOpenChange={(o) => { if (!o) setSelectedDay(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {selectedDay ? format(selectedDay.date, "EEEE, MMMM d, yyyy") : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1 max-h-[60vh] overflow-y-auto">
            {selectedDay?.trades.map((trade) => (
              <div
                key={trade.id}
                className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-accent cursor-pointer transition-colors"
                onClick={() => {
                  setSelectedDay(null);
                  navigate(`/trades/${trade.id}`);
                }}
              >
                <div className="flex items-center gap-3">
                  <span className="font-medium text-sm">{trade.symbol}</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-xs",
                      trade.side === "long"
                        ? "border-blue-500 text-blue-400"
                        : "border-orange-500 text-orange-400"
                    )}
                  >
                    {trade.side}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(trade.exitDate)}
                  </span>
                </div>
                <span
                  className={cn(
                    "text-sm font-semibold tabular-nums",
                    pnlColor(trade.netPnl)
                  )}
                >
                  {trade.netPnl != null
                    ? (trade.netPnl >= 0 ? "+" : "") + formatCurrency(trade.netPnl)
                    : "—"}
                </span>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
