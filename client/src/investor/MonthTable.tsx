import { cn, formatCurrency, pnlColor } from "../lib/utils";
import type { PeriodView } from "./calculations";

const pctStr = (n: number) => `${(n * 100).toFixed(2)}%`;

// Shared month table — used by both the owner view and the client-facing
// shared page so the two can never drift apart.
export function MonthTable({
  period,
  editable,
  onEditContribution,
}: {
  period: PeriodView;
  editable?: boolean;
  onEditContribution?: (investorId: number, name: string, current: number) => void;
}) {
  if (period.rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No investors in this month yet.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[46rem] text-sm">
        <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Investor</th>
            <th className="px-3 py-2 text-right">Contribution</th>
            <th className="px-3 py-2 text-right">% of capital</th>
            <th className="px-3 py-2 text-right">Gross P&L</th>
            <th className="px-3 py-2 text-right">Fee share</th>
            <th className="px-3 py-2 text-right">Net P&L</th>
            <th className="px-3 py-2 text-right">Gross %</th>
            <th className="px-3 py-2 text-right">Net %</th>
          </tr>
        </thead>
        <tbody>
          {period.rows.map((r) => (
            <tr key={r.investorId} className="border-t border-border/40">
              <td className="px-3 py-2 font-medium">{r.name}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {editable ? (
                  <button
                    type="button"
                    onClick={() =>
                      onEditContribution?.(r.investorId, r.name, r.contribution)
                    }
                    className="rounded px-1.5 py-0.5 underline-offset-4 hover:bg-accent hover:underline"
                    title="Edit contribution"
                  >
                    {formatCurrency(r.contribution)}
                  </button>
                ) : (
                  formatCurrency(r.contribution)
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                {pctStr(r.weight)}
              </td>
              <td className={cn("px-3 py-2 text-right tabular-nums", pnlColor(r.gross))}>
                {formatCurrency(r.gross)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                {formatCurrency(r.fee)}
              </td>
              <td className={cn("px-3 py-2 text-right tabular-nums font-semibold", pnlColor(r.net))}>
                {formatCurrency(r.net)}
              </td>
              <td className={cn("px-3 py-2 text-right tabular-nums", pnlColor(r.pct))}>
                {pctStr(r.pct)}
              </td>
              <td className={cn("px-3 py-2 text-right tabular-nums font-semibold", pnlColor(r.netPct))}>
                {pctStr(r.netPct)}
              </td>
            </tr>
          ))}
          <tr className="border-t-2 border-border bg-muted/20 font-semibold">
            <td className="px-3 py-2">Total</td>
            <td className="px-3 py-2 text-right tabular-nums">
              {formatCurrency(period.totalCapital)}
            </td>
            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
              100.00%
            </td>
            <td className={cn("px-3 py-2 text-right tabular-nums", pnlColor(period.totalProfit))}>
              {formatCurrency(period.totalProfit)}
            </td>
            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
              {formatCurrency(period.totalFees)}
            </td>
            <td className={cn("px-3 py-2 text-right tabular-nums", pnlColor(period.netProfit))}>
              {formatCurrency(period.netProfit)}
            </td>
            <td className={cn("px-3 py-2 text-right tabular-nums", pnlColor(period.pct))}>
              {pctStr(period.pct)}
            </td>
            <td className={cn("px-3 py-2 text-right tabular-nums", pnlColor(period.netPct))}>
              {pctStr(period.netPct)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
