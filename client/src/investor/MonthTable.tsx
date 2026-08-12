import { cn, formatMoney, pnlColor } from "../lib/utils";
import type { PeriodView } from "./calculations";

const pctStr = (n: number) => `${(n * 100).toFixed(2)}%`;

// Shared month table — used by both the owner view and the client-facing
// shared page so the two can never drift apart.
export function MonthTable({
  period,
  currency = "USD",
  editable,
  onEditContribution,
  onEditWithdrawalFee,
}: {
  period: PeriodView;
  currency?: string;
  editable?: boolean;
  onEditContribution?: (investorId: number, name: string, current: number) => void;
  onEditWithdrawalFee?: (investorId: number, name: string, current: number) => void;
}) {
  if (period.rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No investors in this month yet.
      </p>
    );
  }
  const $ = (n: number) => formatMoney(n, currency);
  // Show the withdrawal-fee column when the owner can edit it, or when any
  // investor actually has one (so clients only see it when it's relevant).
  const anyFee = period.rows.some((r) => r.withdrawalFee > 0);
  const showFee = Boolean(editable) || anyFee;
  const totalFee = period.rows.reduce((s, r) => s + r.withdrawalFee, 0);

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
            {showFee && (
              <th className="px-3 py-2 text-right" title="Wire/withdrawal fee — deducted from next month's opening balance">
                Withdrawal fee
              </th>
            )}
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
                    {$(r.contribution)}
                  </button>
                ) : (
                  $(r.contribution)
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                {pctStr(r.weight)}
              </td>
              <td className={cn("px-3 py-2 text-right tabular-nums", pnlColor(r.gross))}>
                {$(r.gross)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                {$(r.fee)}
              </td>
              <td className={cn("px-3 py-2 text-right tabular-nums font-semibold", pnlColor(r.net))}>
                {$(r.net)}
              </td>
              {showFee && (
                <td className="px-3 py-2 text-right tabular-nums">
                  {editable ? (
                    <button
                      type="button"
                      onClick={() =>
                        onEditWithdrawalFee?.(r.investorId, r.name, r.withdrawalFee)
                      }
                      className={cn(
                        "rounded px-1.5 py-0.5 underline-offset-4 hover:bg-accent hover:underline",
                        r.withdrawalFee > 0 ? "text-amber-300" : "text-muted-foreground/60",
                      )}
                      title="Set withdrawal fee (carried into next month)"
                    >
                      {r.withdrawalFee > 0 ? `−${$(r.withdrawalFee)}` : "—"}
                    </button>
                  ) : r.withdrawalFee > 0 ? (
                    <span className="text-amber-300">−{$(r.withdrawalFee)}</span>
                  ) : (
                    <span className="text-muted-foreground/60">—</span>
                  )}
                </td>
              )}
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
              {$(period.totalCapital)}
            </td>
            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
              100.00%
            </td>
            <td className={cn("px-3 py-2 text-right tabular-nums", pnlColor(period.totalProfit))}>
              {$(period.totalProfit)}
            </td>
            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
              {$(period.totalFees)}
            </td>
            <td className={cn("px-3 py-2 text-right tabular-nums", pnlColor(period.netProfit))}>
              {$(period.netProfit)}
            </td>
            {showFee && (
              <td className="px-3 py-2 text-right tabular-nums text-amber-300">
                {totalFee > 0 ? `−${$(totalFee)}` : "—"}
              </td>
            )}
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
