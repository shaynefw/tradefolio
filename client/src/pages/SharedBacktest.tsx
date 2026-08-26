import { useMemo } from "react";
import { useRoute } from "wouter";
import { Loader2, FlaskConical, TrendingUp } from "lucide-react";

import { trpc } from "../lib/trpc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { cn, formatCurrency, pnlColor } from "../lib/utils";
import {
  buildDatasetFromServer,
  type ServerTradeRow,
} from "../backtest/dataSource";
import {
  computeByHour,
  computeByWeekday,
  computeBySide,
  computeByTradeNo,
  computeCoreSummary,
  computeRecoveryStats,
  computeRrBuckets,
  computeScaling,
  computeTargetLadder,
} from "../backtest/calculations";
import { BacktestCalendar } from "../backtest/BacktestCalendar";
import { OverviewTab, TimingTab, ScalingTab } from "./Backtest";

// Public, unauthenticated read-only view of a shared backtest dataset.
export default function SharedBacktest() {
  const [, params] = useRoute("/shared/backtest/:token");
  const token = params?.token ?? "";

  const query = trpc.backtest.dataset.getShared.useQuery(
    { token },
    { enabled: token.length > 0, retry: false },
  );

  const ds = useMemo(() => {
    if (!query.data) return null;
    return buildDatasetFromServer(
      { ...query.data.dataset } as Parameters<typeof buildDatasetFromServer>[0],
      query.data.trades as unknown as ServerTradeRow[],
    );
  }, [query.data]);

  const core = useMemo(() => (ds ? computeCoreSummary(ds) : null), [ds]);
  const byHour = useMemo(() => (ds ? computeByHour(ds) : []), [ds]);
  const byWeekday = useMemo(() => (ds ? computeByWeekday(ds) : []), [ds]);
  const byTradeNo = useMemo(() => (ds ? computeByTradeNo(ds) : []), [ds]);
  const bySide = useMemo(() => (ds ? computeBySide(ds) : []), [ds]);
  const rr = useMemo(() => (ds ? computeRrBuckets(ds) : []), [ds]);
  const targetLadder = useMemo(
    () => (ds ? computeTargetLadder(ds) : []),
    [ds],
  );
  const recovery = useMemo(
    () =>
      ds
        ? computeRecoveryStats(ds)
        : {
            firstCount: 0, firstWins: 0, firstWinRate: 0,
            secondCount: 0, secondWins: 0, secondWinRate: 0,
            totalCount: 0, totalWins: 0, totalWinRate: 0,
          },
    [ds],
  );
  const empty = { tracked: false, start: 0, end: 0, netPnl: 0, trades: 0, maxBalance: 0, minBalance: 0, maxDrawdown: 0, maxDrawdownPercent: 0, milestones: 0, resetCount: 0, firstBlow: null, blows: [], points: [] } as ReturnType<typeof computeScaling>;
  const premium = useMemo(() => (ds ? computeScaling(ds, "premium") : empty), [ds]);
  const speed = useMemo(() => (ds ? computeScaling(ds, "speed") : empty), [ds]);

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-2.5 border-b border-border bg-card/95 px-4 backdrop-blur">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
          <TrendingUp className="h-4 w-4 text-primary-foreground" />
        </div>
        <span className="text-base font-semibold tracking-tight">Tradefolio</span>
        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
          Shared · read-only
        </span>
        <a
          href="/"
          className="ml-auto text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
        >
          Open Tradefolio →
        </a>
      </header>

      <div className="p-4 sm:p-6 space-y-6">
        {query.isLoading && (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {query.isError && (
          <div className="rounded-xl border border-dashed border-border bg-card/40 p-10 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-destructive/15">
              <FlaskConical className="h-6 w-6 text-destructive-foreground" />
            </div>
            <h2 className="text-lg font-semibold">Link unavailable</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {query.error?.message ??
                "This share link is invalid or has been revoked."}
            </p>
          </div>
        )}

        {ds && core && (
          <>
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-bold">{ds.name}</h1>
              <p className="text-sm text-muted-foreground">
                {core.validTrades} valid trades · shared backtest (read-only)
              </p>
            </div>

            {ds.notes && ds.notes.trim() !== "" && (
              <div className="rounded-md border border-border bg-card/40 p-3 text-sm">
                <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
                  Notes / rules
                </p>
                <p className="whitespace-pre-wrap text-foreground/85">{ds.notes}</p>
              </div>
            )}

            <Tabs defaultValue="overview">
              <TabsList className="max-w-full justify-start overflow-x-auto">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="timing">Timing / Sequence</TabsTrigger>
                <TabsTrigger value="scaling">Scaling</TabsTrigger>
                <TabsTrigger value="calendar">Calendar</TabsTrigger>
                <TabsTrigger value="log">Trade Log</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-6 mt-6">
                <OverviewTab core={core} recovery={recovery} premium={premium} speed={speed} />
              </TabsContent>
              <TabsContent value="timing" className="space-y-6 mt-6">
                <TimingTab
                  byHour={byHour}
                  byWeekday={byWeekday}
                  byTradeNo={byTradeNo}
                  bySide={bySide}
                  rr={rr}
                  targetLadder={targetLadder}
                  recovery={recovery}
                  stopPoints={ds.stopBricks * ds.brickPoints}
                />
              </TabsContent>
              <TabsContent value="scaling" className="space-y-6 mt-6">
                <ScalingTab
                  premium={premium}
                  speed={speed}
                  premiumSchedule={ds.premiumScalingSchedule}
                  speedSchedule={ds.speedScalingSchedule}
                  onOpenSettings={() => {}}
                />
              </TabsContent>
              <TabsContent value="calendar" className="space-y-6 mt-6">
                <BacktestCalendar dataset={ds} />
              </TabsContent>
              <TabsContent value="log" className="space-y-4 mt-6">
                <SharedTradeLog dataset={ds} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </div>
  );
}

// Compact read-only trade table for the shared view (no edit/delete/select).
function SharedTradeLog({ dataset }: { dataset: NonNullable<ReturnType<typeof buildDatasetFromServer>> }) {
  const rows = dataset.trades.filter((t) => t.validEntry);
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Date</th>
            <th className="px-3 py-2 text-left">Time</th>
            <th className="px-3 py-2 text-left">Side</th>
            <th className="px-3 py-2 text-left">Trade</th>
            <th className="px-3 py-2 text-right">MAE</th>
            <th className="px-3 py-2 text-right">MFE</th>
            <th className="px-3 py-2 text-left">Outcome</th>
            <th className="px-3 py-2 text-left">Recovery</th>
            <th className="px-3 py-2 text-right">Premium</th>
            <th className="px-3 py-2 text-right">Speed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.index} className="border-t border-border/40">
              <td className="px-3 py-2 whitespace-nowrap">
                {t.date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">{t.time}</td>
              <td className="px-3 py-2">
                <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", t.side === "LONG" ? "bg-green-500/15 text-green-300" : "bg-blue-500/15 text-blue-300")}>
                  {t.side}
                </span>
              </td>
              <td className="px-3 py-2 text-muted-foreground">T{t.tradeNo}</td>
              <td className="px-3 py-2 text-right tabular-nums">{t.mae ?? "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums">{t.mfe ?? "—"}</td>
              <td className="px-3 py-2">
                <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", t.outcome === "Took Profit" ? "bg-emerald-500/15 text-emerald-300" : t.outcome === "Took Loss" ? "bg-red-500/15 text-red-300" : t.outcome === "Breakeven" ? "bg-slate-500/20 text-slate-300" : "bg-muted/40 text-muted-foreground")}>
                  {t.outcome ?? "—"}
                </span>
              </td>
              <td className="px-3 py-2 text-xs">
                {t.recoveryStage === "first" ? "R1" : t.recoveryStage === "second" ? "R2" : ""}
              </td>
              <td className={cn("px-3 py-2 text-right tabular-nums", pnlColor(t.premium?.pnl))}>
                {t.premium ? formatCurrency(t.premium.pnl) : "—"}
              </td>
              <td className={cn("px-3 py-2 text-right tabular-nums", pnlColor(t.speed?.pnl))}>
                {t.speed ? formatCurrency(t.speed.pnl) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
