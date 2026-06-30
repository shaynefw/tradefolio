import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BarChart2,
  Clock,
  Database,
  FlaskConical,
  Layers,
  Loader2,
  Plus,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

import DashboardLayout from "../components/DashboardLayout";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Separator } from "../components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { cn, formatCurrency, pnlColor } from "../lib/utils";
import { trpc } from "../lib/trpc";

import {
  buildDatasetFromServer,
  buildSampleSeed,
  type ServerTradeRow,
} from "../backtest/dataSource";
import { TradeFormModal } from "../backtest/TradeFormModal";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Pencil, Trash2 } from "lucide-react";
import {
  computeByHour,
  computeBySide,
  computeByTradeNo,
  computeCoreSummary,
  computeRecoveryStats,
  computeRrBuckets,
  computeScaling,
} from "../backtest/calculations";
import type { BacktestDataset } from "../backtest/types";

// ---------------------------------------------------------------------------
// Small primitives — kept local so the Analytics page's StatCard layout stays
// the single source of truth for the journal area.
// ---------------------------------------------------------------------------

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
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

function SectionHeader({
  icon: Icon,
  title,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      {hint && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

// Sample-size opacity ramp for the timing charts. Buckets with very few
// trades shouldn't visually compete with buckets that have many — a 100%
// WR built from 4 trades is much weaker evidence than 80% from 100. Steps
// of 15% so each tier is distinguishable on the dark theme.
function opacityForCount(n: number): number {
  if (n >= 110) return 1.0;
  if (n >= 90) return 0.85;
  if (n >= 70) return 0.7;
  if (n >= 50) return 0.55;
  if (n >= 30) return 0.4;
  return 0.25;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const SELECTED_DATASET_KEY = "backtest.selectedDatasetId";

export default function Backtest() {
  const utils = trpc.useUtils();
  const datasetsQuery = trpc.backtest.dataset.list.useQuery();

  // Restore last-picked dataset from localStorage; fall back to the first
  // one the server returns. Keep it in sync with the list (drop the stored
  // id if the dataset was deleted in another tab).
  const [selectedDatasetId, setSelectedDatasetId] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const stored = window.localStorage.getItem(SELECTED_DATASET_KEY);
    return stored ? Number(stored) : null;
  });

  const datasets = useMemo(() => datasetsQuery.data ?? [], [datasetsQuery.data]);
  const activeDatasetId = useMemo<number | null>(() => {
    if (datasets.length === 0) return null;
    if (selectedDatasetId && datasets.some((d) => d.id === selectedDatasetId)) {
      return selectedDatasetId;
    }
    return datasets[0].id;
  }, [datasets, selectedDatasetId]);

  useEffect(() => {
    if (activeDatasetId == null) {
      window.localStorage.removeItem(SELECTED_DATASET_KEY);
    } else {
      window.localStorage.setItem(SELECTED_DATASET_KEY, String(activeDatasetId));
    }
  }, [activeDatasetId]);

  const tradesQuery = trpc.backtest.trade.list.useQuery(
    { datasetId: activeDatasetId ?? -1 },
    { enabled: activeDatasetId != null },
  );

  const activeMeta = useMemo(
    () => datasets.find((d) => d.id === activeDatasetId) ?? null,
    [datasets, activeDatasetId],
  );

  const ds: BacktestDataset | null = useMemo(() => {
    if (!activeMeta || !tradesQuery.data) return null;
    return buildDatasetFromServer(
      activeMeta,
      tradesQuery.data as unknown as ServerTradeRow[],
    );
  }, [activeMeta, tradesQuery.data]);

  // All metric hooks always run; they fall back to zero-state structures
  // when ds is null so the page can mount safely during loading.
  const core = useMemo(
    () => (ds ? computeCoreSummary(ds) : null),
    [ds],
  );
  const byHour = useMemo(() => (ds ? computeByHour(ds) : []), [ds]);
  const byTradeNo = useMemo(() => (ds ? computeByTradeNo(ds) : []), [ds]);
  const bySide = useMemo(() => (ds ? computeBySide(ds) : []), [ds]);
  const rr = useMemo(() => (ds ? computeRrBuckets(ds) : []), [ds]);
  const recovery = useMemo(
    () =>
      ds
        ? computeRecoveryStats(ds)
        : {
            firstCount: 0,
            firstWins: 0,
            firstWinRate: 0,
            secondCount: 0,
            secondWins: 0,
            secondWinRate: 0,
            totalCount: 0,
            totalWins: 0,
            totalWinRate: 0,
          },
    [ds],
  );
  const makeEmptySeries = (): ReturnType<typeof computeScaling> => ({
    tracked: false,
    start: 0,
    end: 0,
    netPnl: 0,
    trades: 0,
    maxBalance: 0,
    minBalance: 0,
    maxDrawdown: 0,
    maxDrawdownPercent: 0,
    milestones: 0,
    resetCount: 0,
    firstBlow: null,
    blows: [],
    points: [],
  });
  const premium = useMemo(
    () => (ds ? computeScaling(ds, "premium") : makeEmptySeries()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ds],
  );
  const speed = useMemo(
    () => (ds ? computeScaling(ds, "speed") : makeEmptySeries()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ds],
  );

  const [tab, setTab] = useState<"overview" | "timing" | "scaling" | "log">("overview");

  // Dataset-create mutation, shared by both empty-state buttons.
  const createDataset = trpc.backtest.dataset.create.useMutation({
    onSuccess: (created) => {
      setSelectedDatasetId(created.id);
      utils.backtest.dataset.list.invalidate();
      toast.success(`Created "${created.name}"`);
    },
    onError: (err) => {
      toast.error(err.message ?? "Failed to create dataset");
    },
  });

  function handleLoadSample() {
    const seed = buildSampleSeed();
    createDataset.mutate({
      name: "MNQ Inverse Renko20 (sample)",
      brickPoints: 20,
      stopBricks: 8,
      takeProfitBricks: 2,
      premiumStartBalance: seed.premiumStartBalance,
      speedStartBalance: seed.speedStartBalance,
      seedTrades: seed.trades,
    });
  }

  function handleCreateBlank() {
    const name = window.prompt("Name this dataset", "New backtest");
    if (!name) return;
    createDataset.mutate({
      name: name.trim(),
      brickPoints: 20,
      stopBricks: 8,
      takeProfitBricks: 2,
    });
  }

  // Rename mutation — uses prompt() so we don't have to build a second modal
  // just for a single text field. Falls back to a toast on cancel/empty.
  const renameDataset = trpc.backtest.dataset.update.useMutation({
    onSuccess: () => {
      utils.backtest.dataset.list.invalidate();
      toast.success("Dataset renamed");
    },
    onError: (err) => toast.error(err.message ?? "Failed to rename"),
  });

  const deleteDatasetMutation = trpc.backtest.dataset.delete.useMutation({
    onSuccess: () => {
      // Drop the local selection so the page falls back to the first
      // remaining dataset (or the empty state).
      setSelectedDatasetId(null);
      utils.backtest.dataset.list.invalidate();
      utils.backtest.trade.list.reset();
      toast.success("Dataset deleted");
    },
    onError: (err) => toast.error(err.message ?? "Failed to delete dataset"),
  });

  const [pendingDatasetDelete, setPendingDatasetDelete] = useState<
    { id: number; name: string; tradeCount: number } | null
  >(null);
  const [scalingSettingsOpen, setScalingSettingsOpen] = useState(false);

  function handleRenameActive() {
    if (!activeMeta) return;
    const next = window.prompt("Rename dataset", activeMeta.name);
    if (!next || next.trim() === activeMeta.name) return;
    renameDataset.mutate({ id: activeMeta.id, name: next.trim() });
  }

  function handleDeleteActive() {
    if (!activeMeta) return;
    const meta = datasets.find((d) => d.id === activeMeta.id);
    if (!meta) return;
    setPendingDatasetDelete({
      id: meta.id,
      name: meta.name,
      tradeCount: meta.tradeCount,
    });
  }

  const isLoading = datasetsQuery.isLoading;
  const isEmpty = !isLoading && datasets.length === 0;
  const isTradesLoading = activeDatasetId != null && tradesQuery.isLoading;

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6">
        {/* Page header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Backtesting</h1>
            <p className="text-sm text-muted-foreground">
              Strategy validation and scenario analysis — separate from your live journal.
            </p>
          </div>
          {datasets.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <DatasetSelector
                datasets={datasets}
                activeId={activeDatasetId}
                onChange={setSelectedDatasetId}
              />
              <button
                type="button"
                onClick={() => setScalingSettingsOpen(true)}
                disabled={!activeMeta}
                title="Scaling settings"
                className="rounded-md border border-border bg-card/60 p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                <Wallet className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={handleRenameActive}
                disabled={!activeMeta || renameDataset.isPending}
                title="Rename dataset"
                className="rounded-md border border-border bg-card/60 p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={handleDeleteActive}
                disabled={!activeMeta || deleteDatasetMutation.isPending}
                title="Delete dataset"
                className="rounded-md border border-border bg-card/60 p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive-foreground disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCreateBlank}
                disabled={createDataset.isPending}
                className="gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" />
                New dataset
              </Button>
            </div>
          )}
        </div>

        {/* Loading the dataset list itself */}
        {isLoading && (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* No datasets yet — empty state */}
        {isEmpty && (
          <EmptyState
            onLoadSample={handleLoadSample}
            onCreateBlank={handleCreateBlank}
            isPending={createDataset.isPending}
          />
        )}

        {/* Have datasets but trades for the active one are loading */}
        {!isLoading && !isEmpty && isTradesLoading && (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Dataset delete confirmation */}
        <AlertDialog
          open={pendingDatasetDelete != null}
          onOpenChange={(o) => !o && setPendingDatasetDelete(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this dataset?</AlertDialogTitle>
              <AlertDialogDescription>
                {pendingDatasetDelete && (
                  <>
                    <span className="font-medium text-foreground">
                      {pendingDatasetDelete.name}
                    </span>{" "}
                    will be removed along with all{" "}
                    {pendingDatasetDelete.tradeCount.toLocaleString()} of its
                    trades. This can't be undone.
                  </>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteDatasetMutation.isPending}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={deleteDatasetMutation.isPending}
                onClick={() => {
                  if (pendingDatasetDelete) {
                    deleteDatasetMutation.mutate(
                      { id: pendingDatasetDelete.id },
                      { onSuccess: () => setPendingDatasetDelete(null) },
                    );
                  }
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleteDatasetMutation.isPending
                  ? "Deleting…"
                  : "Delete dataset"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Scaling settings dialog */}
        {activeMeta && (
          <ScalingSettingsDialog
            open={scalingSettingsOpen}
            onOpenChange={setScalingSettingsOpen}
            datasetId={activeMeta.id}
            initial={{
              premiumStartBalance: activeMeta.premiumStartBalance ?? null,
              speedStartBalance: activeMeta.speedStartBalance ?? null,
            }}
          />
        )}

        {/* Ready to render */}
        {ds && core && (
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList className="bg-card/60">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="timing">Timing / Sequence</TabsTrigger>
              <TabsTrigger value="scaling">Scaling</TabsTrigger>
              <TabsTrigger value="log">Trade Log</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-6 mt-6">
              <OverviewTab
                core={core}
                recovery={recovery}
                premium={premium}
                speed={speed}
              />
            </TabsContent>

            <TabsContent value="timing" className="space-y-6 mt-6">
              <TimingTab
                byHour={byHour}
                byTradeNo={byTradeNo}
                bySide={bySide}
                rr={rr}
                recovery={recovery}
                stopPoints={ds.stopBricks * ds.brickPoints}
              />
            </TabsContent>

            <TabsContent value="scaling" className="space-y-6 mt-6">
              <ScalingTab
                premium={premium}
                speed={speed}
                onOpenSettings={() => setScalingSettingsOpen(true)}
              />
            </TabsContent>

            <TabsContent value="log" className="space-y-6 mt-6">
              <TradeLogTab dataset={ds} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </DashboardLayout>
  );
}

// ---------------------------------------------------------------------------
// Empty state — first-visit experience with two seeding paths.
// ---------------------------------------------------------------------------

function EmptyState({
  onLoadSample,
  onCreateBlank,
  isPending,
}: {
  onLoadSample: () => void;
  onCreateBlank: () => void;
  isPending: boolean;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/40 p-10 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/15">
        <FlaskConical className="h-6 w-6 text-primary" />
      </div>
      <h2 className="text-lg font-semibold">No backtests yet</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Start with the bundled MNQ Inverse Renko20 sample (404 trades) or
        create an empty dataset and add trades by hand.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button onClick={onLoadSample} disabled={isPending} className="gap-1.5">
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Database className="h-4 w-4" />
          )}
          Load MNQ sample
        </Button>
        <Button
          variant="outline"
          onClick={onCreateBlank}
          disabled={isPending}
          className="gap-1.5"
        >
          <Plus className="h-4 w-4" />
          Create blank
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dataset selector — simple dropdown of the user's datasets.
// ---------------------------------------------------------------------------

interface DatasetSelectorProps {
  datasets: Array<{ id: number; name: string; tradeCount: number }>;
  activeId: number | null;
  onChange: (id: number) => void;
}

// ---------------------------------------------------------------------------
// Scaling settings dialog — set the starting balance for Premium / Speed.
// Empty string saves as null = "stop tracking this scaling".
// ---------------------------------------------------------------------------

function ScalingSettingsDialog({
  open,
  onOpenChange,
  datasetId,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  datasetId: number;
  initial: {
    premiumStartBalance: number | null;
    speedStartBalance: number | null;
  };
}) {
  const utils = trpc.useUtils();
  const [premium, setPremium] = useState(
    initial.premiumStartBalance == null
      ? ""
      : String(initial.premiumStartBalance),
  );
  const [speed, setSpeed] = useState(
    initial.speedStartBalance == null ? "" : String(initial.speedStartBalance),
  );

  // Re-sync when the underlying dataset changes (e.g. user switches datasets
  // while the dialog is open or after a save).
  useEffect(() => {
    if (!open) return;
    setPremium(
      initial.premiumStartBalance == null
        ? ""
        : String(initial.premiumStartBalance),
    );
    setSpeed(
      initial.speedStartBalance == null
        ? ""
        : String(initial.speedStartBalance),
    );
  }, [open, initial.premiumStartBalance, initial.speedStartBalance]);

  const mutation = trpc.backtest.dataset.update.useMutation({
    onSuccess: () => {
      utils.backtest.dataset.list.invalidate();
      toast.success("Scaling settings saved");
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message ?? "Failed to save"),
  });

  function parseDollar(s: string): number | null {
    const t = s.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    mutation.mutate({
      id: datasetId,
      premiumStartBalance: parseDollar(premium),
      speedStartBalance: parseDollar(speed),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-card">
        <DialogHeader>
          <DialogTitle>Scaling settings</DialogTitle>
          <DialogDescription>
            Set a starting balance for each scaling. Balances auto-update as
            you add trades. Leave blank to stop tracking that scaling.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              Premium starting balance
            </span>
            <input
              type="number"
              step="any"
              placeholder="$10,000"
              value={premium}
              onChange={(e) => setPremium(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              Speed starting balance
            </span>
            <input
              type="number"
              step="any"
              placeholder="$3,000"
              value={speed}
              onChange={(e) => setSpeed(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </label>
          <DialogFooter className="gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DatasetSelector({ datasets, activeId, onChange }: DatasetSelectorProps) {
  return (
    <label className="flex items-center gap-2 rounded-lg border border-border bg-card/60 px-3 py-2 text-xs">
      <Database className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-muted-foreground">Dataset</span>
      <select
        className="bg-transparent text-sm font-medium text-foreground focus:outline-none"
        value={activeId ?? ""}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {datasets.map((d) => (
          <option key={d.id} value={d.id} className="bg-zinc-900 text-foreground">
            {d.name} ({d.tradeCount})
          </option>
        ))}
      </select>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

function OverviewTab({
  core,
  recovery,
  premium,
  speed,
}: {
  core: ReturnType<typeof computeCoreSummary>;
  recovery: ReturnType<typeof computeRecoveryStats>;
  premium: ReturnType<typeof computeScaling>;
  speed: ReturnType<typeof computeScaling>;
}) {
  return (
    <>
      {/* Headline KPIs */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard
          label="Valid Trades"
          value={<span className="text-foreground">{core.validTrades.toLocaleString()}</span>}
          sub={`${core.invalidTrades} invalid · ${core.totalRows.toLocaleString()} total rows`}
        />
        <StatCard
          label="Win Rate"
          value={
            <span className={core.winRate >= 0.5 ? "text-green-400" : "text-red-400"}>
              {fmtPct(core.winRate)}
            </span>
          }
          sub={`${core.wins}W / ${core.losses}L`}
        />
        <StatCard
          label="Profit Factor (4:1)"
          value={
            <span className={core.profitFactor41 >= 1 ? "text-green-400" : "text-red-400"}>
              {core.profitFactor41 === Infinity ? "∞" : core.profitFactor41.toFixed(2)}
            </span>
          }
          sub="Wins × 1R / Losses × 4R"
        />
        <StatCard
          label="Long / Short WR"
          value={
            <span className="text-foreground text-base font-semibold">
              <span className="text-green-400">{fmtPct(core.longWinRate)}</span>
              <span className="text-muted-foreground mx-2">/</span>
              <span className="text-blue-400">{fmtPct(core.shortWinRate)}</span>
            </span>
          }
          sub={`${core.longCount} long · ${core.shortCount} short`}
        />
        <StatCard
          label="Streaks"
          value={
            <span className="text-foreground">
              {core.maxWinStreak}W / {core.maxLossStreak}L
            </span>
          }
          sub={`Avg win streak ${core.avgWinStreak}`}
        />
        <StatCard
          label="Avg MFE / MAE (Win)"
          value={
            <span className="text-foreground">
              {core.avgMfeWinners} / {core.avgMaeWinners}
              <span className="text-xs text-muted-foreground ml-1">pts</span>
            </span>
          }
          sub="Mean favorable / adverse — winners"
        />
        <StatCard
          label="Avg MFE / MAE (Loss)"
          value={
            <span className="text-foreground">
              {core.avgMfeLosers} / {core.avgMaeLosers}
              <span className="text-xs text-muted-foreground ml-1">pts</span>
            </span>
          }
          sub="Mean favorable / adverse — losers"
        />
        <StatCard
          label="Recovery WR"
          value={
            <span className={recovery.totalWinRate >= 0.5 ? "text-green-400" : "text-red-400"}>
              {fmtPct(recovery.totalWinRate)}
            </span>
          }
          sub={`${recovery.totalWins} / ${recovery.totalCount} attempts · R2 ${fmtPct(recovery.secondWinRate)}`}
        />
        <StatCard
          label="Avg Net Wins / Month"
          value={
            <span className={core.avgNetWinsPerMonth >= 0 ? "text-green-400" : "text-red-400"}>
              {core.avgNetWinsPerMonth >= 0 ? "+" : ""}
              {core.avgNetWinsPerMonth.toFixed(0)}
            </span>
          }
          sub={`(wins − losses) / ${core.monthsSpanned} months`}
        />
      </div>

      <Separator />

      {/* Scaling summary cards */}
      <SectionHeader
        icon={Layers}
        title="Scaling outcomes"
        hint="Two stake schedules applied to the same trade sequence."
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ScalingSummary
          name="Real $ Premium Scaling"
          accent="emerald"
          series={premium}
        />
        <ScalingSummary
          name="Real $ Speed Scaling"
          accent="sky"
          series={speed}
        />
      </div>
    </>
  );
}

function ScalingSummary({
  name,
  accent,
  series,
}: {
  name: string;
  accent: "emerald" | "sky";
  series: ReturnType<typeof computeScaling>;
}) {
  const positive = series.netPnl >= 0;
  const accentClass = accent === "emerald" ? "text-emerald-400" : "text-sky-400";

  if (!series.tracked) {
    return (
      <Card className="bg-card/60">
        <CardContent className="pt-5 pb-5 space-y-2">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-semibold">{name}</p>
            <span className="text-xs text-muted-foreground">not tracked</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Set a starting balance on the Scaling tab to begin tracking.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("bg-card/60", series.firstBlow && "border-red-500/40")}>
      <CardContent className="pt-5 pb-5 space-y-3">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-semibold">{name}</p>
          {series.firstBlow ? (
            <span className="flex items-center gap-1 text-xs font-medium text-red-300">
              <AlertTriangle className="h-3 w-3" />
              blew on #{series.firstBlow.index}
            </span>
          ) : (
            <span className={cn("text-xs", accentClass)}>
              {series.trades} scaling trades
            </span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Start</p>
            <p className="font-semibold">{formatCurrency(series.start)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">End</p>
            <p className="font-semibold">{formatCurrency(series.end)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Net P&L</p>
            <p className={cn("font-semibold", pnlColor(series.netPnl))}>
              {positive ? "+" : ""}
              {formatCurrency(series.netPnl)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Peak</p>
            <p className="font-semibold">{formatCurrency(series.maxBalance)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Max DD</p>
            <p className="font-semibold text-red-400">
              {formatCurrency(-series.maxDrawdown)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">DD %</p>
            <p className="font-semibold text-red-400">
              {series.maxDrawdownPercent.toFixed(1)}%
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Timing / Sequence tab
// ---------------------------------------------------------------------------

function TimingTab({
  byHour,
  byTradeNo,
  bySide,
  rr,
  recovery,
  stopPoints,
}: {
  byHour: ReturnType<typeof computeByHour>;
  byTradeNo: ReturnType<typeof computeByTradeNo>;
  bySide: ReturnType<typeof computeBySide>;
  rr: ReturnType<typeof computeRrBuckets>;
  recovery: ReturnType<typeof computeRecoveryStats>;
  stopPoints: number;
}) {
  const dsStopPoints = stopPoints;
  const hourData = byHour.map((b) => ({
    hour: b.hourLabel,
    winRate: Number((b.winRate * 100).toFixed(1)),
    trades: b.trades,
  }));

  const tradeNoData = byTradeNo.map((b) => ({
    label: b.label,
    winRate: Number((b.winRate * 100).toFixed(1)),
    lwr: Number((b.longWinRate * 100).toFixed(1)),
    swr: Number((b.shortWinRate * 100).toFixed(1)),
    count: b.trades,
  }));

  return (
    <div className="space-y-6">
      {/* Hourly */}
      <section className="space-y-3">
        <SectionHeader
          icon={Clock}
          title="Performance by hour of day"
          hint="Bar opacity reflects sample size — faded bars have few trades, so trust them less."
        />
        <Card className="bg-card/60">
          <CardContent className="pt-4">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={hourData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="hour" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                <YAxis
                  tickFormatter={(v) => `${v}%`}
                  tick={{ fontSize: 11, fill: "#6b7280" }}
                  tickLine={false}
                  axisLine={false}
                  width={42}
                  domain={[0, 100]}
                />
                <RechartsTooltip
                  cursor={{ fill: "rgba(255,255,255,0.04)" }}
                  content={({ active, payload, label }) =>
                    active && payload && payload.length ? (
                      <div className="rounded-lg border border-border bg-zinc-900 px-3 py-2 shadow-xl text-sm">
                        <p className="text-muted-foreground mb-1">{label}</p>
                        <p className="font-semibold text-foreground">
                          <span className="text-muted-foreground mr-2">Win rate:</span>
                          {`${payload[0].value}%`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {(payload[0].payload as { trades?: number })?.trades} trades
                        </p>
                      </div>
                    ) : null
                  }
                />
                <Bar dataKey="winRate" name="Win Rate" fill="#22c55e" radius={[3, 3, 0, 0]} maxBarSize={48} isAnimationActive={false}>
                  {hourData.map((d, i) => (
                    <Cell
                      key={i}
                      fill={d.winRate >= 80 ? "#22c55e" : d.winRate >= 65 ? "#a3e635" : "#ef4444"}
                      fillOpacity={opacityForCount(d.trades)}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-2 grid grid-cols-9 gap-1 px-12 text-center text-[10px] text-muted-foreground">
              {hourData.map((d) => (
                <div key={d.hour} title={`${d.trades} trades`}>
                  n={d.trades}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Trade # */}
      <section className="space-y-3">
        <SectionHeader
          icon={BarChart2}
          title="Performance by intraday trade number"
          hint="T1 = first signal of the day, T2 = second, etc. Bar opacity reflects sample size."
        />
        <Card className="bg-card/60">
          <CardContent className="pt-4">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={tradeNoData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                <YAxis
                  tickFormatter={(v) => `${v}%`}
                  tick={{ fontSize: 11, fill: "#6b7280" }}
                  tickLine={false}
                  axisLine={false}
                  width={42}
                  domain={[0, 100]}
                />
                <RechartsTooltip
                  cursor={{ fill: "rgba(255,255,255,0.04)" }}
                  content={({ active, payload, label }) =>
                    active && payload && payload.length ? (
                      <div className="rounded-lg border border-border bg-zinc-900 px-3 py-2 shadow-xl text-sm">
                        <p className="text-muted-foreground mb-1">{label}</p>
                        {payload.map((p, i) => (
                          <p key={i} className="font-semibold text-foreground">
                            <span className="text-muted-foreground mr-2">{p.name}:</span>
                            {`${p.value}%`}
                          </p>
                        ))}
                        <p className="text-xs text-muted-foreground mt-1">
                          {(payload[0].payload as { count?: number })?.count} trades
                        </p>
                      </div>
                    ) : null
                  }
                />
                <Bar dataKey="winRate" name="WR" fill="#a3e635" radius={[3, 3, 0, 0]} maxBarSize={20} isAnimationActive={false}>
                  {tradeNoData.map((d, i) => (
                    <Cell key={`wr-${i}`} fill="#a3e635" fillOpacity={opacityForCount(d.count)} />
                  ))}
                </Bar>
                <Bar dataKey="lwr" name="Long WR" fill="#22c55e" radius={[3, 3, 0, 0]} maxBarSize={20} isAnimationActive={false}>
                  {tradeNoData.map((d, i) => (
                    <Cell key={`lwr-${i}`} fill="#22c55e" fillOpacity={opacityForCount(d.count) * 0.85} />
                  ))}
                </Bar>
                <Bar dataKey="swr" name="Short WR" fill="#38bdf8" radius={[3, 3, 0, 0]} maxBarSize={20} isAnimationActive={false}>
                  {tradeNoData.map((d, i) => (
                    <Cell key={`swr-${i}`} fill="#38bdf8" fillOpacity={opacityForCount(d.count) * 0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </section>

      {/* Side breakdown + Recovery + RR side by side on wide screens */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="space-y-3">
          <SectionHeader icon={Activity} title="Long vs Short" />
          <Card className="bg-card/60">
            <CardContent className="pt-5 pb-5 space-y-4">
              {bySide.map((s) => (
                <div key={s.side} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      {s.side === "LONG" ? (
                        <ArrowUp className="h-3.5 w-3.5 text-green-400" />
                      ) : (
                        <ArrowDown className="h-3.5 w-3.5 text-blue-400" />
                      )}
                      <span className="font-medium">{s.side}</span>
                    </div>
                    <span className={cn("font-semibold", s.winRate >= 0.5 ? "text-green-400" : "text-red-400")}>
                      {fmtPct(s.winRate)}
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-muted/40 overflow-hidden">
                    <div
                      className={cn(
                        "h-full",
                        s.side === "LONG" ? "bg-green-400" : "bg-blue-400",
                      )}
                      style={{ width: `${(s.winRate * 100).toFixed(1)}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {s.wins}W / {s.losses}L · {s.trades} trades
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        <section className="space-y-3">
          <SectionHeader icon={TrendingUp} title="Recovery cascade" hint="First attempt → second-chance re-entry." />
          <Card className="bg-card/60">
            <CardContent className="pt-5 pb-5 space-y-3">
              <div className="flex items-baseline justify-between border-b border-border/40 pb-2">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Combined WR</p>
                <p className={cn("text-2xl font-bold", recovery.totalWinRate >= 0.5 ? "text-green-400" : "text-red-400")}>
                  {fmtPct(recovery.totalWinRate)}
                </p>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Recovery (1st)</span>
                  <span className="font-semibold">
                    <span className={recovery.firstWinRate >= 0.5 ? "text-green-400" : "text-red-400"}>
                      {fmtPct(recovery.firstWinRate)}
                    </span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {recovery.firstWins} / {recovery.firstCount}
                    </span>
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Recovery 2</span>
                  <span className="font-semibold">
                    <span className={recovery.secondWinRate >= 0.5 ? "text-green-400" : "text-red-400"}>
                      {recovery.secondCount === 0 ? "—" : fmtPct(recovery.secondWinRate)}
                    </span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {recovery.secondWins} / {recovery.secondCount}
                    </span>
                  </span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground pt-1 border-t border-border/40">
                Recovery 1 follows a paper loss; Recovery 2 fires after a failed
                first recovery. Failed first attempts equal the count of second
                attempts.
              </p>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-3">
          <SectionHeader
            icon={Layers}
            title="RR-bucket reach"
            hint={`Threshold = N × stop (${dsStopPoints} pts).`}
          />
          <Card className="bg-card/60">
            <CardContent className="pt-5 pb-5">
              <div className="overflow-hidden rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">RR</th>
                      <th className="px-3 py-2 text-right">WR</th>
                      <th className="px-3 py-2 text-right">Ez$</th>
                      <th className="px-3 py-2 text-right">Trades</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rr.map((r) => (
                      <tr key={r.r} className="border-t border-border/40">
                        <td className="px-3 py-2 font-medium">{r.label}</td>
                        <td className="px-3 py-2 text-right text-green-400 font-semibold">{fmtPct(r.winRate)}</td>
                        <td className="px-3 py-2 text-right text-muted-foreground">{fmtPct(r.ez)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.tradeCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                WR = trades whose MFE reached the 1:N target. Ez$ = 1 − WR — the
                share of "easy" exits that didn't push to N × stop.
              </p>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scaling tab
// ---------------------------------------------------------------------------

function ScalingTab({
  premium,
  speed,
  onOpenSettings,
}: {
  premium: ReturnType<typeof computeScaling>;
  speed: ReturnType<typeof computeScaling>;
  onOpenSettings: () => void;
}) {
  return (
    <div className="space-y-6">
      <ScalingChart
        name="Real $ Premium Scaling"
        series={premium}
        colorA="#22c55e"
        onOpenSettings={onOpenSettings}
      />
      <ScalingChart
        name="Real $ Speed Scaling"
        series={speed}
        colorA="#38bdf8"
        onOpenSettings={onOpenSettings}
      />
    </div>
  );
}

function ScalingChart({
  name,
  series,
  colorA,
  onOpenSettings,
}: {
  name: string;
  series: ReturnType<typeof computeScaling>;
  colorA: string;
  onOpenSettings: () => void;
}) {
  const gradientId = `grad-${name.replace(/\W+/g, "")}`;

  // Not tracked yet → prompt the user to set a starting balance instead of
  // rendering an empty chart.
  if (!series.tracked) {
    return (
      <section className="space-y-3">
        <SectionHeader icon={TrendingUp} title={name} />
        <Card className="bg-card/60">
          <CardContent className="py-10 text-center">
            <p className="text-sm font-medium text-foreground">
              Not tracking this scaling yet
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Set a starting balance and we'll auto-update it as you add trades.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={onOpenSettings}
              className="mt-4 gap-1.5"
            >
              <Wallet className="h-3.5 w-3.5" />
              Set starting balance
            </Button>
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <SectionHeader icon={TrendingUp} title={name} />
      <Card className="bg-card/60">
        <CardContent className="pt-4">
          {/* Blow banner — the account went ≤ $0 at some point */}
          {series.firstBlow && (
            <div className="mb-3 flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <div className="flex-1">
                <p className="font-semibold text-red-300">
                  Account blew on trade #{series.firstBlow.index}
                  <span className="text-red-400/80 font-normal">
                    {" · "}{series.firstBlow.date} · balance{" "}
                    {formatCurrency(series.firstBlow.balance)}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-red-300/70">
                  Open the trade and use "Reset balance after this trade" to declare a new starting point.
                </p>
              </div>
            </div>
          )}
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={series.points} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={colorA} stopOpacity={0.4} />
                  <stop offset="95%" stopColor={colorA} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis
                dataKey="index"
                tick={{ fontSize: 11, fill: "#6b7280" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `#${v}`}
              />
              <YAxis
                tickFormatter={(v) => formatCurrency(v, 0)}
                tick={{ fontSize: 11, fill: "#6b7280" }}
                tickLine={false}
                axisLine={false}
                width={70}
                domain={["dataMin", "dataMax"]}
              />
              <RechartsTooltip
                cursor={{ fill: "rgba(255,255,255,0.04)" }}
                content={({ active, payload }) => {
                  if (!active || !payload || !payload.length) return null;
                  const p = payload[0].payload as {
                    index: number;
                    date: string;
                    balance: number;
                    pnl: number;
                    label: string | null;
                  };
                  return (
                    <div className="rounded-lg border border-border bg-zinc-900 px-3 py-2 shadow-xl text-sm">
                      <p className="text-muted-foreground mb-1">
                        #{p.index} · {p.date}
                      </p>
                      <p className="font-semibold text-foreground">{formatCurrency(p.balance)}</p>
                      <p className={cn("text-xs", pnlColor(p.pnl))}>
                        {p.pnl >= 0 ? "+" : ""}
                        {formatCurrency(p.pnl)}
                      </p>
                    </div>
                  );
                }}
              />
              <ReferenceLine y={series.start} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />
              <ReferenceLine y={0} stroke="rgba(239,68,68,0.4)" strokeDasharray="2 2" />
              {series.firstBlow && (
                <ReferenceLine
                  x={series.firstBlow.index}
                  stroke="#ef4444"
                  strokeWidth={2}
                  strokeDasharray="4 2"
                  label={{ value: "BLEW", fill: "#ef4444", fontSize: 10, position: "top" }}
                />
              )}
              <Area
                type="monotone"
                dataKey="balance"
                stroke={colorA}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>

          <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Start → End</p>
              <p className="font-semibold">
                {formatCurrency(series.start)} → {formatCurrency(series.end)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Net P&L</p>
              <p className={cn("font-semibold", pnlColor(series.netPnl))}>
                {series.netPnl >= 0 ? "+" : ""}
                {formatCurrency(series.netPnl)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Max DD</p>
              <p className="font-semibold text-red-400">
                {formatCurrency(-series.maxDrawdown)} ({series.maxDrawdownPercent.toFixed(1)}%)
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                {series.resetCount > 0 ? "Resets" : "Events"}
              </p>
              <p className="font-semibold">
                {series.resetCount > 0
                  ? `${series.resetCount} reset${series.resetCount !== 1 ? "s" : ""}`
                  : `${series.milestones} labeled`}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}


// ---------------------------------------------------------------------------
// Trade Log tab
// ---------------------------------------------------------------------------

type SideFilter = "all" | "LONG" | "SHORT";
type OutcomeFilter = "all" | "Took Profit" | "Took Loss";
type SortKey =
  | "newest"
  | "oldest"
  | "dateDesc"
  | "dateAsc"
  | "mfeDesc"
  | "mfeAsc"
  | "maeDesc"
  | "maeAsc";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "newest", label: "Newest added" },
  { value: "oldest", label: "Oldest added" },
  { value: "dateDesc", label: "Date — latest first" },
  { value: "dateAsc", label: "Date — earliest first" },
  { value: "mfeDesc", label: "MFE high → low" },
  { value: "mfeAsc", label: "MFE low → high" },
  { value: "maeDesc", label: "MAE high → low" },
  { value: "maeAsc", label: "MAE low → high" },
];

// Stable sort: missing values (null MAE/MFE) sink to the end on both ascending
// and descending so a row missing data never displaces a row with data.
function sortTrades(
  rows: BacktestDataset["trades"],
  key: SortKey,
): BacktestDataset["trades"] {
  const withIdx = rows.map((r, i) => ({ r, i }));
  withIdx.sort((a, b) => {
    const cmp = (() => {
      switch (key) {
        case "newest":
          return b.r.index - a.r.index;
        case "oldest":
          return a.r.index - b.r.index;
        case "dateDesc":
          return b.r.date.getTime() - a.r.date.getTime();
        case "dateAsc":
          return a.r.date.getTime() - b.r.date.getTime();
        case "mfeDesc":
          return nullsLast(a.r.mfe, b.r.mfe, true);
        case "mfeAsc":
          return nullsLast(a.r.mfe, b.r.mfe, false);
        case "maeDesc":
          return nullsLast(a.r.mae, b.r.mae, true);
        case "maeAsc":
          return nullsLast(a.r.mae, b.r.mae, false);
      }
    })();
    return cmp !== 0 ? cmp : a.i - b.i;
  });
  return withIdx.map((x) => x.r);
}

function nullsLast(a: number | null, b: number | null, desc: boolean): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return desc ? b - a : a - b;
}

function TradeLogTab({ dataset }: { dataset: BacktestDataset }) {
  // buildDatasetFromServer stashes the dataset id; the modal mutations need it.
  const datasetId = dataset.id;

  const [side, setSide] = useState<SideFilter>("all");
  const [outcome, setOutcome] = useState<OutcomeFilter>("all");
  const [recovery, setRecovery] = useState<"all" | "yes" | "no">("all");
  const [sortKey, setSortKey] = useState<SortKey>("newest");
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const [modalOpen, setModalOpen] = useState(false);
  const [editingTrade, setEditingTrade] = useState<typeof dataset.trades[number] | null>(null);
  const [pendingDelete, setPendingDelete] = useState<typeof dataset.trades[number] | null>(null);

  const utils = trpc.useUtils();
  const deleteMutation = trpc.backtest.trade.delete.useMutation({
    onSuccess: () => {
      if (datasetId != null) {
        utils.backtest.trade.list.invalidate({ datasetId });
      }
      utils.backtest.dataset.list.invalidate();
      toast.success("Trade deleted");
      setPendingDelete(null);
    },
    onError: (err) => toast.error(err.message ?? "Failed to delete trade"),
  });

  const rows = useMemo(() => {
    const filtered = dataset.trades.filter((t) => {
      if (!t.validEntry) return false;
      if (side !== "all" && t.side !== side) return false;
      if (outcome !== "all" && t.outcome !== outcome) return false;
      if (recovery === "yes" && t.recoveryStage === "none") return false;
      if (recovery === "no" && t.recoveryStage !== "none") return false;
      return true;
    });
    return sortTrades(filtered, sortKey);
  }, [dataset.trades, side, outcome, recovery, sortKey]);

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const visible = rows.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <div className="space-y-4">
      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterGroup
          label="Side"
          value={side}
          onChange={(v) => {
            setSide(v as SideFilter);
            setPage(0);
          }}
          options={[
            { value: "all", label: "All" },
            { value: "LONG", label: "Long" },
            { value: "SHORT", label: "Short" },
          ]}
        />
        <FilterGroup
          label="Outcome"
          value={outcome}
          onChange={(v) => {
            setOutcome(v as OutcomeFilter);
            setPage(0);
          }}
          options={[
            { value: "all", label: "All" },
            { value: "Took Profit", label: "Wins" },
            { value: "Took Loss", label: "Losses" },
          ]}
        />
        <FilterGroup
          label="Recovery"
          value={recovery}
          onChange={(v) => {
            setRecovery(v as "all" | "yes" | "no");
            setPage(0);
          }}
          options={[
            { value: "all", label: "All" },
            { value: "yes", label: "Recovery" },
            { value: "no", label: "Regular" },
          ]}
        />
        <label className="flex items-center gap-2 rounded-lg border border-border bg-card/60 px-2 py-1">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            Sort
          </span>
          <select
            value={sortKey}
            onChange={(e) => {
              setSortKey(e.target.value as SortKey);
              setPage(0);
            }}
            className="bg-transparent text-xs text-foreground focus:outline-none"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value} className="bg-zinc-900">
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <span className="ml-auto text-xs text-muted-foreground">
          {rows.length.toLocaleString()} rows · page {page + 1} of {pageCount}
        </span>
        {datasetId != null && (
          <Button
            size="sm"
            onClick={() => {
              setEditingTrade(null);
              setModalOpen(true);
            }}
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            Add trade
          </Button>
        )}
      </div>

      <Card className="bg-card/60">
        <CardContent className="pt-4 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Time</th>
                  <th className="px-3 py-2 text-left">Side</th>
                  <th className="px-3 py-2 text-left">Trade</th>
                  <th className="px-3 py-2 text-right">MAE (pts)</th>
                  <th className="px-3 py-2 text-right">MFE (pts)</th>
                  <th className="px-3 py-2 text-left">Outcome</th>
                  <th className="px-3 py-2 text-left">Recovery</th>
                  <th className="px-3 py-2 text-right">Premium</th>
                  <th className="px-3 py-2 text-right">Speed</th>
                  <th className="px-3 py-2 text-right w-20">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => (
                  <tr key={t.index} className="group border-t border-border/40 hover:bg-accent/20">
                    <td className="px-3 py-2 whitespace-nowrap">
                      {t.date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{t.time}</td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-xs font-medium",
                          t.side === "LONG"
                            ? "bg-green-500/15 text-green-300"
                            : "bg-blue-500/15 text-blue-300",
                        )}
                      >
                        {t.side}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">T{t.tradeNo}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{t.mae ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{t.mfe ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-xs font-medium",
                          t.outcome === "Took Profit"
                            ? "bg-emerald-500/15 text-emerald-300"
                            : t.outcome === "Took Loss"
                            ? "bg-red-500/15 text-red-300"
                            : "bg-muted/40 text-muted-foreground",
                        )}
                      >
                        {t.outcome ?? "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {t.recoveryStage === "first" ? (
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-medium text-amber-300">R1</span>
                      ) : t.recoveryStage === "second" ? (
                        <span className="rounded bg-orange-500/20 px-1.5 py-0.5 font-medium text-orange-300">R2</span>
                      ) : (
                        ""
                      )}
                    </td>
                    <td className={cn("px-3 py-2 text-right tabular-nums", pnlColor(t.premium?.pnl))}>
                      {t.premium ? formatCurrency(t.premium.pnl) : "—"}
                    </td>
                    <td className={cn("px-3 py-2 text-right tabular-nums", pnlColor(t.speed?.pnl))}>
                      {t.speed ? formatCurrency(t.speed.pnl) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        {t.id != null && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingTrade(t);
                                setModalOpen(true);
                              }}
                              title="Edit trade"
                              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setPendingDelete(t)}
                              title="Delete trade"
                              className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive-foreground"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-border/40 px-3 py-2 text-xs text-muted-foreground">
            <div>
              Showing {visible.length === 0 ? 0 : page * pageSize + 1}–{page * pageSize + visible.length}
            </div>
            <div className="flex items-center gap-2">
              <button
                className="rounded border border-border bg-muted/40 px-2 py-1 disabled:opacity-40"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                Prev
              </button>
              <button
                className="rounded border border-border bg-muted/40 px-2 py-1 disabled:opacity-40"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={page >= pageCount - 1}
              >
                Next
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Add / Edit modal */}
      {datasetId != null && (
        <TradeFormModal
          open={modalOpen}
          onOpenChange={(o) => {
            setModalOpen(o);
            if (!o) setEditingTrade(null);
          }}
          datasetId={datasetId}
          editingTrade={editingTrade}
        />
      )}

      {/* Delete confirmation */}
      <AlertDialog
        open={pendingDelete != null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this trade?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete && (
                <>
                  {pendingDelete.date.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}{" "}
                  · {pendingDelete.side} · T{pendingDelete.tradeNo} ·{" "}
                  {pendingDelete.outcome ?? "open"}
                  <br />
                  This can't be undone — metrics on every tab will recompute.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (pendingDelete?.id != null) {
                  deleteMutation.mutate({ id: pendingDelete.id });
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete trade"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FilterGroup({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card/60 px-2 py-1">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="flex gap-1">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-md px-2 py-1 text-xs transition-colors",
              value === o.value
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

