import { useEffect, useMemo, useState } from "react";

import { Card, CardContent } from "../components/ui/card";
import { cn, formatMoney, pnlColor } from "../lib/utils";
import { MONTHS, type PeriodView } from "./calculations";

const pctStr = (n: number) => `${(n * 100).toFixed(2)}%`;

// One cell's worth of numbers — either the whole fund's month, or a single
// investor's slice of it.
interface Cell {
  month: number;
  present: boolean;
  capital: number;
  net: number;
  netPct: number;
}

// Twelve-month grid for a year, so a client can see the whole year at a glance
// instead of scrolling month cards. Lives inside the Yearly stats tab and is
// driven by that tab's year selector. Switching the "view as" selector recasts
// every cell as that investor's own numbers.
export function YearCalendar({
  periods,
  year,
  currency = "USD",
}: {
  periods: PeriodView[];
  year: number;
  currency?: string;
}) {
  const $ = (n: number) => formatMoney(n, currency);
  const [investorId, setInvestorId] = useState<number | "fund">("fund");

  // Everyone who appears anywhere in the selected year.
  const people = useMemo(() => {
    const seen = new Map<number, string>();
    for (const p of periods) {
      if (p.year !== year) continue;
      for (const r of p.rows) seen.set(r.investorId, r.name);
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [periods, year]);

  // Fall back to the fund view if the selected person isn't in this year.
  useEffect(() => {
    if (investorId !== "fund" && !people.some((p) => p.id === investorId)) {
      setInvestorId("fund");
    }
  }, [people, investorId]);

  const cells: Cell[] = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      const p = periods.find((x) => x.year === year && x.month === month);
      if (!p) {
        return { month, present: false, capital: 0, net: 0, netPct: 0 };
      }
      if (investorId === "fund") {
        return {
          month,
          present: true,
          capital: p.totalCapital,
          net: p.netProfit,
          netPct: p.netPct,
        };
      }
      const row = p.rows.find((r) => r.investorId === investorId);
      if (!row) {
        return { month, present: false, capital: 0, net: 0, netPct: 0 };
      }
      return {
        month,
        present: true,
        capital: row.contribution,
        net: row.net,
        netPct: row.netPct,
      };
    });
  }, [periods, year, investorId]);

  const live = cells.filter((c) => c.present);
  const totalNet = live.reduce((s, c) => s + c.net, 0);
  const green = live.filter((c) => c.net > 0).length;
  const red = live.filter((c) => c.net < 0).length;
  // Compounded return over the year: chain each month's return together, which
  // is the honest figure once profits roll into the next month's capital.
  const compounded = live.reduce((acc, c) => acc * (1 + c.netPct), 1) - 1;
  const label =
    investorId === "fund"
      ? "Fund"
      : (people.find((p) => p.id === investorId)?.name ?? "Fund");

  return (
    <Card className="bg-card/60">
      <CardContent className="space-y-4 pt-5 pb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">{year} at a glance</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Every month side by side. Green months made money, red lost it.
            </p>
          </div>
          {people.length > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                View as
              </span>
              <select
                value={investorId}
                onChange={(e) =>
                  setInvestorId(
                    e.target.value === "fund" ? "fund" : Number(e.target.value),
                  )
                }
                className="h-9 rounded-md border border-border bg-background px-3 text-sm"
              >
                <option value="fund" className="bg-zinc-900">
                  Whole fund
                </option>
                {people.map((p) => (
                  <option key={p.id} value={p.id} className="bg-zinc-900">
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {cells.map((c) => (
          <div
            key={c.month}
            className={cn(
              "rounded-lg border p-3 transition-colors",
              !c.present && "border-dashed border-border/50 bg-card/20",
              c.present && c.net > 0 && "border-green-500/25 bg-green-500/[0.07]",
              c.present && c.net < 0 && "border-red-500/25 bg-red-500/[0.07]",
              c.present && c.net === 0 && "border-border bg-card/50",
            )}
          >
            <div className="flex items-baseline justify-between">
              <span
                className={cn(
                  "text-xs font-semibold uppercase tracking-wider",
                  c.present ? "text-foreground/80" : "text-muted-foreground/50",
                )}
              >
                {MONTHS[c.month - 1]}
              </span>
              {c.present && (
                <span
                  className={cn("text-xs font-medium tabular-nums", pnlColor(c.netPct))}
                >
                  {c.netPct >= 0 ? "+" : ""}
                  {pctStr(c.netPct)}
                </span>
              )}
            </div>

            {c.present ? (
              <>
                <p
                  className={cn(
                    "mt-1.5 text-lg font-bold tabular-nums",
                    pnlColor(c.net),
                  )}
                >
                  {c.net >= 0 ? "+" : ""}
                  {$(c.net)}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  capital {$(c.capital)}
                </p>
              </>
            ) : (
              <p className="mt-1.5 text-sm text-muted-foreground/40">—</p>
            )}
          </div>
        ))}
      </div>

        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-md border border-border/60 bg-background/40 px-3 py-2.5 text-sm">
          <span className="text-muted-foreground">
            {label} · {year}
          </span>
          <span>
            <span className="text-muted-foreground">Net </span>
            <span className={cn("font-semibold tabular-nums", pnlColor(totalNet))}>
              {totalNet >= 0 ? "+" : ""}
              {$(totalNet)}
            </span>
          </span>
          <span>
            <span className="text-muted-foreground">Compounded </span>
            <span className={cn("font-semibold tabular-nums", pnlColor(compounded))}>
              {compounded >= 0 ? "+" : ""}
              {pctStr(compounded)}
            </span>
          </span>
          <span className="text-muted-foreground">
            <span className="text-green-400">{green} green</span>
            {" · "}
            <span className="text-red-400">{red} red</span>
            {" · "}
            {live.length} month{live.length === 1 ? "" : "s"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
