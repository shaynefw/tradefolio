import { useMemo, useState } from "react";
import {
  addMonths,
  format,
  getDay,
  getDaysInMonth,
  isSameDay,
  startOfMonth,
  subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { cn, formatCurrency, pnlColor } from "../lib/utils";
import type { BacktestDataset, BacktestTrade } from "./types";

// ---------------------------------------------------------------------------
// Daily aggregation. Skips pending placeholders + open trades (no outcome).
// Uses the trade's date (midnight-local) so the day bucket is stable across
// timezones. Total PnL sums whichever scaling is selected — Premium (default)
// or Speed. When neither PnL is set, the day still counts by trade count but
// contributes $0 to the P&L side.
// ---------------------------------------------------------------------------

interface DayStats {
  key: string;
  date: Date;
  pnl: number;
  count: number;
  wins: number;
  losses: number;
  trades: BacktestTrade[];
}

type Scaling = "premium" | "speed";

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function dayCellBg(stats: DayStats | undefined): string {
  if (!stats || stats.count === 0) return "bg-card/50 text-muted-foreground";
  if (stats.pnl > 0) {
    return "bg-[#002e23] ring-1 ring-inset ring-[#129871] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),inset_0_-2px_0_rgba(0,0,0,0.35),0_1px_2px_rgba(0,0,0,0.4)]";
  }
  if (stats.pnl < 0) {
    return "bg-[#661a1c] ring-1 ring-inset ring-[#df5b5c] shadow-[inset_0_1px_0_rgba(255,255,255,0.1),inset_0_-2px_0_rgba(0,0,0,0.35),0_1px_2px_rgba(0,0,0,0.4)]";
  }
  return "bg-muted/30";
}

function pnlFor(trade: BacktestTrade, which: Scaling): number {
  const row = which === "premium" ? trade.premium : trade.speed;
  return row?.pnl ?? 0;
}

export function BacktestCalendar({ dataset }: { dataset: BacktestDataset }) {
  const [currentMonth, setCurrentMonth] = useState(() => {
    // Start on the month of the most recent trade, or today if the dataset is empty.
    if (dataset.trades.length === 0) return new Date();
    const latest = dataset.trades[dataset.trades.length - 1];
    return startOfMonth(latest.date);
  });
  const [scaling, setScaling] = useState<Scaling>("premium");
  const [selected, setSelected] = useState<DayStats | null>(null);

  const monthStart = startOfMonth(currentMonth);
  const today = new Date();

  // Build per-day stats for the visible month.
  const dayStatsMap = useMemo(() => {
    const map = new Map<string, DayStats>();
    const monthYear = monthStart.getFullYear();
    const monthNum = monthStart.getMonth();
    for (const t of dataset.trades) {
      if (t.isPending || !t.outcome) continue;
      if (t.date.getFullYear() !== monthYear || t.date.getMonth() !== monthNum) continue;
      const midnight = new Date(
        t.date.getFullYear(),
        t.date.getMonth(),
        t.date.getDate(),
      );
      const key = dayKey(midnight);
      const entry = map.get(key) ?? {
        key,
        date: midnight,
        pnl: 0,
        count: 0,
        wins: 0,
        losses: 0,
        trades: [] as BacktestTrade[],
      };
      entry.pnl += pnlFor(t, scaling);
      entry.count += 1;
      if (t.outcome === "Took Profit") entry.wins += 1;
      else if (t.outcome === "Took Loss") entry.losses += 1;
      entry.trades.push(t);
      map.set(key, entry);
    }
    for (const [k, v] of map.entries()) {
      map.set(k, { ...v, pnl: parseFloat(v.pnl.toFixed(2)) });
    }
    return map;
  }, [dataset.trades, monthStart, scaling]);

  // 6×7 grid + a weekly-total column on the right.
  const grid = useMemo(() => {
    const daysInMonth = getDaysInMonth(currentMonth);
    const firstDow = getDay(monthStart);
    return Array.from({ length: 42 }, (_, i) => {
      const dayNum = i - firstDow + 1;
      if (dayNum < 1 || dayNum > daysInMonth) {
        return { dayNum: null as number | null, date: null as Date | null };
      }
      const date = new Date(
        currentMonth.getFullYear(),
        currentMonth.getMonth(),
        dayNum,
      );
      return { dayNum, date };
    });
  }, [currentMonth, monthStart]);

  const weeklyTotals = useMemo(() => {
    const weeks: Array<{ pnl: number; count: number }> = [];
    for (let row = 0; row < 6; row++) {
      let pnl = 0;
      let count = 0;
      for (let col = 0; col < 7; col++) {
        const cell = grid[row * 7 + col];
        if (cell.date) {
          const stats = dayStatsMap.get(dayKey(cell.date));
          if (stats) {
            pnl += stats.pnl;
            count += stats.count;
          }
        }
      }
      weeks.push({ pnl: parseFloat(pnl.toFixed(2)), count });
    }
    return weeks;
  }, [grid, dayStatsMap]);

  const monthTotal = useMemo(() => {
    let pnl = 0;
    let count = 0;
    let wins = 0;
    let losses = 0;
    for (const s of dayStatsMap.values()) {
      pnl += s.pnl;
      count += s.count;
      wins += s.wins;
      losses += s.losses;
    }
    return { pnl: parseFloat(pnl.toFixed(2)), count, wins, losses };
  }, [dayStatsMap]);

  const scalingSet = scaling === "premium"
    ? dataset.premiumStartBalance != null
    : dataset.speedStartBalance != null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="w-28 text-center text-sm font-semibold tabular-nums sm:w-40">
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
          <Button
            variant="ghost"
            size="sm"
            className="ml-2 text-xs text-muted-foreground"
            onClick={() => setCurrentMonth(new Date())}
          >
            Today
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border border-border bg-card/60 p-0.5">
            {(["premium", "speed"] as Scaling[]).map((s) => (
              <button
                key={s}
                onClick={() => setScaling(s)}
                className={cn(
                  "rounded px-3 py-1 text-xs font-medium uppercase transition-colors",
                  scaling === s
                    ? s === "premium"
                      ? "bg-emerald-500/20 text-emerald-200"
                      : "bg-sky-500/20 text-sky-200"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="rounded-md border border-border bg-card/60 px-3 py-1.5 text-xs">
            <span className="text-muted-foreground mr-1">Month:</span>
            <span className={cn("font-semibold tabular-nums", pnlColor(monthTotal.pnl))}>
              {monthTotal.pnl >= 0 ? "+" : ""}
              {formatCurrency(monthTotal.pnl)}
            </span>
            <span className="text-muted-foreground ml-2">
              · {monthTotal.count} trade{monthTotal.count === 1 ? "" : "s"} ({monthTotal.wins}W/{monthTotal.losses}L)
            </span>
          </div>
        </div>
      </div>

      {/* Grid */}
      <Card className="bg-card/60 overflow-hidden">
        <CardContent className="p-0">
          {/* Day-of-week header + weekly column */}
          <div className="grid grid-cols-7 sm:grid-cols-[repeat(7,1fr)_minmax(90px,0.8fr)] border-b border-border">
            {DOW_LABELS.map((d) => (
              <div
                key={d}
                className="py-2 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider"
              >
                {d}
              </div>
            ))}
            <div className="hidden sm:block py-2 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider border-l border-border">
              Weekly
            </div>
          </div>

          {/* Days grid */}
          {Array.from({ length: 6 }, (_, row) => (
            <div
              key={row}
              className="grid grid-cols-7 sm:grid-cols-[repeat(7,1fr)_minmax(90px,0.8fr)]"
            >
              {grid.slice(row * 7, row * 7 + 7).map((cell, colIdx) => {
                const stats = cell.date
                  ? dayStatsMap.get(dayKey(cell.date))
                  : undefined;
                const isToday = cell.date ? isSameDay(cell.date, today) : false;
                const hasTrades = stats && stats.count > 0;
                return (
                  <div
                    key={row * 7 + colIdx}
                    onClick={() => {
                      if (hasTrades) setSelected(stats!);
                    }}
                    className={cn(
                      "min-h-[85px] border-b border-r border-border/50 p-2 transition-all",
                      cell.date
                        ? cn(
                            dayCellBg(stats),
                            hasTrades
                              ? "cursor-pointer hover:brightness-110 hover:-translate-y-px"
                              : "cursor-default",
                          )
                        : "bg-transparent pointer-events-none",
                    )}
                  >
                    {cell.date && (
                      <div className="relative flex h-full flex-col">
                        <span
                          className={cn(
                            "absolute top-0 right-0 text-xs font-medium leading-none",
                            isToday
                              ? "flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-[11px]"
                              : hasTrades
                              ? "text-foreground/80"
                              : "text-muted-foreground/50",
                          )}
                        >
                          {cell.dayNum}
                        </span>
                        {hasTrades && (
                          <div className="flex flex-1 flex-col items-center justify-center gap-0.5 pt-3">
                            <span
                              className={cn(
                                "text-sm sm:text-lg font-bold tabular-nums leading-tight",
                                stats!.pnl >= 0 ? "text-green-300" : "text-red-300",
                              )}
                            >
                              {stats!.pnl >= 0 ? "" : "-"}$
                              {Math.abs(stats!.pnl) >= 1000
                                ? `${(Math.abs(stats!.pnl) / 1000).toFixed(1)}k`
                                : Math.abs(stats!.pnl).toFixed(0)}
                            </span>
                            <span className="text-[10px] text-foreground/60">
                              {stats!.count} trade{stats!.count === 1 ? "" : "s"}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {/* Weekly total (hidden on phones to keep 7 day columns fluid) */}
              <div className="hidden sm:block min-h-[85px] border-b border-l border-border p-2 text-center">
                {weeklyTotals[row].count > 0 && (
                  <div className="flex h-full flex-col items-center justify-center">
                    <span
                      className={cn(
                        "text-sm font-bold tabular-nums",
                        weeklyTotals[row].pnl >= 0 ? "text-green-300" : "text-red-300",
                      )}
                    >
                      {weeklyTotals[row].pnl >= 0 ? "+" : ""}
                      {formatCurrency(weeklyTotals[row].pnl)}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {weeklyTotals[row].count}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {!scalingSet && (
        <p className="text-xs text-muted-foreground">
          Note: {scaling === "premium" ? "Premium" : "Speed"} scaling has no
          starting balance set. Individual trade PnLs still show; totals reflect
          whatever has been entered.
        </p>
      )}

      {/* Day trades dialog */}
      <Dialog open={selected != null} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-lg bg-card">
          <DialogHeader>
            <DialogTitle>
              {selected ? format(selected.date, "EEEE, MMMM d, yyyy") : ""}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Trades</p>
                  <p className="font-semibold">{selected.count}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">W / L</p>
                  <p className="font-semibold">
                    <span className="text-green-300">{selected.wins}</span>
                    <span className="text-muted-foreground">/</span>
                    <span className="text-red-300">{selected.losses}</span>
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    {scaling === "premium" ? "Premium" : "Speed"} P&L
                  </p>
                  <p className={cn("font-semibold tabular-nums", pnlColor(selected.pnl))}>
                    {selected.pnl >= 0 ? "+" : ""}
                    {formatCurrency(selected.pnl)}
                  </p>
                </div>
              </div>
              <div className="max-h-[50vh] overflow-y-auto rounded-md border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-[10px] uppercase text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5 text-left">Time</th>
                      <th className="px-2 py-1.5 text-left">Side</th>
                      <th className="px-2 py-1.5 text-left">Trade</th>
                      <th className="px-2 py-1.5 text-left">Outcome</th>
                      <th className="px-2 py-1.5 text-right">P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.trades.map((t) => (
                      <tr key={t.index} className="border-t border-border/40">
                        <td className="px-2 py-1.5">{t.time}</td>
                        <td className="px-2 py-1.5">
                          <span
                            className={cn(
                              "rounded px-1.5 py-0.5 text-[10px] font-medium",
                              t.side === "LONG"
                                ? "bg-green-500/15 text-green-300"
                                : "bg-blue-500/15 text-blue-300",
                            )}
                          >
                            {t.side}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground">T{t.tradeNo}</td>
                        <td className="px-2 py-1.5">
                          <span
                            className={cn(
                              "rounded px-1.5 py-0.5 text-[10px] font-medium",
                              t.outcome === "Took Profit"
                                ? "bg-emerald-500/15 text-emerald-300"
                                : t.outcome === "Breakeven"
                                ? "bg-slate-500/20 text-slate-300"
                                : "bg-red-500/15 text-red-300",
                            )}
                          >
                            {t.outcome}
                          </span>
                        </td>
                        <td className={cn("px-2 py-1.5 text-right tabular-nums", pnlColor(pnlFor(t, scaling)))}>
                          {formatCurrency(pnlFor(t, scaling))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
