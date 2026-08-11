import { useEffect, useState } from "react";
import { Info } from "lucide-react";

import { Card, CardContent } from "../components/ui/card";
import { cn } from "../lib/utils";

// ---------------------------------------------------------------------------
// Trader-oriented percentage tools. Same spirit as a generic percent
// calculator, but framed around the four things traders actually reach for:
// move size between two prices, drawdown-recovery asymmetry, percent-of-account
// risk budgeting, and per-trade compounding.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "tf.pctCalc.v1";

interface State {
  // price move
  entry: string;
  exit: string;
  contracts: string;
  perPoint: string;
  // drawdown recovery
  ddPct: string;
  peak: string;
  current: string;
  ddMode: "pct" | "balance";
  // percent of
  pctOfA: string;
  pctOfB: string;
  isWhatA: string;
  isWhatB: string;
  // compounding
  cmpStart: string;
  cmpPct: string;
  cmpN: string;
}

const DEFAULTS: State = {
  entry: "20000",
  exit: "20100",
  contracts: "3",
  perPoint: "2",
  ddPct: "20",
  peak: "50000",
  current: "48000",
  ddMode: "pct",
  pctOfA: "2",
  pctOfB: "50000",
  isWhatA: "600",
  isWhatB: "50000",
  cmpStart: "50000",
  cmpPct: "1",
  cmpN: "20",
};

function load(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return DEFAULTS;
}

const num = (s: string) => {
  const n = Number(String(s).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const money = (n: number, dp = 2) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
const pct = (n: number, dp = 2) => `${n >= 0 ? "" : ""}${n.toFixed(dp)}%`;

const inputClass =
  "h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-ring";

function Field({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

function Out({
  label,
  children,
  big,
  tone,
}: {
  label: string;
  children: React.ReactNode;
  big?: boolean;
  tone?: "good" | "bad" | "plain";
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-semibold tabular-nums",
          big ? "text-xl" : "text-sm",
          tone === "good" && "text-green-400",
          tone === "bad" && "text-red-400",
        )}
      >
        {children}
      </span>
    </div>
  );
}

function Panel({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="bg-card/60">
      <CardContent className="pt-5 pb-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{blurb}</p>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

export default function PercentCalculator() {
  const [s, setS] = useState<State>(load);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
      /* ignore */
    }
  }, [s]);
  const set = (p: Partial<State>) => setS((v) => ({ ...v, ...p }));

  // ---- 1. price move -------------------------------------------------------
  const entry = num(s.entry);
  const exit = num(s.exit);
  const points = exit - entry;
  const movePct = entry !== 0 ? (points / entry) * 100 : 0;
  const dollars = points * num(s.contracts) * num(s.perPoint);

  // ---- 2. drawdown recovery ------------------------------------------------
  // Losing X% needs X/(1−X) to get back — the asymmetry that kills accounts.
  const ddFromBalance =
    num(s.peak) > 0 ? ((num(s.peak) - num(s.current)) / num(s.peak)) * 100 : 0;
  const lossPct = s.ddMode === "pct" ? num(s.ddPct) : ddFromBalance;
  const lossFrac = lossPct / 100;
  const recoverPct = lossFrac < 1 && lossFrac > 0 ? (lossFrac / (1 - lossFrac)) * 100 : 0;
  const recoverable = lossFrac > 0 && lossFrac < 1;

  // ---- 3. percent of -------------------------------------------------------
  const whatIs = (num(s.pctOfA) / 100) * num(s.pctOfB);
  const isWhatPct = num(s.isWhatB) !== 0 ? (num(s.isWhatA) / num(s.isWhatB)) * 100 : 0;

  // ---- 4. compounding ------------------------------------------------------
  const cmpStart = num(s.cmpStart);
  const cmpRate = num(s.cmpPct) / 100;
  const cmpN = Math.max(0, Math.floor(num(s.cmpN)));
  const cmpEnd = cmpStart * Math.pow(1 + cmpRate, cmpN);
  const cmpGain = cmpEnd - cmpStart;
  const cmpTotalPct = cmpStart !== 0 ? (cmpGain / cmpStart) * 100 : 0;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        The percentage math traders actually use — move size, drawdown recovery,
        risk budgeting, and compounding.
      </p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 1 — price move */}
        <Panel
          title="Price move → % / points / $"
          blurb="How big was the move, in percent, points, and dollars at your size."
        >
          <div className="grid grid-cols-2 gap-4">
            <Field label="Entry price" value={s.entry} onChange={(v) => set({ entry: v })} />
            <Field label="Exit price" value={s.exit} onChange={(v) => set({ exit: v })} />
            <Field label="Contracts" value={s.contracts} onChange={(v) => set({ contracts: v })} />
            <Field
              label="$ per point"
              value={s.perPoint}
              onChange={(v) => set({ perPoint: v })}
              hint="MNQ = 2 · MES = 5 · ES = 50"
            />
          </div>
          <div className="space-y-2 border-t border-border/40 pt-3">
            <Out label="Move" big tone={points >= 0 ? "good" : "bad"}>
              {points >= 0 ? "+" : ""}
              {pct(movePct, 3)}
            </Out>
            <Out label="Points" tone={points >= 0 ? "good" : "bad"}>
              {points >= 0 ? "+" : ""}
              {points.toLocaleString("en-US", { maximumFractionDigits: 2 })}
            </Out>
            <Out label="P&L at this size" tone={dollars >= 0 ? "good" : "bad"}>
              {dollars >= 0 ? "+" : ""}
              {money(dollars, 2)}
            </Out>
          </div>
        </Panel>

        {/* 2 — drawdown recovery */}
        <Panel
          title="Drawdown → recovery needed"
          blurb="Losses and gains aren't symmetric. This is the one every trader underestimates."
        >
          <div className="inline-flex overflow-hidden rounded-md border border-border">
            {(["pct", "balance"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => set({ ddMode: m })}
                className={cn(
                  "px-3 py-1 text-xs font-medium transition-colors",
                  s.ddMode === m
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m === "pct" ? "Enter %" : "From balances"}
              </button>
            ))}
          </div>
          {s.ddMode === "pct" ? (
            <Field label="Loss (%)" value={s.ddPct} onChange={(v) => set({ ddPct: v })} />
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Peak balance" value={s.peak} onChange={(v) => set({ peak: v })} />
              <Field label="Current balance" value={s.current} onChange={(v) => set({ current: v })} />
            </div>
          )}
          <div className="space-y-2 border-t border-border/40 pt-3">
            <Out label="Drawdown" tone="bad">
              −{pct(Math.abs(lossPct))}
            </Out>
            <Out label="Gain needed to break even" big tone={recoverable ? "good" : "bad"}>
              {recoverable ? `+${pct(recoverPct)}` : lossFrac >= 1 ? "∞" : "—"}
            </Out>
            {lossFrac >= 1 && (
              <p className="text-xs text-red-300/80">
                A 100% loss can't be recovered by any percentage gain.
              </p>
            )}
          </div>
          <div className="rounded-md border border-border/60 bg-background/40 p-2.5">
            <p className="mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
              Reference
            </p>
            <div className="grid grid-cols-4 gap-1 text-center text-xs">
              {[10, 20, 30, 50].map((l) => (
                <div key={l}>
                  <p className="text-red-400">−{l}%</p>
                  <p className="text-green-400">+{((l / (100 - l)) * 100).toFixed(1)}%</p>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        {/* 3 — percent of */}
        <Panel
          title="Percent of / what percent"
          blurb="Risk budgets and loss-as-a-share-of-account, both directions."
        >
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-end gap-2">
              <span className="pb-2 text-sm text-muted-foreground">What is</span>
              <div className="w-24">
                <Field label="%" value={s.pctOfA} onChange={(v) => set({ pctOfA: v })} />
              </div>
              <span className="pb-2 text-sm text-muted-foreground">of</span>
              <div className="w-36">
                <Field label="amount" value={s.pctOfB} onChange={(v) => set({ pctOfB: v })} />
              </div>
            </div>
            <Out label="Result" big tone="plain">
              {money(whatIs, 2)}
            </Out>
          </div>
          <div className="space-y-1.5 border-t border-border/40 pt-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-32">
                <Field label="amount" value={s.isWhatA} onChange={(v) => set({ isWhatA: v })} />
              </div>
              <span className="pb-2 text-sm text-muted-foreground">is what % of</span>
              <div className="w-32">
                <Field label="total" value={s.isWhatB} onChange={(v) => set({ isWhatB: v })} />
              </div>
            </div>
            <Out label="Result" big tone="plain">
              {pct(isWhatPct, 3)}
            </Out>
          </div>
        </Panel>

        {/* 4 — compounding */}
        <Panel
          title="Compounding"
          blurb="Growing a balance by a fixed % per trade or per day."
        >
          <div className="grid grid-cols-3 gap-4">
            <Field label="Start" value={s.cmpStart} onChange={(v) => set({ cmpStart: v })} />
            <Field label="% each" value={s.cmpPct} onChange={(v) => set({ cmpPct: v })} />
            <Field label="Periods" value={s.cmpN} onChange={(v) => set({ cmpN: v })} />
          </div>
          <div className="space-y-2 border-t border-border/40 pt-3">
            <Out label="Ending balance" big tone={cmpGain >= 0 ? "good" : "bad"}>
              {money(cmpEnd, 2)}
            </Out>
            <Out label="Total gain" tone={cmpGain >= 0 ? "good" : "bad"}>
              {cmpGain >= 0 ? "+" : ""}
              {money(cmpGain, 2)}
            </Out>
            <Out label="Total %" tone={cmpGain >= 0 ? "good" : "bad"}>
              {cmpTotalPct >= 0 ? "+" : ""}
              {pct(cmpTotalPct)}
            </Out>
          </div>
          <p className="flex gap-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              Compounding assumes every period returns exactly this %. Real
              results vary trade to trade — treat it as a ceiling, not a plan.
            </span>
          </p>
        </Panel>
      </div>

      <p className="text-xs text-muted-foreground">
        Values are stored locally in your browser.
      </p>
    </div>
  );
}
