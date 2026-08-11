import { useEffect, useMemo, useState } from "react";
import {
  Users,
  Plus,
  Share2,
  Trash2,
  Loader2,
  Copy,
  Check,
  Settings,
  CalendarPlus,
} from "lucide-react";
import { toast } from "sonner";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

import DashboardLayout from "../components/DashboardLayout";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { trpc } from "../lib/trpc";
import { cn, formatCurrency, pnlColor } from "../lib/utils";
import {
  MONTHS,
  buildCumulativeSeries,
  buildPeriodView,
  buildYearSummary,
  type PeriodView,
} from "../investor/calculations";
import { MonthTable } from "../investor/MonthTable";

const SELECTED_FUND_KEY = "investors.selectedFundId";
const inputClass =
  "h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-ring";
const pctStr = (n: number) => `${(n * 100).toFixed(2)}%`;

export default function Investors() {
  const utils = trpc.useUtils();
  const fundsQuery = trpc.investor.listFunds.useQuery();
  const funds = useMemo(() => fundsQuery.data ?? [], [fundsQuery.data]);

  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const s = localStorage.getItem(SELECTED_FUND_KEY);
    return s ? Number(s) : null;
  });
  const activeFundId = useMemo(() => {
    if (funds.length === 0) return null;
    if (selectedId && funds.some((f) => f.id === selectedId)) return selectedId;
    return funds[0].id;
  }, [funds, selectedId]);
  useEffect(() => {
    if (activeFundId != null)
      localStorage.setItem(SELECTED_FUND_KEY, String(activeFundId));
  }, [activeFundId]);

  const bookQuery = trpc.investor.getBook.useQuery(
    { fundId: activeFundId ?? -1 },
    { enabled: activeFundId != null },
  );

  const invalidate = () => {
    utils.investor.getBook.invalidate();
    utils.investor.listFunds.invalidate();
  };
  const mut = <T,>(msg: string) => ({
    onSuccess: () => {
      invalidate();
      if (msg) toast.success(msg);
    },
    onError: (e: { message?: string }) => toast.error(e.message ?? "Failed"),
  });

  const createFund = trpc.investor.createFund.useMutation(mut("Book created"));
  const deleteFund = trpc.investor.deleteFund.useMutation({
    ...mut("Book deleted"),
    onSuccess: () => {
      setSelectedId(null);
      invalidate();
      toast.success("Book deleted");
    },
  });
  const addInvestor = trpc.investor.addInvestor.useMutation(mut("Investor added"));
  const deleteInvestor = trpc.investor.deleteInvestor.useMutation(mut("Investor removed"));
  const addPeriod = trpc.investor.addPeriod.useMutation(mut("Month added"));
  const deletePeriod = trpc.investor.deletePeriod.useMutation(mut("Month deleted"));
  const updatePeriod = trpc.investor.updatePeriod.useMutation({
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e.message ?? "Failed"),
  });
  const setContribution = trpc.investor.setContribution.useMutation({
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e.message ?? "Failed"),
  });
  const enableShare = trpc.investor.enableSharing.useMutation({
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e.message ?? "Failed"),
  });
  const disableShare = trpc.investor.disableSharing.useMutation(mut("Sharing off"));

  const book = bookQuery.data;
  const periods: PeriodView[] = useMemo(() => {
    if (!book) return [];
    return book.periods
      .map((p) => buildPeriodView(p, book.investors, book.entries))
      .sort((a, b) => (a.year !== b.year ? b.year - a.year : b.month - a.month));
  }, [book]);

  const years = useMemo(
    () => [...new Set(periods.map((p) => p.year))].sort((a, b) => b - a),
    [periods],
  );
  const [tab, setTab] = useState("months");

  // ---- empty state --------------------------------------------------------
  if (fundsQuery.isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  if (funds.length === 0) {
    return (
      <DashboardLayout>
        <div className="p-4 sm:p-6">
          <Header />
          <Card className="mt-6 border-dashed bg-card/40">
            <CardContent className="py-12 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/15">
                <Users className="h-6 w-6 text-primary" />
              </div>
              <h2 className="text-lg font-semibold">No investor book yet</h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Create a book to track outside capital. Each month you enter one
                profit figure and everyone's share is worked out automatically.
              </p>
              <Button
                className="mt-5 gap-1.5"
                onClick={() => {
                  const name = prompt("Name this book (e.g. Gold Bot)");
                  if (name?.trim()) createFund.mutate({ name: name.trim() });
                }}
              >
                <Plus className="h-4 w-4" />
                New book
              </Button>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  const fund = book?.fund;
  const shareUrl = fund?.shareToken
    ? `${window.location.origin}/shared/investors/${fund.shareToken}`
    : null;

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Header />
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={activeFundId ?? ""}
              onChange={(e) => setSelectedId(Number(e.target.value))}
              className="h-9 rounded-md border border-border bg-card/60 px-3 text-sm"
            >
              {funds.map((f) => (
                <option key={f.id} value={f.id} className="bg-zinc-900">
                  {f.name}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => {
                const name = prompt("Name this book");
                if (name?.trim()) createFund.mutate({ name: name.trim() });
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              Book
            </Button>
            {fund && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-red-400 hover:text-red-300"
                onClick={() => {
                  if (
                    confirm(
                      `Delete "${fund.name}" and all of its months? This can't be undone.`,
                    )
                  )
                    deleteFund.mutate({ id: fund.id });
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {bookQuery.isLoading && (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {book && fund && (
          <>
            <ShareBar
              fundId={fund.id}
              shareUrl={shareUrl}
              onEnable={() => enableShare.mutate({ id: fund.id })}
              onDisable={() => disableShare.mutate({ id: fund.id })}
              pending={enableShare.isPending || disableShare.isPending}
            />

            <InvestorChips
              investors={book.investors}
              onAdd={() => {
                const name = prompt("Investor name");
                if (name?.trim())
                  addInvestor.mutate({ fundId: fund.id, name: name.trim() });
              }}
              onDelete={(id, name) => {
                if (
                  confirm(
                    `Remove ${name} from this book? Their rows in every month are deleted too.`,
                  )
                )
                  deleteInvestor.mutate({ id });
              }}
            />

            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="bg-card/60 max-w-full justify-start overflow-x-auto">
                <TabsTrigger value="months">Months</TabsTrigger>
                <TabsTrigger value="year">Yearly stats</TabsTrigger>
              </TabsList>

              <TabsContent value="months" className="mt-6 space-y-6">
                <AddMonthBar
                  onAdd={(year, month) =>
                    addPeriod.mutate({
                      fundId: fund.id,
                      year,
                      month,
                      carryForward: true,
                    })
                  }
                  pending={addPeriod.isPending}
                />
                {periods.length === 0 ? (
                  <Card className="border-dashed bg-card/40">
                    <CardContent className="py-10 text-center text-sm text-muted-foreground">
                      No months yet — add one above to start the book.
                    </CardContent>
                  </Card>
                ) : (
                  periods.map((p) => (
                    <MonthCard
                      key={p.id}
                      period={p}
                      onSetProfit={(v) =>
                        updatePeriod.mutate({ id: p.id, totalProfit: v })
                      }
                      onSetFees={(v) =>
                        updatePeriod.mutate({ id: p.id, totalFees: v })
                      }
                      onEditContribution={(investorId, name, current) => {
                        const raw = prompt(
                          `${name}'s contribution for ${p.label}`,
                          String(current),
                        );
                        if (raw == null) return;
                        const v = Number(raw.replace(/[$,]/g, ""));
                        if (!Number.isFinite(v)) {
                          toast.error("Enter a number");
                          return;
                        }
                        setContribution.mutate({
                          periodId: p.id,
                          investorId,
                          contribution: v,
                        });
                      }}
                      onDelete={() => {
                        if (confirm(`Delete ${p.label} from this book?`))
                          deletePeriod.mutate({ id: p.id });
                      }}
                    />
                  ))
                )}
              </TabsContent>

              <TabsContent value="year" className="mt-6">
                <YearlyStats periods={periods} years={years} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

function Header() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15">
        <Users className="h-5 w-5 text-primary" />
      </div>
      <div>
        <h1 className="text-2xl font-bold">Investor Ledger</h1>
        <p className="text-sm text-muted-foreground">
          Pro-rata client allocations, month by month.
        </p>
      </div>
    </div>
  );
}

function ShareBar({
  shareUrl,
  onEnable,
  onDisable,
  pending,
}: {
  fundId: number;
  shareUrl: string | null;
  onEnable: () => void;
  onDisable: () => void;
  pending: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Card className="bg-card/60">
      <CardContent className="flex flex-wrap items-center gap-3 py-3">
        <Share2 className="h-4 w-4 shrink-0 text-muted-foreground" />
        {shareUrl ? (
          <>
            <input
              readOnly
              value={shareUrl}
              onFocus={(e) => e.currentTarget.select()}
              className={cn(inputClass, "flex-1 min-w-[16rem] font-mono text-xs")}
            />
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => {
                navigator.clipboard.writeText(shareUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              }}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button size="sm" variant="ghost" onClick={onDisable} disabled={pending}>
              Revoke
            </Button>
          </>
        ) : (
          <>
            <span className="flex-1 text-sm text-muted-foreground">
              Private. Turn on a read-only link to send clients.
            </span>
            <Button size="sm" variant="outline" onClick={onEnable} disabled={pending}>
              Create client link
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function InvestorChips({
  investors,
  onAdd,
  onDelete,
}: {
  investors: { id: number; name: string; active: boolean }[];
  onAdd: () => void;
  onDelete: (id: number, name: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">
        Investors
      </span>
      {investors.map((i) => (
        <span
          key={i.id}
          className="group inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 py-1 pl-3 pr-1.5 text-sm"
        >
          {i.name}
          <button
            type="button"
            onClick={() => onDelete(i.id, i.name)}
            className="rounded-full p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
            title={`Remove ${i.name}`}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </span>
      ))}
      <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={onAdd}>
        <Plus className="h-3.5 w-3.5" />
        Add investor
      </Button>
    </div>
  );
}

function AddMonthBar({
  onAdd,
  pending,
}: {
  onAdd: (year: number, month: number) => void;
  pending: boolean;
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          Month
        </span>
        <select
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          className="h-9 rounded-md border border-border bg-background px-3 text-sm"
        >
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1} className="bg-zinc-900">
              {m}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          Year
        </span>
        <input
          inputMode="numeric"
          value={year}
          onChange={(e) => setYear(Number(e.target.value) || year)}
          className="h-9 w-24 rounded-md border border-border bg-background px-3 text-sm"
        />
      </label>
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5"
        disabled={pending}
        onClick={() => onAdd(year, month)}
      >
        <CalendarPlus className="h-3.5 w-3.5" />
        Add month
      </Button>
      <span className="pb-2 text-xs text-muted-foreground">
        Opening capital = last month's contribution + that investor's net P&L.
      </span>
    </div>
  );
}

function MonthCard({
  period,
  onSetProfit,
  onSetFees,
  onEditContribution,
  onDelete,
}: {
  period: PeriodView;
  onSetProfit: (v: number) => void;
  onSetFees: (v: number) => void;
  onEditContribution: (investorId: number, name: string, current: number) => void;
  onDelete: () => void;
}) {
  const [profit, setProfit] = useState(String(period.totalProfit));
  const [fees, setFees] = useState(String(period.totalFees));
  useEffect(() => setProfit(String(period.totalProfit)), [period.totalProfit]);
  useEffect(() => setFees(String(period.totalFees)), [period.totalFees]);

  const commit = (raw: string, fn: (v: number) => void, fallback: number) => {
    const v = Number(raw.replace(/[$,]/g, ""));
    if (!Number.isFinite(v)) {
      toast.error("Enter a number");
      return fallback;
    }
    fn(v);
    return v;
  };

  return (
    <Card className="bg-card/60">
      <CardContent className="space-y-4 pt-5 pb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">{period.label}</h3>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Net profit this month
              </span>
              <input
                inputMode="decimal"
                value={profit}
                onChange={(e) => setProfit(e.target.value)}
                onBlur={() => commit(profit, onSetProfit, period.totalProfit)}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                className={cn(inputClass, "w-36 text-right font-semibold")}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Fees
              </span>
              <input
                inputMode="decimal"
                value={fees}
                onChange={(e) => setFees(e.target.value)}
                onBlur={() => commit(fees, onSetFees, period.totalFees)}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                className={cn(inputClass, "w-28 text-right")}
              />
            </label>
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-red-400"
              onClick={onDelete}
              title="Delete month"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Total capital" value={formatCurrency(period.totalCapital)} />
          <Stat
            label="Gross P&L"
            value={formatCurrency(period.totalProfit)}
            tone={period.totalProfit}
          />
          <Stat
            label="Net P&L (after fees)"
            value={formatCurrency(period.netProfit)}
            tone={period.netProfit}
          />
          <Stat label="Net return" value={pctStr(period.netPct)} tone={period.netPct} />
        </div>

        <MonthTable period={period} editable onEditContribution={onEditContribution} />
        <p className="text-xs text-muted-foreground">
          Click any contribution to change it — use that to record a deposit or
          withdrawal. Everything else is derived pro-rata, and next month opens
          with this month's net P&L rolled into each balance.
        </p>
      </CardContent>
    </Card>
  );
}

function Stat({
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

export function YearlyStats({
  periods,
  years,
}: {
  periods: PeriodView[];
  years: number[];
}) {
  const [year, setYear] = useState(years[0] ?? new Date().getFullYear());
  useEffect(() => {
    if (years.length > 0 && !years.includes(year)) setYear(years[0]);
  }, [years, year]);

  const summary = useMemo(() => buildYearSummary(year, periods), [year, periods]);
  const series = useMemo(
    () => buildCumulativeSeries(periods.filter((p) => p.year === year)),
    [periods, year],
  );

  if (periods.length === 0) {
    return (
      <Card className="border-dashed bg-card/40">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Add a month to see yearly stats.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {years.map((y) => (
          <button
            key={y}
            type="button"
            onClick={() => setYear(y)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm transition-colors",
              y === year
                ? "border-primary/40 bg-primary/15 font-medium text-foreground"
                : "border-border bg-card/60 text-muted-foreground hover:text-foreground",
            )}
          >
            {y}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Current capital" value={formatCurrency(summary.latestCapital)} />
        <Stat
          label={`${year} gross P&L`}
          value={formatCurrency(summary.totalProfit)}
          tone={summary.totalProfit}
        />
        <Stat label="Fees" value={formatCurrency(summary.totalFees)} />
        <Stat
          label="Net P&L"
          value={formatCurrency(summary.netProfit)}
          tone={summary.netProfit}
        />
        <Stat
          label="Months"
          value={`${summary.greenMonths} green / ${summary.redMonths} red`}
        />
      </div>

      {series.length > 0 && (
        <Card className="bg-card/60">
          <CardContent className="pt-5">
            <h3 className="mb-3 text-sm font-semibold">Cumulative net P&L — {year}</h3>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={series} margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="invGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                <YAxis
                  tickFormatter={(v) => formatCurrency(v, 0)}
                  tick={{ fontSize: 11, fill: "#6b7280" }}
                  tickLine={false}
                  axisLine={false}
                  width={70}
                />
                <RechartsTooltip
                  content={({ active, payload, label }) =>
                    active && payload?.length ? (
                      <div className="rounded-lg border border-border bg-zinc-900 px-3 py-2 text-sm shadow-xl">
                        <p className="mb-1 text-muted-foreground">{label}</p>
                        <p className="font-semibold">
                          Cumulative {formatCurrency(Number(payload[0].value))}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Month {formatCurrency(Number(payload[0].payload.net))}
                        </p>
                      </div>
                    ) : null
                  }
                />
                <Area
                  type="monotone"
                  dataKey="cumulative"
                  stroke="#22c55e"
                  strokeWidth={2}
                  fill="url(#invGrad)"
                  dot={{ r: 3 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <Card className="bg-card/60">
        <CardContent className="pt-5 pb-5">
          <h3 className="mb-3 text-sm font-semibold">{year} by investor</h3>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[38rem] text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Investor</th>
                  <th className="px-3 py-2 text-right">Months</th>
                  <th className="px-3 py-2 text-right">Capital now</th>
                  <th className="px-3 py-2 text-right">Gross</th>
                  <th className="px-3 py-2 text-right">Fees</th>
                  <th className="px-3 py-2 text-right">Net</th>
                  <th className="px-3 py-2 text-right">Net return</th>
                </tr>
              </thead>
              <tbody>
                {summary.investors.map((v) => (
                  <tr key={v.investorId} className="border-t border-border/40">
                    <td className="px-3 py-2 font-medium">{v.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {v.months}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCurrency(v.latestContribution)}
                    </td>
                    <td className={cn("px-3 py-2 text-right tabular-nums", pnlColor(v.grossTotal))}>
                      {formatCurrency(v.grossTotal)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {formatCurrency(v.feeTotal)}
                    </td>
                    <td className={cn("px-3 py-2 text-right font-semibold tabular-nums", pnlColor(v.netTotal))}>
                      {formatCurrency(v.netTotal)}
                    </td>
                    <td className={cn("px-3 py-2 text-right font-semibold tabular-nums", pnlColor(v.netReturn))}>
                      {pctStr(v.netReturn)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Net return weights each month by the capital actually at risk that
            month, so adding or withdrawing funds mid-year doesn't distort it.
          </p>
        </CardContent>
      </Card>

      {(summary.bestMonth || summary.worstMonth) && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {summary.bestMonth && (
            <Stat
              label="Best month"
              value={`${summary.bestMonth.label} · ${pctStr(summary.bestMonth.netPct)}`}
              tone={summary.bestMonth.netPct}
            />
          )}
          {summary.worstMonth && (
            <Stat
              label="Worst month"
              value={`${summary.worstMonth.label} · ${pctStr(summary.worstMonth.netPct)}`}
              tone={summary.worstMonth.netPct}
            />
          )}
        </div>
      )}
    </div>
  );
}
