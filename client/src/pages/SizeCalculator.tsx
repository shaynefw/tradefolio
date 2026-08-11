import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Info, TrendingUp } from "lucide-react";

import { Card, CardContent } from "../components/ui/card";
import { cn } from "../lib/utils";

// ---------------------------------------------------------------------------
// Futures contracts and their dollar value per 1.00 index/price point, per
// contract. Tick size is shown for reference only — sizing math uses points.
// ---------------------------------------------------------------------------

interface Instrument {
  sym: string;
  name: string;
  perPoint: number; // $ per 1.0 point per contract
  tick: number; // point size of one tick
}

const INSTRUMENTS: Instrument[] = [
  { sym: "MNQ", name: "Micro E-mini Nasdaq-100", perPoint: 2, tick: 0.25 },
  { sym: "NQ", name: "E-mini Nasdaq-100", perPoint: 20, tick: 0.25 },
  { sym: "MES", name: "Micro E-mini S&P 500", perPoint: 5, tick: 0.25 },
  { sym: "ES", name: "E-mini S&P 500", perPoint: 50, tick: 0.25 },
  { sym: "MYM", name: "Micro E-mini Dow", perPoint: 0.5, tick: 1 },
  { sym: "YM", name: "E-mini Dow", perPoint: 5, tick: 1 },
  { sym: "M2K", name: "Micro E-mini Russell 2000", perPoint: 5, tick: 0.1 },
  { sym: "RTY", name: "E-mini Russell 2000", perPoint: 50, tick: 0.1 },
  { sym: "MGC", name: "Micro Gold", perPoint: 10, tick: 0.1 },
  { sym: "GC", name: "Gold", perPoint: 100, tick: 0.1 },
];

const STORAGE_KEY = "tf.sizeCalc.v1";

interface State {
  sym: string;
  customPerPoint: string;
  balance: string;
  riskMode: "pct" | "dollar";
  riskPct: string;
  riskDollar: string;
  stopPoints: string;
  tpPoints: string;
  propMode: boolean;
  buffer: string;
}

const DEFAULTS: State = {
  sym: "MNQ",
  customPerPoint: "2",
  balance: "50000",
  riskMode: "pct",
  riskPct: "2",
  riskDollar: "1000",
  stopPoints: "160",
  tpPoints: "",
  propMode: false,
  buffer: "2000",
};

function loadState(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return DEFAULTS;
}

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function PositionSizePanel() {
  const [s, setS] = useState<State>(loadState);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
      /* ignore */
    }
  }, [s]);

  const set = (patch: Partial<State>) => setS((p) => ({ ...p, ...patch }));

  const inst = INSTRUMENTS.find((i) => i.sym === s.sym) ?? null;
  const perPoint = inst ? inst.perPoint : Number(s.customPerPoint) || 0;

  const calc = useMemo(() => {
    const balance = Number(s.balance) || 0;
    const riskPct = Number(s.riskPct) || 0;
    const riskDollar = Number(s.riskDollar) || 0;
    const stop = Number(s.stopPoints) || 0;
    const tp = Number(s.tpPoints) || 0;
    const buffer = Number(s.buffer) || 0;
    const dollarMode = s.riskMode === "dollar";

    // Risk base: full balance, or (prop mode) the drawdown buffer.
    const base = s.propMode ? buffer : balance;
    // $ we're willing to lose: a fixed dollar amount, or a % of the base.
    const budget = dollarMode ? riskDollar : (riskPct / 100) * base;
    const riskPerContract = stop * perPoint; // $ lost if stopped, per contract
    const rawContracts = riskPerContract > 0 ? budget / riskPerContract : 0;
    const contracts = Math.max(0, Math.floor(rawContracts));

    const actualRisk = contracts * riskPerContract;
    const actualPctOfBalance = balance > 0 ? (actualRisk / balance) * 100 : 0;
    const actualPctOfBase = base > 0 ? (actualRisk / base) * 100 : 0;

    // One-contract figures, for the "can't size" case.
    const oneRisk = riskPerContract;
    const onePctOfBase = base > 0 ? (oneRisk / base) * 100 : 0;

    const rewardPerContract = tp > 0 ? tp * perPoint : 0;
    const rr = stop > 0 && tp > 0 ? tp / stop : 0;
    const targetProfit = contracts * rewardPerContract;

    // Scale-up ladder: `unit` is the extra base needed for each additional
    // contract (base at which floor() ticks up). Net wins to reach each tier
    // are stepped realistically — you trade the larger size as you climb, so
    // higher tiers arrive faster per dollar. A "net win" = one win beyond a
    // loss (wins − losses); it needs a target to know the per-win dollars.
    // Only meaningful in % mode — a fixed dollar risk doesn't grow with the
    // account, so more balance never earns another contract.
    const unit =
      !dollarMode && riskPct > 0 && riskPerContract > 0
        ? riskPerContract / (riskPct / 100)
        : 0;
    const tiers: {
      size: number;
      threshold: number;
      addFromCurrent: number;
      netWins: number | null;
      tradeable: boolean;
    }[] = [];
    if (unit > 0) {
      let cursor = base;
      let size = contracts;
      let winsAccum = 0;
      let tradeable = true;
      for (let m = contracts + 1; m <= contracts + 3; m++) {
        const threshold = m * unit;
        const segDollars = threshold - cursor;
        if (size <= 0) tradeable = false; // can't grow by trading with 0 contracts
        else if (rewardPerContract > 0) winsAccum += segDollars / (size * rewardPerContract);
        tiers.push({
          size: m,
          threshold,
          addFromCurrent: threshold - base,
          netWins: rewardPerContract > 0 && tradeable ? Math.ceil(winsAccum) : null,
          tradeable,
        });
        cursor = threshold;
        size = m;
      }
    }

    return {
      balance,
      base,
      budget,
      riskPerContract,
      rawContracts,
      contracts,
      actualRisk,
      actualPctOfBalance,
      actualPctOfBase,
      oneRisk,
      onePctOfBase,
      rr,
      rewardPerContract,
      targetProfit,
      tp,
      unit,
      tiers,
      dollarMode,
    };
  }, [s, perPoint]);

  const inputClass =
    "h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-ring";

  const cantSize = calc.contracts === 0 && calc.riskPerContract > 0;

  return (
    <>
      <div className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Risk-based contract sizing for futures. Always rounds down to stay at or under your risk cap.
        </p>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Inputs */}
          <Card className="bg-card/60">
            <CardContent className="pt-5 pb-5 space-y-4">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">
                  Instrument
                </span>
                <select
                  value={s.sym}
                  onChange={(e) => set({ sym: e.target.value })}
                  className={inputClass}
                >
                  {INSTRUMENTS.map((i) => (
                    <option key={i.sym} value={i.sym}>
                      {i.sym} — {i.name} (${i.perPoint}/pt)
                    </option>
                  ))}
                  <option value="__custom">Custom…</option>
                </select>
              </label>

              {s.sym === "__custom" && (
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">
                    $ per point (per contract)
                  </span>
                  <input
                    inputMode="decimal"
                    value={s.customPerPoint}
                    onChange={(e) => set({ customPerPoint: e.target.value })}
                    className={inputClass}
                  />
                </label>
              )}

              <div className="grid grid-cols-2 gap-4">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">
                    Account balance ($)
                  </span>
                  <input
                    inputMode="decimal"
                    value={s.balance}
                    onChange={(e) => set({ balance: e.target.value })}
                    className={inputClass}
                  />
                </label>
                <div className="flex flex-col gap-1 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs uppercase tracking-wider text-muted-foreground">
                      Risk per trade
                    </span>
                    <div className="inline-flex overflow-hidden rounded-md border border-border">
                      {(["pct", "dollar"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => set({ riskMode: m })}
                          className={cn(
                            "px-2 py-0.5 text-xs font-medium transition-colors",
                            s.riskMode === m
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {m === "pct" ? "%" : "$"}
                        </button>
                      ))}
                    </div>
                  </div>
                  {s.riskMode === "pct" ? (
                    <input
                      key="pct"
                      inputMode="decimal"
                      value={s.riskPct}
                      onChange={(e) => set({ riskPct: e.target.value })}
                      className={inputClass}
                      placeholder="2"
                    />
                  ) : (
                    <input
                      key="dollar"
                      inputMode="decimal"
                      value={s.riskDollar}
                      onChange={(e) => set({ riskDollar: e.target.value })}
                      className={inputClass}
                      placeholder="1000"
                    />
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">
                    Stop (points)
                  </span>
                  <input
                    inputMode="decimal"
                    value={s.stopPoints}
                    onChange={(e) => set({ stopPoints: e.target.value })}
                    className={inputClass}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">
                    Target (points, optional)
                  </span>
                  <input
                    inputMode="decimal"
                    value={s.tpPoints}
                    onChange={(e) => set({ tpPoints: e.target.value })}
                    className={inputClass}
                  />
                </label>
              </div>

              {/* Prop mode */}
              <div className="rounded-md border border-border/60 bg-background/40 p-3 space-y-3">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={s.propMode}
                    onChange={(e) => set({ propMode: e.target.checked })}
                    className="h-4 w-4 accent-primary"
                  />
                  <span className="font-medium">Prop mode — size off drawdown buffer</span>
                </label>
                {s.propMode && (
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-xs uppercase tracking-wider text-muted-foreground">
                      Drawdown buffer ($ to your limit)
                    </span>
                    <input
                      inputMode="decimal"
                      value={s.buffer}
                      onChange={(e) => set({ buffer: e.target.value })}
                      className={inputClass}
                    />
                    <span className="text-xs text-muted-foreground">
                      Risk % is taken from this buffer, not the account face value.
                    </span>
                  </label>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Results */}
          <Card className="bg-card/60">
            <CardContent className="pt-5 pb-5 space-y-4">
              <div className="text-center py-2">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  Position size
                </p>
                <p
                  className={cn(
                    "text-5xl font-bold tabular-nums mt-1",
                    cantSize ? "text-red-400" : "text-green-400",
                  )}
                >
                  {calc.contracts}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  contract{calc.contracts === 1 ? "" : "s"} · rounded down from{" "}
                  {calc.rawContracts.toFixed(2)}
                </p>
              </div>

              {cantSize && (
                <div className="flex gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    Even 1 contract risks {money(calc.oneRisk)}
                    {calc.dollarMode
                      ? ` — above your ${money(calc.budget)} budget`
                      : ` = ${calc.onePctOfBase.toFixed(1)}% of your ${s.propMode ? "buffer" : "balance"}, above your ${s.riskPct}% cap`}
                    . Trade a tighter stop, a bigger account, or raise the limit
                    as a deliberate choice.
                  </span>
                </div>
              )}

              <dl className="space-y-2 text-sm border-t border-border/40 pt-4">
                <Row
                  label="Risk budget"
                  hint={calc.dollarMode ? "fixed $" : `${s.riskPct}% of ${s.propMode ? "buffer" : "balance"}`}
                >
                  {money(calc.budget)}
                </Row>
                <Row label="Risk per contract" hint={`${s.stopPoints || 0}pt × $${perPoint}/pt`}>
                  {money(calc.riskPerContract)}
                </Row>
                <Row label="Actual risk at this size">
                  <span className={cantSize ? "text-muted-foreground" : "text-foreground"}>
                    {money(calc.actualRisk)}
                  </span>
                </Row>
                <Row label="% of account balance">
                  {calc.actualPctOfBalance.toFixed(2)}%
                </Row>
                {s.propMode && (
                  <Row label="% of drawdown buffer">
                    {calc.actualPctOfBase.toFixed(2)}%
                  </Row>
                )}
                {calc.tp > 0 && (
                  <>
                    <div className="border-t border-border/40 pt-2" />
                    <Row label="Reward : risk" hint={`${s.tpPoints}pt : ${s.stopPoints}pt`}>
                      {calc.rr ? `1 : ${calc.rr.toFixed(2)}` : "—"}
                    </Row>
                    <Row label="Target profit at this size">
                      <span className="text-green-400">{money(calc.targetProfit)}</span>
                    </Row>
                  </>
                )}
              </dl>

              <p className="flex gap-2 text-xs text-muted-foreground border-t border-border/40 pt-3">
                <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  Sizing rounds <span className="font-medium text-foreground/80">down</span> —
                  rounding up would push every trade over your cap, and one extra
                  contract is a whole step of risk on futures. Recompute off your
                  start-of-day balance, not tick by tick.
                </span>
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Scale-up note in fixed-dollar mode (no tiers — risk doesn't scale) */}
        {calc.dollarMode && (
          <p className="flex gap-2 text-xs text-muted-foreground max-w-2xl">
            <TrendingUp className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              Scale-up preview shows in <span className="font-medium text-foreground/80">%</span> mode.
              A fixed-dollar risk doesn't grow with the account, so your size
              stays flat regardless of balance.
            </span>
          </p>
        )}

        {/* Scale-up preview */}
        {calc.unit > 0 && calc.tiers.length > 0 && (
          <Card className="bg-card/60">
            <CardContent className="pt-5 pb-5">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">Scale-up preview</h2>
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                The {s.propMode ? "buffer" : "balance"} at which you earn each
                additional contract, and the net winning trades (wins − losses)
                to get there from where you are — trading the larger size as you
                climb.
              </p>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[30rem] text-sm">
                  <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Size</th>
                      <th className="px-3 py-2 text-right">
                        {s.propMode ? "Buffer" : "Balance"} needed
                      </th>
                      <th className="px-3 py-2 text-right">+ from here</th>
                      <th className="px-3 py-2 text-right">Net wins (W−L)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calc.tiers.map((t, i) => (
                      <tr
                        key={t.size}
                        className={cn(
                          "border-t border-border/40",
                          i === 0 && "bg-primary/5",
                        )}
                      >
                        <td className="px-3 py-2 font-medium tabular-nums">
                          {t.size} ct
                          {i === 0 && (
                            <span className="ml-1.5 text-xs font-normal text-primary">
                              next
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {money(t.threshold)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          +{money(t.addFromCurrent)}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2 text-right tabular-nums font-semibold",
                            t.netWins !== null ? "text-green-400" : "text-muted-foreground",
                          )}
                        >
                          {t.netWins !== null ? t.netWins : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {calc.rewardPerContract <= 0 ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Enter a <span className="font-medium text-foreground/80">target</span>{" "}
                  above to see how many net wins each tier takes.
                </p>
              ) : calc.contracts === 0 ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  You can't trade a contract yet, so growth has to come from
                  adding to the account — net wins apply once you're sizing at
                  least 1 contract.
                </p>
              ) : null}
            </CardContent>
          </Card>
        )}

        <p className="text-xs text-muted-foreground max-w-2xl">
          Formula: <span className="font-mono text-foreground/80">contracts = floor( (risk% × base) ÷ (stop points × $/point) )</span>.
          {" "}Values are stored locally in your browser.
        </p>
      </div>
    </>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">
        {label}
        {hint && <span className="ml-1.5 text-xs text-muted-foreground/60">({hint})</span>}
      </dt>
      <dd className="font-semibold tabular-nums">{children}</dd>
    </div>
  );
}
