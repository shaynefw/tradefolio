import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BarChart2,
  Clock,
  CalendarDays,
  Database,
  Download,
  FlaskConical,
  Layers,
  Loader2,
  Plus,
  Settings,
  Target,
  ChevronDown,
  TrendingDown,
  TrendingUp,
  Upload,
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
import { BacktestCalendar } from "../backtest/BacktestCalendar";
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
import { Pencil, StickyNote, Trash2 } from "lucide-react";
import {
  computeByHour,
  computeByWeekday,
  computeWeekly,
  computeBySide,
  computeByTradeNo,
  computeCoreSummary,
  computeRecoveryStats,
  computeRrBuckets,
  computeScaling,
  computeTargetLadder,
} from "../backtest/calculations";
import type {
  BacktestDataset,
  RrBucketConfig,
  ScalingLevel,
  ScalingSchedule,
} from "../backtest/types";
import {
  IRENKO20_PREMIUM_SCHEDULE,
  IRENKO20_SPEED_SCHEDULE,
} from "../backtest/scaling";

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

// Small inline stat tile (label + value), tone-colored by sign when given.
// Lighter-weight than StatCard — for use inside an existing card.
function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: number;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-background/40 p-2.5">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 font-semibold tabular-nums",
          tone !== undefined ? pnlColor(tone) : "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
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

// Streak-odds cell labels. `oddsLabel` is the in-sample probability (headline);
// `perAttemptLabel` is the raw back-to-back odds shown on hover.
function oddsLabel(length: number, inSample: number): string {
  if (length <= 0) return "—";
  const pct = inSample * 100;
  if (pct >= 99.95) return ">99.9%";
  if (pct > 0 && pct < 0.1) return "<0.1%";
  return `${pct.toFixed(1)}%`;
}
// Short back-to-back odds for a cell subtext (e.g. "36.0%").
function perAttemptShort(length: number, perAttempt: number): string {
  if (length <= 0 || perAttempt <= 0) return "—";
  const pct = perAttempt * 100;
  if (pct >= 99.95) return ">99.9%";
  if (pct < 0.1) return "<0.1%";
  return `${pct.toFixed(1)}%`;
}
function perAttemptLabel(length: number, perAttempt: number): string {
  if (length <= 0 || perAttempt <= 0) return "";
  const pct = perAttempt * 100;
  const one = Math.round(1 / perAttempt);
  const pctStr = pct < 0.1 ? pct.toPrecision(2) : pct.toFixed(2);
  const lenStr = Number.isInteger(length) ? String(length) : length.toFixed(1);
  return `Back-to-back: ${lenStr} in a row = ${pctStr}% (~1 in ${one.toLocaleString()})`;
}
function inSampleLabel(length: number, inSample: number): string {
  if (length <= 0) return "";
  return `Appears somewhere in your sample: ${oddsLabel(length, inSample)}`;
}

// A streak-metric cell: the count on top with an odds figure as subtext.
// `primary` picks which odds is the headline — in-sample for the longest
// streak ("was it unusual?"), back-to-back for the average ("odds of a typical
// run"), since in-sample is ~certain for short average lengths. The other odds
// is on hover. `lenForTip` overrides the length used (for the fractional avg).
function StreakCell({
  count,
  inSample,
  perAttempt,
  lenForTip,
  primary = "inSample",
}: {
  count: number | string;
  inSample: number;
  perAttempt: number;
  lenForTip?: number;
  primary?: "inSample" | "perAttempt";
}) {
  const len = lenForTip ?? (typeof count === "number" ? count : 0);
  const subtext =
    primary === "inSample"
      ? oddsLabel(len, inSample)
      : perAttemptShort(len, perAttempt);
  const title =
    primary === "inSample"
      ? perAttemptLabel(len, perAttempt)
      : inSampleLabel(len, inSample);
  return (
    <td
      className="px-3 py-2 text-right align-top tabular-nums"
      title={title}
    >
      <div className="font-semibold">{count}</div>
      <div className="text-[11px] font-semibold text-cyan-300">
        {subtext}
      </div>
    </td>
  );
}

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

// Lifecycle status of a dataset, color-coded in the switcher.
export type DatasetStatus = "active" | "paused" | "discontinued";

export const DATASET_STATUS_META: Record<
  DatasetStatus,
  { label: string; dot: string; text: string; badge: string }
> = {
  active: {
    label: "Active",
    dot: "#22c55e",
    text: "text-green-400",
    badge: "bg-green-500/15 text-green-300",
  },
  paused: {
    label: "Paused",
    dot: "#eab308",
    text: "text-yellow-400",
    badge: "bg-yellow-500/15 text-yellow-300",
  },
  discontinued: {
    label: "Discontinued",
    dot: "#ef4444",
    text: "text-red-400",
    badge: "bg-red-500/15 text-red-300",
  },
};

const DATASET_STATUS_ORDER: DatasetStatus[] = ["active", "paused", "discontinued"];

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
  const byWeekday = useMemo(() => (ds ? computeByWeekday(ds) : []), [ds]);
  const weekly = useMemo(() => (ds ? computeWeekly(ds) : null), [ds]);
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

  const [tab, setTab] = useState<
    "overview" | "timing" | "scaling" | "calendar" | "log"
  >("overview");

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

  // Import backup — a hidden file input triggered by the header button.
  const importMutation = trpc.backtest.dataset.importBackup.useMutation({
    onSuccess: (result) => {
      setSelectedDatasetId(result.dataset.id);
      utils.backtest.dataset.list.invalidate();
      toast.success(
        `Imported "${result.dataset.name}" (${result.importedTrades} trade${result.importedTrades === 1 ? "" : "s"})`,
      );
    },
    onError: (err) => {
      // CONFLICT surfaces the duplicate-name collision distinctly.
      const isConflict = err.data?.code === "CONFLICT";
      toast.error(
        isConflict
          ? err.message
          : err.message ?? "Failed to import backup",
      );
    },
  });

  function handleImportFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!parsed || parsed.version !== 1 || !parsed.dataset || !parsed.trades) {
          toast.error("Not a valid Tradefolio backup file");
          return;
        }
        importMutation.mutate({ backup: parsed });
      } catch {
        toast.error("Couldn't parse the file — is it a Tradefolio backup?");
      }
    };
    reader.onerror = () => toast.error("Couldn't read the file");
    reader.readAsText(file);
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

  // Quick status set from the header pill — optimistic-ish via list refetch.
  const setStatusMutation = trpc.backtest.dataset.update.useMutation({
    onSuccess: (_data, vars) => {
      utils.backtest.dataset.list.invalidate();
      const meta = DATASET_STATUS_META[(vars.status ?? "active") as DatasetStatus];
      toast.success(`Marked ${meta.label.toLowerCase()}`);
    },
    onError: (err) => toast.error(err.message ?? "Failed to update status"),
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
              <DatasetStatusControl
                status={statusOf(
                  (activeMeta as { status?: DatasetStatus | null } | null)?.status,
                )}
                disabled={!activeMeta || setStatusMutation.isPending}
                onChange={(next) =>
                  activeDatasetId != null &&
                  setStatusMutation.mutate({ id: activeDatasetId, status: next })
                }
              />
              <button
                type="button"
                onClick={() => setScalingSettingsOpen(true)}
                disabled={!activeMeta}
                title="Dataset settings (scaling, notes, RR buckets)"
                className="rounded-md border border-border bg-card/60 p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                <Settings className="h-3.5 w-3.5" />
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
              <label className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card/60 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer">
                <Upload className="h-3.5 w-3.5" />
                {importMutation.isPending ? "Uploading…" : "Upload backup"}
                <input
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  disabled={importMutation.isPending}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    // Reset the value so re-uploading the same file re-triggers.
                    e.target.value = "";
                    if (file) handleImportFile(file);
                  }}
                />
              </label>
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

        {/* Notes panel — only when this dataset has notes saved */}
        {ds?.notes && ds.notes.trim() !== "" && (
          <div className="rounded-md border border-border bg-card/40 p-3 text-sm">
            <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
              Notes / rules
            </p>
            <p className="whitespace-pre-wrap text-foreground/85">
              {ds.notes}
            </p>
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

        {/* Dataset settings dialog (scaling, notes, RR buckets) */}
        {activeMeta && (
          <DatasetSettingsDialog
            open={scalingSettingsOpen}
            onOpenChange={setScalingSettingsOpen}
            datasetId={activeMeta.id}
            stopBricks={activeMeta.stopBricks}
            brickPoints={activeMeta.brickPoints}
            takeProfitBricks={activeMeta.takeProfitBricks}
            tpMode={(activeMeta as { tpMode?: "fixed" | "fluid" }).tpMode ?? "fixed"}
            slMode={(activeMeta as { slMode?: "fixed" | "fluid" }).slMode ?? "fixed"}
            shareToken={(activeMeta as { shareToken?: string | null }).shareToken ?? null}
            initial={{
              premiumStartBalance: activeMeta.premiumStartBalance ?? null,
              speedStartBalance: activeMeta.speedStartBalance ?? null,
              notes: activeMeta.notes ?? null,
              rrBuckets: ds?.rrBuckets ?? null,
              premiumScalingSchedule: ds?.premiumScalingSchedule ?? null,
              speedScalingSchedule: ds?.speedScalingSchedule ?? null,
            }}
          />
        )}

        {/* Ready to render */}
        {ds && core && (
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList className="max-w-full justify-start overflow-x-auto">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="timing">Timing / Sequence</TabsTrigger>
              <TabsTrigger value="scaling">Scaling</TabsTrigger>
              <TabsTrigger value="calendar">Calendar</TabsTrigger>
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
                byWeekday={byWeekday}
                weekly={weekly}
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
                onOpenSettings={() => setScalingSettingsOpen(true)}
              />
            </TabsContent>

            <TabsContent value="calendar" className="space-y-6 mt-6">
              <BacktestCalendar dataset={ds} />
            </TabsContent>

            <TabsContent value="log" className="space-y-6 mt-6">
              <TradeLogTab
                dataset={ds}
                premiumSeries={premium}
                speedSeries={speed}
              />
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
  datasets: Array<{
    id: number;
    name: string;
    tradeCount: number;
    status?: DatasetStatus | null;
  }>;
  activeId: number | null;
  onChange: (id: number) => void;
}

// ---------------------------------------------------------------------------
// Dataset settings dialog — one place for scaling starting balances, notes,
// and RR-bucket configuration. Empty starting-balance fields save as null,
// disabling that scaling's tracking. Empty notes save as null. RR buckets
// save as a JSON array (or null for the default ladder).
// ---------------------------------------------------------------------------

interface DatasetSettingsInitial {
  premiumStartBalance: number | null;
  speedStartBalance: number | null;
  notes: string | null;
  rrBuckets: RrBucketConfig[] | null;
  premiumScalingSchedule: ScalingSchedule | null;
  speedScalingSchedule: ScalingSchedule | null;
}

type RrRow = { tp: string; stop: string };

function defaultLadder(stopBricks: number, brickPoints: number): RrRow[] {
  const stopPoints = stopBricks * brickPoints;
  return Array.from({ length: 5 }, (_, i) => ({
    tp: String((i + 1) * stopPoints),
    stop: String(stopPoints),
  }));
}

// Small segmented control for a fixed/fluid TP or SL mode.
function FixedFluidToggle({
  value,
  onChange,
}: {
  value: "fixed" | "fluid";
  onChange: (v: "fixed" | "fluid") => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded border border-border text-[10px]">
      {(["fixed", "fluid"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={cn(
            "px-1.5 py-0.5 font-medium uppercase tracking-wide transition-colors",
            value === m
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

function DatasetSettingsDialog({
  open,
  onOpenChange,
  datasetId,
  stopBricks,
  brickPoints,
  takeProfitBricks,
  tpMode: tpModeProp,
  slMode: slModeProp,
  shareToken,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  datasetId: number;
  stopBricks: number;
  brickPoints: number;
  takeProfitBricks: number;
  tpMode: "fixed" | "fluid";
  slMode: "fixed" | "fluid";
  shareToken: string | null;
  initial: DatasetSettingsInitial;
}) {
  const utils = trpc.useUtils();
  const [premium, setPremium] = useState("");
  const [speed, setSpeed] = useState("");
  const [notes, setNotes] = useState("");
  const [rrRows, setRrRows] = useState<RrRow[]>([]);
  const [premiumSchedule, setPremiumSchedule] = useState<ScalingSchedule>([]);
  const [speedSchedule, setSpeedSchedule] = useState<ScalingSchedule>([]);
  // Strategy params edited in points; converted to bricks on save.
  const [brickPts, setBrickPts] = useState("");
  const [tpPts, setTpPts] = useState("");
  const [slPts, setSlPts] = useState("");
  const [tpMode, setTpMode] = useState<"fixed" | "fluid">("fixed");
  const [slMode, setSlMode] = useState<"fixed" | "fluid">("fixed");

  // Re-sync when opened (or the underlying dataset switches).
  useEffect(() => {
    if (!open) return;
    setPremium(
      initial.premiumStartBalance == null ? "" : String(initial.premiumStartBalance),
    );
    setSpeed(
      initial.speedStartBalance == null ? "" : String(initial.speedStartBalance),
    );
    setNotes(initial.notes ?? "");
    setRrRows(
      initial.rrBuckets && initial.rrBuckets.length > 0
        ? initial.rrBuckets.map((b) => ({
            tp: String(b.tpPoints),
            stop: String(b.stopPoints),
          }))
        : defaultLadder(stopBricks, brickPoints),
    );
    setPremiumSchedule(initial.premiumScalingSchedule ?? []);
    setSpeedSchedule(initial.speedScalingSchedule ?? []);
    setBrickPts(String(brickPoints));
    setTpPts(String(takeProfitBricks * brickPoints));
    setSlPts(String(stopBricks * brickPoints));
    setTpMode(tpModeProp);
    setSlMode(slModeProp);
  }, [
    open,
    initial.premiumStartBalance,
    initial.speedStartBalance,
    initial.notes,
    initial.rrBuckets,
    initial.premiumScalingSchedule,
    initial.speedScalingSchedule,
    stopBricks,
    brickPoints,
    takeProfitBricks,
    tpModeProp,
    slModeProp,
  ]);

  const mutation = trpc.backtest.dataset.update.useMutation({
    onSuccess: () => {
      utils.backtest.dataset.list.invalidate();
      toast.success("Dataset settings saved");
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message ?? "Failed to save"),
  });

  const shareUrl = shareToken
    ? `${window.location.origin}/shared/backtest/${shareToken}`
    : null;
  const enableShare = trpc.backtest.dataset.enableSharing.useMutation({
    onSuccess: () => {
      utils.backtest.dataset.list.invalidate();
      toast.success("Share link created");
    },
    onError: (err) => toast.error(err.message ?? "Failed to enable sharing"),
  });
  const disableShare = trpc.backtest.dataset.disableSharing.useMutation({
    onSuccess: () => {
      utils.backtest.dataset.list.invalidate();
      toast.success("Sharing disabled — old link no longer works");
    },
    onError: (err) => toast.error(err.message ?? "Failed to disable sharing"),
  });

  const [downloading, setDownloading] = useState(false);
  const backfillMutation = trpc.backtest.dataset.backfillScalingPnl.useMutation({
    onSuccess: (r) => {
      utils.backtest.trade.list.invalidate({ datasetId });
      utils.backtest.dataset.list.invalidate();
      toast.success(
        r.filled === 0
          ? "Nothing to backfill — no blank PnL fields found"
          : `Backfilled ${r.filled} of ${r.total} trade${r.total === 1 ? "" : "s"}`,
      );
    },
    onError: (err) => toast.error(err.message ?? "Backfill failed"),
  });
  function handleBackfill() {
    if (
      !window.confirm(
        "Fill in the Premium / Speed PnL for every past trade that doesn't have one yet, using the current scaling schedule? Existing values are left untouched.",
      )
    ) {
      return;
    }
    backfillMutation.mutate({ id: datasetId });
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      const backup = await utils.backtest.dataset.exportBackup.fetch({
        id: datasetId,
      });
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: "application/json",
      });
      const safeName = backup.dataset.name.replace(/[^a-z0-9-_]+/gi, "-");
      const today = new Date().toISOString().slice(0, 10);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `tradefolio-backup-${safeName}-${today}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
      toast.success(`Backup downloaded (${backup.trades.length} trades)`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to download backup",
      );
    } finally {
      setDownloading(false);
    }
  }

  function parseDollar(s: string): number | null {
    const t = s.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    // Validate & shape RR buckets. Drop any incomplete rows; if the list
    // matches the default ladder exactly, save null so the dataset falls
    // back to dynamic defaults if stop/brick later change.
    const cleanRr: RrBucketConfig[] = [];
    for (const r of rrRows) {
      const tp = Number(r.tp);
      const stop = Number(r.stop);
      if (Number.isFinite(tp) && Number.isFinite(stop) && tp > 0 && stop > 0) {
        cleanRr.push({ tpPoints: tp, stopPoints: stop });
      }
    }
    const defaults = defaultLadder(stopBricks, brickPoints);
    const matchesDefault =
      cleanRr.length === defaults.length &&
      cleanRr.every(
        (b, i) =>
          String(b.tpPoints) === defaults[i].tp &&
          String(b.stopPoints) === defaults[i].stop,
      );
    // Strategy params: edit in points, store as bricks (rounded to nearest).
    const bp = Math.max(1, Math.round(Number(brickPts) || brickPoints));
    const tpB = Math.max(1, Math.round((Number(tpPts) || 0) / bp));
    const slB = Math.max(1, Math.round((Number(slPts) || 0) / bp));

    mutation.mutate({
      id: datasetId,
      brickPoints: bp,
      takeProfitBricks: tpB,
      stopBricks: slB,
      tpMode,
      slMode,
      premiumStartBalance: parseDollar(premium),
      speedStartBalance: parseDollar(speed),
      notes: notes.trim() === "" ? null : notes.trim(),
      rrBuckets:
        matchesDefault || cleanRr.length === 0
          ? null
          : JSON.stringify(cleanRr),
      premiumScalingSchedule:
        premiumSchedule.length === 0 ? null : JSON.stringify(premiumSchedule),
      speedScalingSchedule:
        speedSchedule.length === 0 ? null : JSON.stringify(speedSchedule),
    });
  }

  const addBucket = () =>
    setRrRows((rs) => [...rs, { tp: "", stop: String(stopBricks * brickPoints) }]);
  const removeBucket = (i: number) =>
    setRrRows((rs) => rs.filter((_, idx) => idx !== i));
  const updateBucket = (i: number, patch: Partial<RrRow>) =>
    setRrRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const resetToDefault = () =>
    setRrRows(defaultLadder(stopBricks, brickPoints));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[95vw] bg-card max-h-[90vh] overflow-x-hidden overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Dataset settings</DialogTitle>
          <DialogDescription>
            Scaling starting balances, free-form notes, and custom RR
            buckets — all in one place.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSave} className="min-w-0 space-y-6">
          {/* Strategy params — drive the Profit Factor & RR label */}
          <section className="min-w-0 space-y-2">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Strategy — take profit / stop
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {/* Take profit */}
              <div className="flex flex-col gap-1 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Take profit</span>
                  <FixedFluidToggle value={tpMode} onChange={setTpMode} />
                </div>
                {tpMode === "fixed" ? (
                  <input
                    type="number" step="any" min={1} value={tpPts}
                    onChange={(e) => setTpPts(e.target.value)}
                    placeholder="points"
                    className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                ) : (
                  <div className="flex h-9 items-center rounded-md border border-dashed border-border bg-background/40 px-3 text-xs text-muted-foreground">
                    avg of winners
                  </div>
                )}
              </div>
              {/* Stop loss */}
              <div className="flex flex-col gap-1 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Stop loss</span>
                  <FixedFluidToggle value={slMode} onChange={setSlMode} />
                </div>
                {slMode === "fixed" ? (
                  <input
                    type="number" step="any" min={1} value={slPts}
                    onChange={(e) => setSlPts(e.target.value)}
                    placeholder="points"
                    className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                ) : (
                  <div className="flex h-9 items-center rounded-md border border-dashed border-border bg-background/40 px-3 text-xs text-muted-foreground">
                    avg of losers
                  </div>
                )}
              </div>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-muted-foreground">Brick size (pts)</span>
                <input
                  type="number" step="any" min={1} value={brickPts}
                  onChange={(e) => setBrickPts(e.target.value)}
                  className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              {tpMode === "fixed" && slMode === "fixed" ? (
                <>
                  Reward:risk ={" "}
                  <span className="font-medium text-foreground">
                    {Number(slPts) > 0
                      ? `1:${(Number(tpPts) / Number(slPts)).toFixed(2).replace(/\.?0+$/, "")}`
                      : "—"}
                  </span>
                  . Drives the Profit Factor card. Rounded to the nearest brick on save.
                </>
              ) : (
                <>
                  <span className="font-medium text-foreground">Fluid</span> sides
                  take their average from the realized points of your logged
                  trades, so reward:risk builds up as you add trades. Log each
                  trade's <span className="font-medium text-foreground">Result (pts)</span>.
                </>
              )}
            </p>
          </section>

          {/* Scaling */}
          <section className="space-y-2">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Scaling starting balances
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-muted-foreground">Premium</span>
                <input
                  type="number"
                  step="any"
                  placeholder="$10,000 (blank = not tracked)"
                  value={premium}
                  onChange={(e) => setPremium(e.target.value)}
                  className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-muted-foreground">Speed</span>
                <input
                  type="number"
                  step="any"
                  placeholder="$3,000 (blank = not tracked)"
                  value={speed}
                  onChange={(e) => setSpeed(e.target.value)}
                  className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </label>
            </div>
          </section>

          {/* Notes */}
          <section className="space-y-2">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Notes / rules
            </p>
            <textarea
              rows={4}
              placeholder="Document the rules you're using to track this backtest — entry criteria, exit rules, sizing conventions, etc."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </section>

          {/* RR buckets */}
          <section className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                RR buckets
              </p>
              <button
                type="button"
                onClick={resetToDefault}
                className="text-[10px] text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
              >
                Reset to default ladder
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Each row defines a TP / Stop pair (in points). RR is computed as
              TP ÷ Stop and WR/Ez$/Trades populate from your trade data.
            </p>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[26rem] text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-right">TP (pts)</th>
                    <th className="px-3 py-2 text-right">Stop (pts)</th>
                    <th className="px-3 py-2 text-right">RR</th>
                    <th className="px-3 py-2 text-right w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  {rrRows.map((r, i) => {
                    const tpNum = Number(r.tp);
                    const stopNum = Number(r.stop);
                    const ratio =
                      Number.isFinite(tpNum) &&
                      Number.isFinite(stopNum) &&
                      stopNum > 0
                        ? tpNum / stopNum
                        : null;
                    const ratioLabel =
                      ratio == null
                        ? "—"
                        : `1:${
                            Math.abs(ratio - Math.round(ratio)) < 0.005
                              ? Math.round(ratio)
                              : ratio.toFixed(2).replace(/\.?0+$/, "")
                          }`;
                    return (
                      <tr key={i} className="border-t border-border/40">
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            step="any"
                            min={1}
                            value={r.tp}
                            onChange={(e) => updateBucket(i, { tp: e.target.value })}
                            className="h-8 w-full rounded border border-border bg-background px-2 text-right text-sm text-foreground [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            step="any"
                            min={1}
                            value={r.stop}
                            onChange={(e) => updateBucket(i, { stop: e.target.value })}
                            className="h-8 w-full rounded border border-border bg-background px-2 text-right text-sm text-foreground [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        </td>
                        <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                          {ratioLabel}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <button
                            type="button"
                            onClick={() => removeBucket(i)}
                            title="Remove bucket"
                            className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive-foreground"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addBucket}
              className="gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              Add bucket
            </Button>
          </section>

          {/* Scaling schedules */}
          <section className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Scaling schedules (auto-PnL)
              </p>
              {tpMode !== "fluid" && slMode !== "fluid" && (
                <button
                  type="button"
                  onClick={() => {
                    setPremiumSchedule(IRENKO20_PREMIUM_SCHEDULE);
                    setSpeedSchedule(IRENKO20_SPEED_SCHEDULE);
                  }}
                  className="text-[10px] text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
                >
                  Load iRenko20 preset
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {tpMode === "fluid" || slMode === "fluid"
                ? "This dataset is fluid, so levels hold $ per point. Auto-PnL = each trade's Result points × the $/point at your balance level."
                : "Each row = one level. When adding a trade, the modal picks the highest level whose recommended balance ≤ current running balance and pre-fills PnL based on outcome + recovery stage."}
            </p>
            <ScheduleEditor
              label="Premium"
              accentClass="text-emerald-300"
              schedule={premiumSchedule}
              onChange={setPremiumSchedule}
              fluid={tpMode === "fluid" || slMode === "fluid"}
            />
            <ScheduleEditor
              label="Speed"
              accentClass="text-sky-300"
              schedule={speedSchedule}
              onChange={setSpeedSchedule}
              fluid={tpMode === "fluid" || slMode === "fluid"}
            />
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border bg-card/40 p-2">
              <div className="flex-1 text-xs text-muted-foreground">
                Set up scaling after already logging some trades? Fill blank
                PnLs on past trades using the schedules above. Existing PnL
                values are left alone.
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleBackfill}
                disabled={backfillMutation.isPending || (premiumSchedule.length === 0 && speedSchedule.length === 0)}
              >
                {backfillMutation.isPending ? "Filling…" : "Backfill past trades"}
              </Button>
            </div>
          </section>

          {/* Public sharing */}
          <section className="space-y-2">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Share (read-only)
            </p>
            {shareUrl ? (
              <div className="space-y-2 rounded-md border border-border bg-card/40 p-3">
                <p className="text-xs text-muted-foreground">
                  Anyone with this link can view this backtest read-only — no
                  account needed. Revoke to break the link instantly.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={shareUrl}
                    onClick={(e) => e.currentTarget.select()}
                    className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(shareUrl);
                      toast.success("Link copied");
                    }}
                  >
                    Copy
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => disableShare.mutate({ id: datasetId })}
                    disabled={disableShare.isPending}
                    className="border-destructive/40 text-destructive-foreground hover:bg-destructive/10"
                  >
                    Revoke
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border bg-card/40 p-2">
                <p className="flex-1 text-xs text-muted-foreground">
                  Generate a public read-only link so others can view this
                  backtest without an account.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => enableShare.mutate({ id: datasetId })}
                  disabled={enableShare.isPending}
                >
                  {enableShare.isPending ? "Creating…" : "Create share link"}
                </Button>
              </div>
            )}
          </section>

          <DialogFooter className="gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDownload}
              disabled={downloading || mutation.isPending}
              className="mr-auto gap-1.5"
            >
              <Download className="h-3.5 w-3.5" />
              {downloading ? "Preparing…" : "Download backup"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving…" : "Save settings"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Scaling schedule editor — per-side editable table of ScalingLevel rows.
// ---------------------------------------------------------------------------

function ScheduleEditor({
  label,
  accentClass,
  schedule,
  onChange,
  fluid = false,
}: {
  label: string;
  accentClass: string;
  schedule: ScalingSchedule;
  onChange: (next: ScalingSchedule) => void;
  fluid?: boolean;
}) {
  function updateLevel(i: number, patch: Partial<ScalingLevel>) {
    onChange(schedule.map((lvl, idx) => (idx === i ? { ...lvl, ...patch } : lvl)));
  }
  function addLevel() {
    const last = schedule[schedule.length - 1];
    onChange([
      ...schedule,
      fluid
        ? {
            name: `${label[0].toLowerCase()}${schedule.length + 1}`,
            recommendedBalance: last ? last.recommendedBalance * 2 : 5000,
            // Fixed fields unused in fluid mode but required by the type.
            profitPerTrade: 0,
            initialRisk: 0,
            recovery1Risk: 0,
            recovery2Risk: null,
            dollarsPerPoint: last?.dollarsPerPoint != null ? last.dollarsPerPoint * 2 : 2,
          }
        : {
            name: `${label[0].toLowerCase()}${schedule.length + 1}`,
            recommendedBalance: last ? last.recommendedBalance * 2 : 2560,
            profitPerTrade: last ? last.profitPerTrade * 2 : 80,
            initialRisk: last ? last.initialRisk * 2 : 320,
            recovery1Risk: last ? last.recovery1Risk * 2 : 1280,
            recovery2Risk: last?.recovery2Risk != null ? last.recovery2Risk * 2 : null,
          },
    ]);
  }
  function removeLevel(i: number) {
    onChange(schedule.filter((_, idx) => idx !== i));
  }

  const inputCls =
    "h-7 rounded border border-border bg-background px-1.5 text-right text-xs text-foreground [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-ring";
  const dppCell = (i: number, key:
    | "dollarsPerPoint"
    | "recovery1DollarsPerPoint"
    | "recovery2DollarsPerPoint") => (
    <td className="px-1.5 py-1">
      <input
        type="number"
        step="any"
        value={schedule[i][key] == null ? "" : String(schedule[i][key])}
        placeholder={key === "dollarsPerPoint" ? "$/pt" : "—"}
        onChange={(e) => {
          const v = e.target.value.trim();
          updateLevel(i, { [key]: v === "" ? null : Number(v) || 0 });
        }}
        className={cn(inputCls, "w-20")}
      />
    </td>
  );

  return (
    <div className="rounded-md border border-border bg-card/40">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5">
        <p className={cn("text-xs font-semibold", accentClass)}>{label}</p>
        <Button type="button" variant="ghost" size="sm" onClick={addLevel} className="h-6 gap-1 px-2 text-xs">
          <Plus className="h-3 w-3" />
          Add level
        </Button>
      </div>
      {schedule.length === 0 ? (
        <p className="px-3 py-4 text-center text-xs text-muted-foreground">
          {fluid
            ? "No schedule yet — add a level and set its $ per point."
            : "No schedule yet — load the iRenko20 preset or add levels manually."}
        </p>
      ) : fluid ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/30 text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="px-2 py-1 text-left">Name</th>
                <th className="px-2 py-1 text-right">Rec. balance</th>
                <th className="px-2 py-1 text-right">$ / point</th>
                <th className="px-2 py-1 text-right">R1 $/pt</th>
                <th className="px-2 py-1 text-right">R2 $/pt</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {schedule.map((lvl, i) => (
                <tr key={i} className="border-t border-border/40">
                  <td className="px-1.5 py-1">
                    <input
                      type="text"
                      value={lvl.name}
                      onChange={(e) => updateLevel(i, { name: e.target.value })}
                      className={cn(inputCls, "w-16 text-left")}
                    />
                  </td>
                  <td className="px-1.5 py-1">
                    <input
                      type="number"
                      step="any"
                      value={lvl.recommendedBalance}
                      onChange={(e) => updateLevel(i, { recommendedBalance: Number(e.target.value) || 0 })}
                      className={cn(inputCls, "w-24")}
                    />
                  </td>
                  {dppCell(i, "dollarsPerPoint")}
                  {dppCell(i, "recovery1DollarsPerPoint")}
                  {dppCell(i, "recovery2DollarsPerPoint")}
                  <td className="px-1 py-1 text-right">
                    <button
                      type="button"
                      onClick={() => removeLevel(i)}
                      title="Remove level"
                      className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive-foreground"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-2 text-[10px] text-muted-foreground">
            Auto-PnL = each trade's Result points × the $/point at your balance
            level. 1 MNQ = $2/pt, 2 = $4/pt, etc. R1/R2 optional (recovery size).
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/30 text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="px-2 py-1 text-left">Name</th>
                <th className="px-2 py-1 text-right">Rec. balance</th>
                <th className="px-2 py-1 text-right">Profit</th>
                <th className="px-2 py-1 text-right">Init risk</th>
                <th className="px-2 py-1 text-right">R1 risk</th>
                <th className="px-2 py-1 text-right">R2 risk</th>
                <th className="px-2 py-1 text-right">R1 profit</th>
                <th className="px-2 py-1 text-right">R2 profit</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {schedule.map((lvl, i) => (
                <tr key={i} className="border-t border-border/40">
                  <td className="px-1.5 py-1">
                    <input
                      type="text"
                      value={lvl.name}
                      onChange={(e) => updateLevel(i, { name: e.target.value })}
                      className="h-7 w-16 rounded border border-border bg-background px-1.5 text-xs text-foreground [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </td>
                  <td className="px-1.5 py-1">
                    <input
                      type="number"
                      step="any"
                      value={lvl.recommendedBalance}
                      onChange={(e) => updateLevel(i, { recommendedBalance: Number(e.target.value) || 0 })}
                      className="h-7 w-24 rounded border border-border bg-background px-1.5 text-right text-xs text-foreground [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </td>
                  <td className="px-1.5 py-1">
                    <input
                      type="number"
                      step="any"
                      value={lvl.profitPerTrade}
                      onChange={(e) => updateLevel(i, { profitPerTrade: Number(e.target.value) || 0 })}
                      className="h-7 w-20 rounded border border-border bg-background px-1.5 text-right text-xs text-foreground [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </td>
                  <td className="px-1.5 py-1">
                    <input
                      type="number"
                      step="any"
                      value={lvl.initialRisk}
                      onChange={(e) => updateLevel(i, { initialRisk: Number(e.target.value) || 0 })}
                      className="h-7 w-20 rounded border border-border bg-background px-1.5 text-right text-xs text-foreground [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </td>
                  <td className="px-1.5 py-1">
                    <input
                      type="number"
                      step="any"
                      value={lvl.recovery1Risk}
                      onChange={(e) => updateLevel(i, { recovery1Risk: Number(e.target.value) || 0 })}
                      className="h-7 w-20 rounded border border-border bg-background px-1.5 text-right text-xs text-foreground [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </td>
                  <td className="px-1.5 py-1">
                    <input
                      type="text"
                      // Freeform to support "n/a" — parse below.
                      value={lvl.recovery2Risk == null ? "n/a" : String(lvl.recovery2Risk)}
                      onChange={(e) => {
                        const v = e.target.value.trim().toLowerCase();
                        const parsed = v === "" || v === "n/a" ? null : Number(v);
                        updateLevel(i, {
                          recovery2Risk: parsed != null && Number.isFinite(parsed) ? parsed : null,
                        });
                      }}
                      className="h-7 w-20 rounded border border-border bg-background px-1.5 text-right text-xs text-foreground [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </td>
                  <td className="px-1.5 py-1">
                    <input
                      type="text"
                      value={lvl.recovery1Profit == null ? "n/a" : String(lvl.recovery1Profit)}
                      onChange={(e) => {
                        const v = e.target.value.trim().toLowerCase();
                        const parsed = v === "" || v === "n/a" ? null : Number(v);
                        updateLevel(i, {
                          recovery1Profit: parsed != null && Number.isFinite(parsed) ? parsed : null,
                        });
                      }}
                      className="h-7 w-20 rounded border border-border bg-background px-1.5 text-right text-xs text-foreground [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </td>
                  <td className="px-1.5 py-1">
                    <input
                      type="text"
                      value={lvl.recovery2Profit == null ? "n/a" : String(lvl.recovery2Profit)}
                      onChange={(e) => {
                        const v = e.target.value.trim().toLowerCase();
                        const parsed = v === "" || v === "n/a" ? null : Number(v);
                        updateLevel(i, {
                          recovery2Profit: parsed != null && Number.isFinite(parsed) ? parsed : null,
                        });
                      }}
                      className="h-7 w-20 rounded border border-border bg-background px-1.5 text-right text-xs text-foreground [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </td>
                  <td className="px-1 py-1 text-right">
                    <button
                      type="button"
                      onClick={() => removeLevel(i)}
                      title="Remove level"
                      className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive-foreground"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function statusOf(s?: DatasetStatus | null): DatasetStatus {
  return s === "paused" || s === "discontinued" ? s : "active";
}

// Small colored status dot. `dimmed` renders a hollow ring instead of a filled
// dot — used for the "discontinued" look in dense lists if ever needed.
function StatusDot({ status, className }: { status: DatasetStatus; className?: string }) {
  return (
    <span
      className={cn("h-2 w-2 shrink-0 rounded-full", className)}
      style={{ backgroundColor: DATASET_STATUS_META[status].dot }}
      title={DATASET_STATUS_META[status].label}
    />
  );
}

// Custom dropdown so each dataset row can carry a colored status dot (native
// <option> coloring is unreliable across browsers). Mirrors the AccountSelector
// pattern used elsewhere in the app.
function DatasetSelector({ datasets, activeId, onChange }: DatasetSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const active = datasets.find((d) => d.id === activeId) ?? null;
  const activeStatus = statusOf(active?.status);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-border bg-card/60 px-3 py-2 text-xs transition-colors hover:bg-accent"
      >
        <Database className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-muted-foreground">Dataset</span>
        {active && <StatusDot status={activeStatus} />}
        <span
          className={cn(
            "text-sm font-medium",
            activeStatus === "discontinued" && "line-through decoration-red-400/50",
          )}
        >
          {active ? `${active.name} (${active.tradeCount})` : "Select…"}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-80 w-max min-w-[16rem] overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
          {datasets.map((d) => {
            const st = statusOf(d.status);
            const isActive = d.id === activeId;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  onChange(d.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-accent",
                  isActive ? "bg-accent/60 font-medium" : "text-foreground",
                )}
              >
                <StatusDot status={st} />
                <span
                  className={cn(
                    "truncate",
                    st === "discontinued" && "text-muted-foreground line-through decoration-red-400/50",
                    st === "paused" && "text-foreground/80",
                  )}
                >
                  {d.name}
                </span>
                <span className="ml-auto pl-3 text-xs text-muted-foreground">
                  {d.tradeCount}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Header pill to change the active dataset's status. Compact dropdown of the
// three lifecycle states, each with its color dot.
function DatasetStatusControl({
  status,
  disabled,
  onChange,
}: {
  status: DatasetStatus;
  disabled?: boolean;
  onChange: (s: DatasetStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const meta = DATASET_STATUS_META[status];
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title="Dataset status"
        className={cn(
          "flex items-center gap-1.5 rounded-md border border-border bg-card/60 px-2.5 py-2 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-40",
          meta.text,
        )}
      >
        <StatusDot status={status} />
        {meta.label}
        <ChevronDown className={cn("h-3 w-3 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-40 overflow-hidden rounded-md border border-border bg-popover shadow-lg">
          {DATASET_STATUS_ORDER.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                if (s !== status) onChange(s);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-accent",
                s === status ? "bg-accent/60 font-medium" : "text-foreground",
              )}
            >
              <StatusDot status={s} />
              {DATASET_STATUS_META[s].label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

export function OverviewTab({
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
          label={`Profit Factor (${core.rewardRisk ? `1:${core.rewardRisk.toFixed(2).replace(/\.?0+$/, "")}` : "—"})`}
          value={
            <span className={core.profitFactor >= 1 ? "text-green-400" : "text-red-400"}>
              {core.profitFactor === Infinity ? "∞" : core.profitFactor.toFixed(2)}
            </span>
          }
          sub={
            `TP ${core.tpFluid ? "~" : ""}${Math.round(core.tpPoints)}` +
            ` / SL ${core.slFluid ? "~" : ""}${Math.round(core.slPoints)} pts` +
            (core.tpFluid || core.slFluid ? " · avg (fluid)" : "")
          }
        />
        <StatCard
          label="Kelly"
          value={
            <span className={core.kelly > 0 ? "text-green-400" : "text-red-400"}>
              {fmtPct(core.kelly)}
            </span>
          }
          sub={
            core.kelly > 0
              ? `Half-Kelly ${fmtPct(core.halfKelly)} · of equity per trade`
              : "No edge at this reward:risk"
          }
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
          label="Streaks (longest)"
          value={
            <span className="text-foreground">
              <span className="text-green-400">{core.maxWinStreak}W</span> /{" "}
              <span className="text-red-400">{core.maxLossStreak}L</span>
            </span>
          }
          sub={`Avg ${core.avgWinStreak.toFixed(1)}W · ${core.avgLossStreak.toFixed(1)}L`}
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

      {/* Streak breakdown */}
      <Card className="bg-card/60">
        <CardContent className="pt-5 pb-5">
          <h3 className="mb-3 text-sm font-semibold">Streak breakdown</h3>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[30rem] text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Streak</th>
                  <th className="px-3 py-2 text-right">Longest</th>
                  <th className="px-3 py-2 text-right">Average</th>
                  <th className="px-3 py-2 text-right">Shortest</th>
                  <th className="px-3 py-2 text-right"># of runs</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-border/40">
                  <td className="px-3 py-2 font-medium text-green-400 align-top">Winning</td>
                  <StreakCell count={core.maxWinStreak} inSample={core.winStreakOddsInSample} perAttempt={core.winStreakOddsPerAttempt} primary="perAttempt" />
                  <StreakCell count={core.avgWinStreak.toFixed(1)} lenForTip={core.avgWinStreak} inSample={core.winAvgStreakOddsInSample} perAttempt={core.winAvgStreakOddsPerAttempt} primary="perAttempt" />
                  <td className="px-3 py-2 text-right tabular-nums align-top">{core.minWinStreak}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground align-top">{core.winStreakCount}</td>
                </tr>
                <tr className="border-t border-border/40">
                  <td className="px-3 py-2 font-medium text-red-400 align-top">Losing</td>
                  <StreakCell count={core.maxLossStreak} inSample={core.lossStreakOddsInSample} perAttempt={core.lossStreakOddsPerAttempt} primary="perAttempt" />
                  <StreakCell count={core.avgLossStreak.toFixed(1)} lenForTip={core.avgLossStreak} inSample={core.lossAvgStreakOddsInSample} perAttempt={core.lossAvgStreakOddsPerAttempt} primary="perAttempt" />
                  <td className="px-3 py-2 text-right tabular-nums align-top">{core.minLossStreak}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground align-top">{core.lossStreakCount}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            A run is a consecutive string of the same outcome; a lone win or loss
            counts as a streak of 1. Breakevens don't break a run. The small %
            under Longest and Average is the{" "}
            <span className="text-foreground/70">back-to-back</span> chance of a
            run that long from a fresh start at this win rate, so a shorter
            streak reads as more likely. Hover for the chance it appears
            somewhere in your {core.wins + core.losses} decisive trades. Assumes
            independent trades — strategies whose outcomes cluster will differ.
          </p>
        </CardContent>
      </Card>

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
              {series.start > 0 && (
                <span className="ml-1.5 inline-block text-xs opacity-80">
                  ({series.netPnl >= 0 ? "+" : ""}
                  {((series.netPnl / series.start) * 100).toFixed(1)}%)
                </span>
              )}
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

export function TimingTab({
  byHour,
  byWeekday,
  weekly,
  byTradeNo,
  bySide,
  rr,
  targetLadder,
  recovery,
  stopPoints,
}: {
  byHour: ReturnType<typeof computeByHour>;
  byWeekday: ReturnType<typeof computeByWeekday>;
  weekly: ReturnType<typeof computeWeekly> | null;
  byTradeNo: ReturnType<typeof computeByTradeNo>;
  bySide: ReturnType<typeof computeBySide>;
  rr: ReturnType<typeof computeRrBuckets>;
  targetLadder: ReturnType<typeof computeTargetLadder>;
  recovery: ReturnType<typeof computeRecoveryStats>;
  stopPoints: number;
}) {
  const dsStopPoints = stopPoints;
  const hourData = byHour.map((b) => ({
    hour: b.hourLabel,
    winRate: Number((b.winRate * 100).toFixed(1)),
    trades: b.trades,
  }));

  // Weekday chart data — keep only days that actually have trades so an
  // index-only intraday strategy doesn't show five empty weekend-inclusive
  // columns, but always keep the natural Mon→Sun order.
  const weekdayData = byWeekday
    .filter((b) => b.trades > 0)
    .map((b) => ({
      day: b.label,
      winRate: Number((b.winRate * 100).toFixed(1)),
      trades: b.trades,
      ev: Number(b.evPoints.toFixed(1)),
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
            <div className="mt-2 grid grid-cols-9 gap-0.5 px-2 text-center text-[9px] sm:gap-1 sm:px-12 sm:text-[10px] text-muted-foreground">
              {hourData.map((d) => (
                <div key={d.hour} title={`${d.trades} trades`}>
                  n={d.trades}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Weekday */}
      <section className="space-y-3">
        <SectionHeader
          icon={CalendarDays}
          title="Performance by day of week"
          hint="Mon–Sun (weekends shown for crypto). Bar opacity reflects sample size; EV is points per trade using this dataset's TP/SL."
        />
        <Card className="bg-card/60">
          <CardContent className="pt-4">
            {weekdayData.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No decisive trades yet.
              </p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={weekdayData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="day" tick={{ fontSize: 12, fill: "#6b7280" }} tickLine={false} axisLine={false} />
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
                              {(payload[0].payload as { trades?: number })?.trades} trades ·
                              EV {(payload[0].payload as { ev?: number })?.ev} pts
                            </p>
                          </div>
                        ) : null
                      }
                    />
                    <Bar dataKey="winRate" name="Win Rate" radius={[3, 3, 0, 0]} maxBarSize={56} isAnimationActive={false}>
                      {weekdayData.map((d, i) => (
                        <Cell
                          key={i}
                          fill={d.winRate >= 80 ? "#22c55e" : d.winRate >= 65 ? "#a3e635" : "#ef4444"}
                          fillOpacity={opacityForCount(d.trades)}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-3 overflow-x-auto rounded-md border border-border">
                  <table className="w-full min-w-[26rem] text-sm">
                    <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left">Day</th>
                        <th className="px-3 py-2 text-right">Trades</th>
                        <th className="px-3 py-2 text-right">W / L</th>
                        <th className="px-3 py-2 text-right">Win rate</th>
                        <th className="px-3 py-2 text-right">EV (pts)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byWeekday
                        .filter((b) => b.trades > 0)
                        .map((b) => (
                          <tr key={b.weekday} className="border-t border-border/40">
                            <td className="px-3 py-2 font-medium">{b.label}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{b.trades}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              <span className="text-green-400">{b.wins}</span>
                              <span className="text-muted-foreground"> / </span>
                              <span className="text-red-400">{b.losses}</span>
                            </td>
                            <td className={cn("px-3 py-2 text-right tabular-nums font-semibold", b.winRate >= 0.5 ? "text-green-400" : "text-red-400")}>
                              {fmtPct(b.winRate)}
                            </td>
                            <td className={cn("px-3 py-2 text-right tabular-nums font-semibold", b.evPoints >= 0 ? "text-green-400" : "text-red-400")}>
                              {b.evPoints >= 0 ? "+" : ""}{b.evPoints.toFixed(1)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Weekly cadence */}
      {weekly && weekly.weeks > 0 && (
        <section className="space-y-3">
          <SectionHeader
            icon={CalendarDays}
            title="Weekly cadence"
            hint={`Averaged over ${weekly.weeks} calendar week${weekly.weeks === 1 ? "" : "s"} of trading. Week-of-month splits days 1–7 = Wk 1, etc.`}
          />
          <Card className="bg-card/60">
            <CardContent className="pt-5 pb-5 space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <MiniStat label="Avg trades / week" value={weekly.avgTradesPerWeek.toFixed(1)} />
                <MiniStat
                  label="Avg losses / week"
                  value={weekly.avgLossesPerWeek.toFixed(1)}
                  tone={weekly.avgLossesPerWeek > 0 ? -1 : 0}
                />
                <MiniStat label="Avg wins / week" value={weekly.avgWinsPerWeek.toFixed(1)} tone={1} />
                <MiniStat
                  label="Avg net / week (pts)"
                  value={`${weekly.avgNetPointsPerWeek >= 0 ? "+" : ""}${weekly.avgNetPointsPerWeek.toFixed(0)}`}
                  tone={weekly.avgNetPointsPerWeek}
                />
              </div>

              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[30rem] text-sm">
                  <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Week of month</th>
                      <th className="px-3 py-2 text-right">Trades</th>
                      <th className="px-3 py-2 text-right">W / L</th>
                      <th className="px-3 py-2 text-right">Win rate</th>
                      <th className="px-3 py-2 text-right">Net (pts)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weekly.byWeekOfMonth.map((b) => (
                      <tr key={b.week} className="border-t border-border/40">
                        <td className="px-3 py-2 font-medium">{b.label}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{b.trades}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          <span className="text-green-400">{b.wins}</span>
                          <span className="text-muted-foreground"> / </span>
                          <span className="text-red-400">{b.losses}</span>
                        </td>
                        <td className={cn("px-3 py-2 text-right tabular-nums font-semibold", b.winRate >= 0.5 ? "text-green-400" : "text-red-400")}>
                          {fmtPct(b.winRate)}
                        </td>
                        <td className={cn("px-3 py-2 text-right tabular-nums font-semibold", b.netPoints >= 0 ? "text-green-400" : "text-red-400")}>
                          {b.netPoints >= 0 ? "+" : ""}{Math.round(b.netPoints)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-border bg-muted/20 font-semibold">
                      <td className="px-3 py-2">{weekly.total.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{weekly.total.trades}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span className="text-green-400">{weekly.total.wins}</span>
                        <span className="text-muted-foreground"> / </span>
                        <span className="text-red-400">{weekly.total.losses}</span>
                      </td>
                      <td className={cn("px-3 py-2 text-right tabular-nums", weekly.total.winRate >= 0.5 ? "text-green-400" : "text-red-400")}>
                        {fmtPct(weekly.total.winRate)}
                      </td>
                      <td className={cn("px-3 py-2 text-right tabular-nums", weekly.total.netPoints >= 0 ? "text-green-400" : "text-red-400")}>
                        {weekly.total.netPoints >= 0 ? "+" : ""}{Math.round(weekly.total.netPoints)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                Week-of-month buckets every trade by its calendar day (1–7 = Wk 1
                … 29–31 = Wk 5), pooling that slot across all months — useful for
                spotting if, say, month-start behaves differently. Net points use
                this dataset's TP/SL.
              </p>
            </CardContent>
          </Card>
        </section>
      )}

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

      {/* Target ladder — full width so all columns are visible */}
      <section className="space-y-3">
        <SectionHeader
          icon={Target}
          title="Target ladder — what if my TP were…"
          hint={`Holds each trade to the target instead of the ${stopPoints}pt stop: a win if MFE reached the target, else a full stop. Hit% is the win rate you'd get; Need% is what you'd need to break even at that TP. EV is points per trade.`}
        />
        <Card className="bg-card/60">
          <CardContent className="pt-5 pb-5">
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[34rem] text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">TP (pts)</th>
                    <th className="px-3 py-2 text-right">Hit%</th>
                    <th className="px-3 py-2 text-right">Need%</th>
                    <th className="px-3 py-2 text-right">EV (pts)</th>
                    <th className="px-3 py-2 text-right">Hits</th>
                    <th className="px-3 py-2 text-right">Amb.</th>
                  </tr>
                </thead>
                <tbody>
                  {targetLadder.map((r) => (
                    <tr key={r.tpPoints} className="border-t border-border/40">
                      <td className="px-3 py-2 font-medium tabular-nums">
                        {r.tpPoints}
                        <span className="text-muted-foreground ml-1.5 text-xs">
                          1:{(r.tpPoints / r.stopPoints).toFixed(2).replace(/\.?0+$/, "")}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-green-400">
                        {fmtPct(r.hitRate)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {fmtPct(r.breakevenWinRate)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2 text-right tabular-nums font-semibold",
                          r.positive ? "text-green-400" : "text-red-400",
                        )}
                      >
                        {r.evPoints >= 0 ? "+" : ""}
                        {r.evPoints.toFixed(1)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.hits}
                      </td>
                      <td
                        className="px-3 py-2 text-right tabular-nums text-muted-foreground"
                        title="Reached the target but also hit the stop — path order unknown, counted as a non-win"
                      >
                        {r.ambiguous || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              A green EV means holding to that target beat the stop over this
              sample. <span className="font-medium text-foreground/80">Amb.</span>{" "}
              = trades that reached the target but also hit the stop, so the order
              can't be proven from MFE/MAE alone — counted conservatively as
              non-wins. Only forward-testing the actual TP resolves those.
            </p>
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
            hint={
              rr[0]?.fluidStop
                ? "Buckets are multiples of your average risk (fluid stop). WR = trades whose MFE reached each level."
                : "RR = TP ÷ Stop. WR = trades whose MFE reached TP. Customize buckets in Dataset settings."
            }
          />
          <Card className="bg-card/60">
            <CardContent className="pt-5 pb-5">
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[30rem] text-sm">
                  <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">RR</th>
                      <th className="px-3 py-2 text-right">TP (pts)</th>
                      <th className="px-3 py-2 text-right">
                        {rr[0]?.fluidStop ? "Avg risk (pts)" : "Stop (pts)"}
                      </th>
                      <th className="px-3 py-2 text-right">WR</th>
                      <th className="px-3 py-2 text-right">Ez$</th>
                      <th className="px-3 py-2 text-right">Trades</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rr.map((r, i) => (
                      <tr key={`${r.tpPoints}-${r.stopPoints}-${i}`} className="border-t border-border/40">
                        <td className="px-3 py-2 font-medium">
                          {r.label}
                          {r.fluidStop && (
                            <span className="ml-1.5 text-[10px] font-normal text-cyan-300">
                              fluid
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {r.fluidStop ? Math.round(r.tpPoints) : r.tpPoints}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {r.fluidStop ? Math.round(r.stopPoints) : r.stopPoints}
                        </td>
                        <td className="px-3 py-2 text-right text-green-400 font-semibold">{fmtPct(r.winRate)}</td>
                        <td className="px-3 py-2 text-right text-muted-foreground">{fmtPct(r.ez)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.tradeCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rr[0]?.fluidStop && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Stop is fluid, so each rung is a multiple of your average loss
                  (~{Math.round(rr[0].stopPoints)} pts). This shows how far
                  winners ran vs. your real risk — i.e. whether a fixed target
                  could have captured more than exiting on the next signal.
                </p>
              )}
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

export function ScalingTab({
  premium,
  speed,
  premiumSchedule,
  speedSchedule,
  onOpenSettings,
}: {
  premium: ReturnType<typeof computeScaling>;
  speed: ReturnType<typeof computeScaling>;
  premiumSchedule?: ScalingSchedule | null;
  speedSchedule?: ScalingSchedule | null;
  onOpenSettings: () => void;
}) {
  return (
    <div className="space-y-6">
      <ScalingChart
        name="Real $ Premium Scaling"
        series={premium}
        schedule={premiumSchedule ?? null}
        colorA="#22c55e"
        onOpenSettings={onOpenSettings}
      />
      <ScalingChart
        name="Real $ Speed Scaling"
        series={speed}
        schedule={speedSchedule ?? null}
        colorA="#38bdf8"
        onOpenSettings={onOpenSettings}
      />
    </div>
  );
}

// Given the running balance and a schedule, work out the level actually
// reached (null when still below the first rung), the next one up, and how
// much more money is needed to reach it.
function nextLevelInfo(balance: number, schedule: ScalingSchedule | null) {
  if (!schedule || schedule.length === 0) return null;
  const sorted = [...schedule].sort(
    (a, b) => a.recommendedBalance - b.recommendedBalance,
  );
  // Highest rung whose threshold the balance has actually cleared — no
  // fallback to the first level, so "below the ladder" reads as reached=null.
  let reached: ScalingLevel | null = null;
  for (const l of sorted) {
    if (balance >= l.recommendedBalance) reached = l;
    else break;
  }
  const next = sorted.find((l) => l.recommendedBalance > balance) ?? null;
  if (!next) {
    return { reached, next: null, needed: 0, progress: 1 };
  }
  // Progress toward `next` measured from the reached level's threshold (or 0
  // when still below the first rung).
  const floor = reached ? reached.recommendedBalance : 0;
  const span = next.recommendedBalance - floor;
  const progress = span > 0 ? Math.min(1, Math.max(0, (balance - floor) / span)) : 0;
  return { reached, next, needed: next.recommendedBalance - balance, progress };
}

function ScalingChart({
  name,
  series,
  schedule,
  colorA,
  onOpenSettings,
}: {
  name: string;
  series: ReturnType<typeof computeScaling>;
  schedule: ScalingSchedule | null;
  colorA: string;
  onOpenSettings: () => void;
}) {
  const gradientId = `grad-${name.replace(/\W+/g, "")}`;
  const levelUp = series.tracked ? nextLevelInfo(series.end, schedule) : null;

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
          {/* Next level-up progress */}
          {levelUp && (
            <div className="mb-4 rounded-md border border-border/60 bg-background/40 p-3">
              {levelUp.next ? (
                <>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p className="text-sm">
                      <span className="text-muted-foreground">Next level-up:</span>{" "}
                      <span className="font-semibold text-foreground">
                        {levelUp.next.name}
                      </span>
                      <span className="text-muted-foreground">
                        {" "}at {formatCurrency(levelUp.next.recommendedBalance)}
                      </span>
                    </p>
                    <p className="text-sm">
                      <span className="font-semibold" style={{ color: colorA }}>
                        {formatCurrency(levelUp.needed)}
                      </span>{" "}
                      <span className="text-muted-foreground">to go</span>
                    </p>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${(levelUp.progress * 100).toFixed(1)}%`,
                        backgroundColor: colorA,
                      }}
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {levelUp.reached
                      ? `Currently at ${levelUp.reached.name} · profit/trade ${formatCurrency(levelUp.next.profitPerTrade)} after level-up`
                      : `Below the first rung · reach ${levelUp.next.name} to start the ladder`}
                  </p>
                </>
              ) : (
                <p className="text-sm">
                  <span className="font-semibold text-foreground">Top level reached</span>
                  {levelUp.reached && (
                    <span className="text-muted-foreground">
                      {" "}— running at {levelUp.reached.name} (highest rung on the ladder)
                    </span>
                  )}
                </p>
              )}
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
                {series.start > 0 && (
                  <span className="ml-1.5 inline-block text-xs opacity-80">
                    ({series.netPnl >= 0 ? "+" : ""}
                    {((series.netPnl / series.start) * 100).toFixed(1)}%)
                  </span>
                )}
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

function TradeLogTab({
  dataset,
  premiumSeries,
  speedSeries,
}: {
  dataset: BacktestDataset;
  premiumSeries: ReturnType<typeof computeScaling>;
  speedSeries: ReturnType<typeof computeScaling>;
}) {
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
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false);

  const utils = trpc.useUtils();
  function toggleSelected(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
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
  const bulkDeleteMutation = trpc.backtest.trade.bulkDelete.useMutation({
    onSuccess: (r) => {
      if (datasetId != null) {
        utils.backtest.trade.list.invalidate({ datasetId });
      }
      utils.backtest.dataset.list.invalidate();
      toast.success(`Deleted ${r.deleted} trade${r.deleted === 1 ? "" : "s"}`);
      setSelectedIds(new Set());
      setPendingBulkDelete(false);
    },
    onError: (err) => toast.error(err.message ?? "Failed to delete trades"),
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

  // Selection is scoped to the currently visible page. "Select all" toggles
  // every row on this page that has a server id.
  const visibleIds = visible
    .map((t) => t.id)
    .filter((id): id is number => id != null);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someVisibleSelected = visibleIds.some((id) => selectedIds.has(id));
  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

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

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2">
          <span className="text-sm font-medium">
            {selectedIds.size} selected
          </span>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
          >
            Clear
          </button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPendingBulkDelete(true)}
            disabled={bulkDeleteMutation.isPending}
            className="ml-auto gap-1.5 border-destructive/40 text-destructive-foreground hover:bg-destructive/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete selected
          </Button>
        </div>
      )}

      <Card className="bg-card/60">
        <CardContent className="pt-4 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left w-8">
                    <input
                      type="checkbox"
                      aria-label="Select all on page"
                      checked={allVisibleSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected;
                      }}
                      onChange={toggleSelectAll}
                      className="h-3.5 w-3.5 accent-primary align-middle"
                    />
                  </th>
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
                {visible.map((t) =>
                  t.isPending ? (
                    (() => {
                      // Pending placeholder — themed by stage so a pending
                      // regular trade reads as sky-blue (matching live
                      // regular) while pending R1/R2 stay in amber/orange.
                      const pendingTheme =
                        t.recoveryStage === "second"
                          ? {
                              bg: "from-orange-500/5 via-orange-500/20 to-orange-500/5",
                              ring: "ring-orange-500/30",
                              text: "text-orange-200",
                              accent: "text-orange-200/80",
                              label: "Pending Recovery 2",
                            }
                          : t.recoveryStage === "first"
                          ? {
                              bg: "from-amber-500/5 via-amber-500/20 to-amber-500/5",
                              ring: "ring-amber-500/30",
                              text: "text-amber-200",
                              accent: "text-amber-200/80",
                              label: "Pending Recovery",
                            }
                          : {
                              bg: "from-sky-500/5 via-sky-500/20 to-sky-500/5",
                              ring: "ring-sky-500/30",
                              text: "text-sky-200",
                              accent: "text-sky-200/80",
                              label: "Pending Trade",
                            };
                      return (
                        <tr
                          key={t.index}
                          className="group border-t border-border/40"
                        >
                          <td
                            className={cn(
                              "px-3 py-4 bg-gradient-to-r ring-1 ring-inset",
                              pendingTheme.bg,
                              pendingTheme.ring,
                            )}
                          >
                            {t.id != null && (
                              <input
                                type="checkbox"
                                aria-label="Select trade"
                                checked={selectedIds.has(t.id)}
                                onChange={() => toggleSelected(t.id!)}
                                className="h-3.5 w-3.5 accent-primary align-middle"
                              />
                            )}
                          </td>
                          <td
                            colSpan={10}
                            className={cn(
                              "relative px-3 py-4 text-center bg-gradient-to-r ring-1 ring-inset",
                              pendingTheme.bg,
                              pendingTheme.ring,
                            )}
                          >
                            <span
                              className={cn(
                                "inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wider animate-pulse",
                                pendingTheme.text,
                              )}
                            >
                              <span className="text-lg leading-none">⏳</span>
                              {pendingTheme.label}
                            </span>
                          </td>
                          <td
                            className={cn(
                              "bg-gradient-to-r px-3 py-4 text-right ring-1 ring-inset",
                              pendingTheme.bg,
                              pendingTheme.ring,
                            )}
                          >
                            <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                              {t.id != null && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingTrade(t);
                                      setModalOpen(true);
                                    }}
                                    title="Edit / fill in trade"
                                    className={cn("rounded p-1 hover:bg-accent hover:text-foreground", pendingTheme.accent)}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setPendingDelete(t)}
                                    title="Delete pending row"
                                    className={cn("rounded p-1 hover:bg-destructive/10 hover:text-destructive-foreground", pendingTheme.accent)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })()
                  ) : t.outcome == null ? (
                    (() => {
                      // Live trade — only date / time / side / trade# are
                      // known. Everything downstream gets replaced by a
                      // pulsing banner colored by recovery stage so a live
                      // recovery reads differently from a live regular trade.
                      const liveTheme =
                        t.recoveryStage === "second"
                          ? {
                              bg: "from-orange-500/5 via-orange-500/20 to-orange-500/5",
                              ring: "ring-orange-500/30",
                              text: "text-orange-200",
                              label: "Live Recovery 2",
                            }
                          : t.recoveryStage === "first"
                          ? {
                              bg: "from-amber-500/5 via-amber-500/20 to-amber-500/5",
                              ring: "ring-amber-500/30",
                              text: "text-amber-200",
                              label: "Live Recovery",
                            }
                          : {
                              bg: "from-sky-500/5 via-sky-500/20 to-sky-500/5",
                              ring: "ring-sky-500/30",
                              text: "text-sky-200",
                              label: "Live",
                            };
                      return (
                        <tr
                          key={t.index}
                          className="group border-t border-border/40"
                        >
                          <td className="px-3 py-2">
                            {t.id != null && (
                              <input
                                type="checkbox"
                                aria-label="Select trade"
                                checked={selectedIds.has(t.id)}
                                onChange={() => toggleSelected(t.id!)}
                                className="h-3.5 w-3.5 accent-primary align-middle"
                              />
                            )}
                          </td>
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
                          <td
                            colSpan={6}
                            className={cn(
                              "px-3 py-2 text-center bg-gradient-to-r ring-1 ring-inset",
                              liveTheme.bg,
                              liveTheme.ring,
                            )}
                          >
                            <span
                              className={cn(
                                "inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wider animate-pulse",
                                liveTheme.text,
                              )}
                            >
                              <span className="relative inline-flex h-2 w-2">
                                <span className={cn(
                                  "absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping",
                                  t.recoveryStage === "second" ? "bg-orange-400" : t.recoveryStage === "first" ? "bg-amber-400" : "bg-sky-400",
                                )} />
                                <span className={cn(
                                  "relative inline-flex h-2 w-2 rounded-full",
                                  t.recoveryStage === "second" ? "bg-orange-400" : t.recoveryStage === "first" ? "bg-amber-400" : "bg-sky-400",
                                )} />
                              </span>
                              {liveTheme.label}
                            </span>
                          </td>
                          <td className={cn(
                            "px-3 py-2 text-right bg-gradient-to-r ring-1 ring-inset",
                            liveTheme.bg,
                            liveTheme.ring,
                          )}>
                            <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                              {t.id != null && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingTrade(t);
                                      setModalOpen(true);
                                    }}
                                    title="Close trade — fill in outcome / MAE / MFE"
                                    className={cn(
                                      "rounded p-1 hover:bg-accent hover:text-foreground",
                                      liveTheme.text,
                                      "opacity-80",
                                    )}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setPendingDelete(t)}
                                    title="Delete trade"
                                    className={cn(
                                      "rounded p-1 hover:bg-destructive/10 hover:text-destructive-foreground",
                                      liveTheme.text,
                                      "opacity-80",
                                    )}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })()
                  ) : (
                  <tr key={t.index} className={cn("group border-t border-border/40 hover:bg-accent/20", t.id != null && selectedIds.has(t.id) && "bg-primary/5")}>
                    <td className="px-3 py-2">
                      {t.id != null && (
                        <input
                          type="checkbox"
                          aria-label="Select trade"
                          checked={selectedIds.has(t.id)}
                          onChange={() => toggleSelected(t.id!)}
                          className="h-3.5 w-3.5 accent-primary align-middle"
                        />
                      )}
                    </td>
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
                    <td className="px-3 py-2 text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        T{t.tradeNo}
                        {t.notes && t.notes.trim() !== "" && (
                          <span
                            className="inline-flex shrink-0 text-amber-300/80"
                            title={t.notes}
                            aria-label="This trade has a note"
                          >
                            <StickyNote className="h-3 w-3" />
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{t.mae ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {t.mfe != null ? (
                        t.mfe
                      ) : t.outcome === "Took Profit" ? (
                        <span
                          className="inline-block rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase text-amber-300"
                          title="Waiting for market close — record the session high after it closes"
                        >
                          pending
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-xs font-medium",
                          t.outcome === "Took Profit"
                            ? "bg-emerald-500/15 text-emerald-300"
                            : t.outcome === "Took Loss"
                            ? "bg-red-500/15 text-red-300"
                            : t.outcome === "Breakeven"
                            ? "bg-slate-500/20 text-slate-300"
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
                  ),
                )}
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
          premiumSeries={premiumSeries}
          speedSeries={speedSeries}
          existingTrades={dataset.trades}
          premiumSchedule={dataset.premiumScalingSchedule}
          speedSchedule={dataset.speedScalingSchedule}
          tpMode={dataset.tpMode}
          slMode={dataset.slMode}
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

      {/* Bulk delete confirmation */}
      <AlertDialog
        open={pendingBulkDelete}
        onOpenChange={(o) => !o && setPendingBulkDelete(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedIds.size} selected trade{selectedIds.size === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This can't be undone — metrics on every tab will recompute.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkDeleteMutation.isPending}
              onClick={() => {
                if (datasetId != null && selectedIds.size > 0) {
                  bulkDeleteMutation.mutate({
                    datasetId,
                    ids: Array.from(selectedIds),
                  });
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {bulkDeleteMutation.isPending
                ? "Deleting…"
                : `Delete ${selectedIds.size}`}
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

