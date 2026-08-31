import { useEffect, useMemo, useState } from "react";
import { Info, Lock, LockOpen, Trophy, ShieldAlert } from "lucide-react";

import { Card, CardContent } from "../components/ui/card";
import { cn } from "../lib/utils";

// ---------------------------------------------------------------------------
// DRAM Payout Tracker
// A live cockpit for a trailing-drawdown prop account run with the DRAM
// (Drawdown-Reset Acceleration Method) ladder: scale contracts up only as the
// account banks real profit, reset down on drawdown, and preserve the buffer.
//
// Pre-configured for a Lucid 150k Flex funded account + the iRenkoRFv2 ladder,
// but every input is editable so it works for any account / strategy.
//
// Two-phase model:
//   Phase A — climb to the LOCK. The trailing floor trails your peak EOD
//     balance by the drawdown amount and locks permanently at (start + $100)
//     once peak EOD reaches start + DD + $100. Until then the buffer is at risk.
//   Phase B — after the lock the floor is static; harvest payouts (Lucid Flex:
//     net positive + N qualifying green days, withdraw profit above start, 90%).
// ---------------------------------------------------------------------------

const STORAGE_KEY = "tf.payoutTracker.v1";

interface Stage {
  through: string; // scale this size until banked profit reaches this $ amount
  contracts: string;
}

interface State {
  start: string;
  drawdown: string; // trailing drawdown amount ($)
  lockBuffer: string; // floor locks at start + this ($100 for Lucid)
  current: string; // current balance
  peak: string; // peak end-of-day balance (drives the trailing floor)
  // strategy per-lot economics
  preset: "iRenkoRFv2" | "Renko20MS" | "custom";
  tpPoints: string;
  slPoints: string;
  perPoint: string;
  // risk controls
  dailyStop: string; // self-imposed max daily loss ($)
  todayPnl: string; // today's realized P&L so far ($)
  resetDrop: string; // step down a stage after this $ drawdown from a stage high
  // payout
  greenDays: string;
  greenNeeded: string;
  // ladder
  ladder: Stage[];
}

const PRESETS: Record<"iRenkoRFv2" | "Renko20MS", { tp: string; sl: string }> = {
  iRenkoRFv2: { tp: "40", sl: "160" },
  Renko20MS: { tp: "20", sl: "100" },
};

const DEFAULTS: State = {
  start: "150000",
  drawdown: "4500",
  lockBuffer: "100",
  current: "150000",
  peak: "150000",
  preset: "iRenkoRFv2",
  tpPoints: "40",
  slPoints: "160",
  perPoint: "2",
  dailyStop: "1300",
  todayPnl: "0",
  resetDrop: "640",
  greenDays: "0",
  greenNeeded: "5",
  ladder: [
    { through: "1600", contracts: "2" },
    { through: "4600", contracts: "3" },
  ],
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
const money = (n: number, dp = 0) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });

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

function Panel({
  title,
  blurb,
  children,
  icon,
}: {
  title: string;
  blurb?: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <Card className="bg-card/60">
      <CardContent className="pt-5 pb-5 space-y-4">
        <div className="flex items-start gap-2">
          {icon}
          <div>
            <h3 className="text-sm font-semibold">{title}</h3>
            {blurb && (
              <p className="mt-0.5 text-xs text-muted-foreground">{blurb}</p>
            )}
          </div>
        </div>
        {children}
      </CardContent>
    </Card>
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
  tone?: "good" | "bad" | "warn" | "plain";
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
          tone === "warn" && "text-amber-400",
        )}
      >
        {children}
      </span>
    </div>
  );
}

export default function PayoutTracker() {
  const [s, setS] = useState<State>(load);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
      /* ignore */
    }
  }, [s]);
  const set = (p: Partial<State>) => setS((v) => ({ ...v, ...p }));

  const applyPreset = (p: "iRenkoRFv2" | "Renko20MS" | "custom") => {
    if (p === "custom") {
      set({ preset: p });
      return;
    }
    set({ preset: p, tpPoints: PRESETS[p].tp, slPoints: PRESETS[p].sl });
  };

  const m = useMemo(() => {
    const start = num(s.start);
    const dd = num(s.drawdown);
    const lockBuf = num(s.lockBuffer);
    const current = num(s.current);
    const peak = Math.max(num(s.peak), current);
    const perPt = num(s.perPoint);

    const winPerLot = num(s.tpPoints) * perPt;
    const lossPerLot = num(s.slPoints) * perPt;

    // trailing floor: trails peak EOD by DD, but never rises above start+lockBuffer
    const lockFloor = start + lockBuf;
    const trailedFloor = peak - dd;
    const floor = Math.min(trailedFloor, lockFloor);
    const locked = trailedFloor >= lockFloor;
    const lockBalance = start + dd + lockBuf; // peak EOD needed to lock
    const toLock = Math.max(0, lockBalance - peak);
    const lockPct = Math.min(100, (peak - start) / (dd + lockBuf) * 100);

    const banked = current - start;
    const roomToFloor = current - floor;

    // current DRAM stage from banked profit
    const rungs = s.ladder
      .map((r) => ({ through: num(r.through), contracts: num(r.contracts) }))
      .filter((r) => r.through > 0)
      .sort((a, b) => a.through - b.through);
    let stageIdx = rungs.findIndex((r) => banked < r.through);
    if (stageIdx === -1) stageIdx = rungs.length - 1;
    const stage = rungs[stageIdx];
    const contracts = stage ? stage.contracts : 0;
    const nextTrigger = stage ? stage.through : 0;
    const toNextStage = Math.max(0, nextTrigger - banked);

    // daily stop
    const dailyStop = num(s.dailyStop);
    const todayPnl = num(s.todayPnl);
    const dailyLossUsed = Math.max(0, -todayPnl);
    const dailyRemaining = Math.max(0, dailyStop - dailyLossUsed);
    const dailyLossesLeft = lossPerLot * contracts > 0
      ? Math.floor(dailyRemaining / (lossPerLot * contracts))
      : 0;

    // worst-case streak at this size vs room
    const streakToFloor = lossPerLot * contracts > 0
      ? Math.floor(roomToFloor / (lossPerLot * contracts))
      : 0;

    // payout (Lucid Flex: no buffer -> profit above start is withdrawable)
    const greenDays = num(s.greenDays);
    const greenNeeded = num(s.greenNeeded);
    const withdrawable = Math.max(0, current - Math.max(start, floor));
    const daysReady = greenDays >= greenNeeded;
    const payoutReady = daysReady && banked > 0 && withdrawable >= 500;
    const keep = withdrawable * 0.9;

    return {
      start, current, peak, banked, floor, locked, lockBalance, toLock, lockPct,
      roomToFloor, winPerLot, lossPerLot, contracts, nextTrigger, toNextStage,
      stageIdx, rungs, dailyRemaining, dailyLossesLeft, streakToFloor,
      greenDays, greenNeeded, withdrawable, daysReady, payoutReady, keep,
    };
  }, [s]);

  const setRung = (i: number, p: Partial<Stage>) => {
    const ladder = s.ladder.map((r, idx) => (idx === i ? { ...r, ...p } : r));
    set({ ladder });
  };
  const addRung = () => set({ ladder: [...s.ladder, { through: "", contracts: "" }] });
  const removeRung = (i: number) =>
    set({ ladder: s.ladder.filter((_, idx) => idx !== i) });

  const phase = m.locked ? "B" : "A";

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Live cockpit for a trailing-drawdown prop account run on the DRAM ladder.
        Phase A: climb to the lock. Phase B: harvest payouts. Update the balance
        and today's P&amp;L as you trade — everything recalculates.
      </p>

      {/* HERO — current directive */}
      <Card
        className={cn(
          "border-2",
          m.roomToFloor <= m.lossPerLot * m.contracts
            ? "border-red-500/50 bg-red-500/5"
            : phase === "B"
              ? "border-green-500/40 bg-green-500/5"
              : "border-primary/40 bg-primary/5",
        )}
      >
        <CardContent className="pt-5 pb-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Trade this size now
              </p>
              <p className="mt-1 text-4xl font-bold tabular-nums">
                {m.contracts} <span className="text-lg font-medium text-muted-foreground">MNQ</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                win {money(m.winPerLot * m.contracts)} · loss {money(m.lossPerLot * m.contracts)} per trade
              </p>
            </div>
            <div className="text-right">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
                  phase === "B"
                    ? "bg-green-500/15 text-green-300"
                    : "bg-primary/15 text-primary",
                )}
              >
                {phase === "B" ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
                Phase {phase} — {phase === "B" ? "harvest payouts" : "climb to lock"}
              </span>
              <p className="mt-2 text-sm text-muted-foreground">
                Banked{" "}
                <span className={cn("font-semibold tabular-nums", m.banked >= 0 ? "text-green-400" : "text-red-400")}>
                  {m.banked >= 0 ? "+" : "−"}{money(Math.abs(m.banked))}
                </span>
              </p>
            </div>
          </div>

          {/* progress to lock */}
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span>Progress to floor lock</span>
              <span className="tabular-nums">
                {m.locked ? "LOCKED ✓" : `${money(m.toLock)} to lock (peak ${money(m.lockBalance)})`}
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-background/60">
              <div
                className={cn("h-full rounded-full", m.locked ? "bg-green-500" : "bg-primary")}
                style={{ width: `${Math.max(2, m.lockPct)}%` }}
              />
            </div>
            {!m.locked && m.toNextStage > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Next step-up at{" "}
                <span className="font-medium text-foreground">+{money(m.nextTrigger)}</span> banked
                {" "}({money(m.toNextStage)} to go)
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Safety row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Panel
          title="Drawdown safety"
          icon={<ShieldAlert className="h-4 w-4 text-amber-400 mt-0.5" />}
          blurb="How much room to the floor, and how many losses that is at your size."
        >
          <div className="space-y-2">
            <Out label="Trailing floor" tone="plain">{money(m.floor)}</Out>
            <Out
              label="Room to floor"
              big
              tone={m.roomToFloor <= m.lossPerLot * m.contracts ? "bad" : m.roomToFloor < m.lossPerLot * m.contracts * 3 ? "warn" : "good"}
            >
              {money(m.roomToFloor)}
            </Out>
            <Out
              label="Losses to breach (at current size)"
              tone={m.streakToFloor <= 1 ? "bad" : m.streakToFloor <= 3 ? "warn" : "good"}
            >
              {m.streakToFloor}
            </Out>
            <Out label="Status" tone={m.locked ? "good" : "warn"}>
              {m.locked ? "Floor locked — safe above it" : "Floor still trailing"}
            </Out>
          </div>
        </Panel>

        <Panel
          title="Today's daily stop"
          blurb="Self-imposed circuit breaker (Flex has no built-in DLL). Stop when hit."
        >
          <div className="grid grid-cols-2 gap-4">
            <Field label="Daily stop ($)" value={s.dailyStop} onChange={(v) => set({ dailyStop: v })} />
            <Field label="Today P&L ($)" value={s.todayPnl} onChange={(v) => set({ todayPnl: v })} />
          </div>
          <div className="space-y-2 border-t border-border/40 pt-3">
            <Out
              label="Loss budget left today"
              big
              tone={m.dailyRemaining <= 0 ? "bad" : m.dailyRemaining < m.lossPerLot * m.contracts ? "warn" : "good"}
            >
              {money(m.dailyRemaining)}
            </Out>
            <Out label="More losses allowed today" tone={m.dailyLossesLeft <= 0 ? "bad" : "plain"}>
              {m.dailyLossesLeft}
            </Out>
            {m.dailyRemaining <= 0 && (
              <p className="text-xs text-red-300/80">Daily stop hit — done for the day.</p>
            )}
          </div>
        </Panel>

        <Panel
          title="Payout readiness"
          icon={<Trophy className="h-4 w-4 text-green-400 mt-0.5" />}
          blurb="Lucid Flex: net positive + qualifying green days, then withdraw."
        >
          <div className="grid grid-cols-2 gap-4">
            <Field label="Green days" value={s.greenDays} onChange={(v) => set({ greenDays: v })} />
            <Field label="Days needed" value={s.greenNeeded} onChange={(v) => set({ greenNeeded: v })} />
          </div>
          <div className="space-y-2 border-t border-border/40 pt-3">
            <Out label="Green days" tone={m.daysReady ? "good" : "warn"}>
              {m.greenDays} / {m.greenNeeded}
            </Out>
            <Out label="Withdrawable (above floor/start)" tone="plain">
              {money(m.withdrawable)}
            </Out>
            <Out label="You keep (90%)" big tone="good">
              {money(m.keep)}
            </Out>
            <Out label="Payout ready?" tone={m.payoutReady ? "good" : "warn"}>
              {m.payoutReady ? "YES — request it" : "not yet"}
            </Out>
          </div>
        </Panel>
      </div>

      {/* Account + strategy inputs */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Account" blurb="Balances and the trailing-drawdown rule.">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Starting balance" value={s.start} onChange={(v) => set({ start: v })} />
            <Field label="Trailing drawdown" value={s.drawdown} onChange={(v) => set({ drawdown: v })} />
            <Field label="Current balance" value={s.current} onChange={(v) => set({ current: v })} />
            <Field
              label="Peak EOD balance"
              value={s.peak}
              onChange={(v) => set({ peak: v })}
              hint="drives the trailing floor"
            />
            <Field
              label="Floor locks at start +"
              value={s.lockBuffer}
              onChange={(v) => set({ lockBuffer: v })}
              hint="Lucid = $100"
            />
          </div>
          <div className="rounded-md border border-border/60 bg-background/40 p-2.5 text-xs text-muted-foreground">
            Floor = min(peak − drawdown, start + {money(num(s.lockBuffer))}). It
            locks permanently once peak EOD reaches{" "}
            <span className="font-medium text-foreground">{money(m.lockBalance)}</span>.
          </div>
        </Panel>

        <Panel title="Strategy economics" blurb="Per-lot win/loss that drive the math.">
          <div className="inline-flex overflow-hidden rounded-md border border-border">
            {(["iRenkoRFv2", "Renko20MS", "custom"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => applyPreset(p)}
                className={cn(
                  "px-3 py-1 text-xs font-medium transition-colors",
                  s.preset === p
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="TP points" value={s.tpPoints} onChange={(v) => set({ tpPoints: v, preset: "custom" })} />
            <Field label="SL points" value={s.slPoints} onChange={(v) => set({ slPoints: v, preset: "custom" })} />
            <Field label="$ per point" value={s.perPoint} onChange={(v) => set({ perPoint: v })} hint="MNQ = 2" />
          </div>
          <div className="grid grid-cols-2 gap-4 border-t border-border/40 pt-3">
            <Out label="Win / lot" tone="good">{money(m.winPerLot)}</Out>
            <Out label="Loss / lot" tone="bad">{money(m.lossPerLot)}</Out>
          </div>
          <Field
            label="Reset: step down after drawdown of ($)"
            value={s.resetDrop}
            onChange={(v) => set({ resetDrop: v })}
            hint="drop a stage if you give back this much from a stage high"
          />
        </Panel>
      </div>

      {/* DRAM ladder */}
      <Panel title="DRAM ladder" blurb="Scale contracts up only as banked profit crosses each trigger. Current stage highlighted.">
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[34rem] text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Stage</th>
                <th className="px-3 py-2 text-left">Trade size until banked reaches</th>
                <th className="px-3 py-2 text-left">Contracts</th>
                <th className="px-3 py-2 text-right">Loss / trade</th>
                <th className="px-3 py-2 text-right">Losses to floor</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {s.ladder.map((r, i) => {
                const c = num(r.contracts);
                const active = i === m.stageIdx && !m.locked;
                const lossPer = m.lossPerLot * c;
                const lossesToFloor = lossPer > 0 ? Math.floor(m.roomToFloor / lossPer) : 0;
                return (
                  <tr
                    key={i}
                    className={cn(
                      "border-t border-border/40",
                      active && "bg-primary/10",
                    )}
                  >
                    <td className="px-3 py-2 font-medium">
                      {active && <span className="mr-1 text-primary">▶</span>}
                      {i + 1}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <span className="text-muted-foreground">+$</span>
                        <input
                          inputMode="decimal"
                          value={r.through}
                          onChange={(e) => setRung(i, { through: e.target.value })}
                          className={cn(inputClass, "h-8 w-28")}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        inputMode="decimal"
                        value={r.contracts}
                        onChange={(e) => setRung(i, { contracts: e.target.value })}
                        className={cn(inputClass, "h-8 w-20")}
                      />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-red-400">
                      {money(lossPer)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {lossesToFloor}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => removeRung(i)}
                        className="text-xs text-muted-foreground hover:text-red-400"
                      >
                        remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          onClick={addRung}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          + Add stage
        </button>
      </Panel>

      <p className="flex gap-2 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>
          Not financial advice — a planning tool. Past performance doesn't
          guarantee future results. Never add size during a drawdown; respect the
          daily stop; keep DRAM pointed at a positive-edge strategy. Values are
          stored locally in your browser.
        </span>
      </p>
    </div>
  );
}
