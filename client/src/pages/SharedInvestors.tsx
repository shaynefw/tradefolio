import { useMemo, useState } from "react";
import { useRoute } from "wouter";
import { Loader2, TrendingUp, Users } from "lucide-react";

import { trpc } from "../lib/trpc";
import { Card, CardContent } from "../components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { cn, formatCurrency, pnlColor } from "../lib/utils";
import { buildPeriodView, type PeriodView } from "../investor/calculations";
import { MonthTable } from "../investor/MonthTable";
import { YearlyStats } from "./Investors";

const pctStr = (n: number) => `${(n * 100).toFixed(2)}%`;

// Public, unauthenticated client view of an investor book.
export default function SharedInvestors() {
  const [, params] = useRoute("/shared/investors/:token");
  const token = params?.token ?? "";
  const query = trpc.investor.getShared.useQuery(
    { token },
    { enabled: token.length > 0, retry: false },
  );

  const periods: PeriodView[] = useMemo(() => {
    if (!query.data) return [];
    return query.data.periods
      .map((p) => buildPeriodView(p, query.data.investors, query.data.entries))
      .sort((a, b) => (a.year !== b.year ? b.year - a.year : b.month - a.month));
  }, [query.data]);

  const years = useMemo(
    () => [...new Set(periods.map((p) => p.year))].sort((a, b) => b - a),
    [periods],
  );
  const [tab, setTab] = useState("months");
  const latest = periods[0] ?? null;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-2.5 border-b border-border bg-card/95 px-4 backdrop-blur">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
          <TrendingUp className="h-4 w-4 text-primary-foreground" />
        </div>
        <span className="text-base font-semibold tracking-tight">Tradefolio</span>
        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
          Investor statement · read-only
        </span>
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
              <Users className="h-6 w-6 text-destructive-foreground" />
            </div>
            <h2 className="text-lg font-semibold">Link unavailable</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {query.error?.message ??
                "This link is invalid or has been revoked."}
            </p>
          </div>
        )}

        {query.data && (
          <>
            <div>
              <h1 className="text-2xl font-bold">{query.data.fund.name}</h1>
              <p className="text-sm text-muted-foreground">
                {periods.length} month{periods.length === 1 ? "" : "s"} on record
                {latest ? ` · latest ${latest.label}` : ""}
              </p>
            </div>

            {query.data.fund.notes && (
              <div className="rounded-md border border-border bg-card/40 p-3 text-sm">
                <p className="whitespace-pre-wrap text-foreground/85">
                  {query.data.fund.notes}
                </p>
              </div>
            )}

            {latest && (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Tile label="Capital" value={formatCurrency(latest.totalCapital)} />
                <Tile
                  label={`${latest.label} net`}
                  value={formatCurrency(latest.netProfit)}
                  tone={latest.netProfit}
                />
                <Tile
                  label="Net return"
                  value={pctStr(latest.netPct)}
                  tone={latest.netPct}
                />
                <Tile label="Fees" value={formatCurrency(latest.totalFees)} />
              </div>
            )}

            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="max-w-full justify-start overflow-x-auto">
                <TabsTrigger value="months">Months</TabsTrigger>
                <TabsTrigger value="year">Yearly stats</TabsTrigger>
              </TabsList>

              <TabsContent value="months" className="mt-6 space-y-6">
                {periods.map((p) => (
                  <Card key={p.id} className="bg-card/60">
                    <CardContent className="space-y-4 pt-5 pb-5">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h3 className="text-lg font-semibold">{p.label}</h3>
                        <p className="text-sm">
                          <span className="text-muted-foreground">Net </span>
                          <span className={cn("font-semibold", pnlColor(p.netProfit))}>
                            {formatCurrency(p.netProfit)}
                          </span>
                          <span className={cn("ml-2", pnlColor(p.netPct))}>
                            ({pctStr(p.netPct)})
                          </span>
                        </p>
                      </div>
                      <MonthTable period={p} />
                    </CardContent>
                  </Card>
                ))}
              </TabsContent>

              <TabsContent value="year" className="mt-6">
                <YearlyStats periods={periods} years={years} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: number;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-card/40 p-3">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 text-lg font-semibold tabular-nums",
          tone !== undefined ? pnlColor(tone) : "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}
