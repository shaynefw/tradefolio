import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { trpc } from "../lib/trpc";
import { cn, formatCurrency } from "../lib/utils";
import type {
  BacktestTrade,
  Outcome,
  RecoveryStage,
  ScalingSchedule,
  Side,
} from "./types";
import type { ScalingSeries } from "./calculations";
import { findCurrentLevel, suggestedPnl } from "./scaling";

// ---------------------------------------------------------------------------
// Local form state — mirrors the tradeCreateInput shape but keeps strings for
// optional numeric fields so empty inputs round-trip cleanly.
// ---------------------------------------------------------------------------

interface FormState {
  date: string;     // yyyy-mm-dd
  time: string;
  side: Side;
  tradeNo: string;
  validEntry: boolean;
  outcome: Outcome | "";
  mae: string;
  mfe: string;
  resultPoints: string;
  recoveryStage: RecoveryStage;
  premiumPnl: string;
  premiumLabel: string;
  premiumResetBalance: string;
  speedPnl: string;
  speedLabel: string;
  speedResetBalance: string;
  notes: string;
  // Placeholder mode — the user reserves a row for an upcoming trade.
  // When true, the row renders as a glowing banner in the log and nearly
  // all other fields are ignored until edit.
  isPending: boolean;
  // What to pre-assign when isPending is true.
  //   regular → a plain placeholder (no recovery)
  //   first / second → R1 / R2 recovery placeholder
  pendingStage: "regular" | "first" | "second";
}

// Whole-hour options across 24h, formatted to match the spreadsheet's style
// ("9:00:00 AM"). Free-form times entered before this dropdown still round-trip
// — the select tolerates a non-matching value by falling back to the first
// option visually but the persisted value is preserved on edit.
const HOUR_OPTIONS: string[] = Array.from({ length: 24 }, (_, h) => {
  const period = h >= 12 ? "PM" : "AM";
  const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${display}:00:00 ${period}`;
});

const EMPTY_FORM: FormState = {
  date: new Date().toISOString().slice(0, 10),
  time: "9:00:00 AM",
  side: "LONG",
  tradeNo: "1",
  validEntry: true,
  outcome: "",
  mae: "",
  mfe: "",
  resultPoints: "",
  recoveryStage: "none",
  premiumPnl: "",
  premiumLabel: "",
  premiumResetBalance: "",
  speedPnl: "",
  speedLabel: "",
  speedResetBalance: "",
  notes: "",
  isPending: false,
  pendingStage: "regular",
};

function tradeToForm(t: BacktestTrade): FormState {
  return {
    date: t.date.toISOString().slice(0, 10),
    time: t.time,
    side: t.side,
    tradeNo: String(t.tradeNo),
    validEntry: t.validEntry,
    outcome: t.outcome ?? "",
    mae: t.mae == null ? "" : String(t.mae),
    mfe: t.mfe == null ? "" : String(t.mfe),
    resultPoints: t.resultPoints == null ? "" : String(t.resultPoints),
    recoveryStage: t.recoveryStage,
    premiumPnl: t.premium?.pnl == null ? "" : String(t.premium.pnl),
    premiumLabel: t.premium?.label ?? "",
    premiumResetBalance:
      t.premiumResetBalance == null ? "" : String(t.premiumResetBalance),
    speedPnl: t.speed?.pnl == null ? "" : String(t.speed.pnl),
    speedLabel: t.speed?.label ?? "",
    speedResetBalance:
      t.speedResetBalance == null ? "" : String(t.speedResetBalance),
    notes: t.notes ?? "",
    isPending: t.isPending,
    pendingStage:
      t.recoveryStage === "second"
        ? "second"
        : t.recoveryStage === "first"
        ? "first"
        : "regular",
  };
}

// Coerce an optional number string. Returns null for "" (so blank => clear);
// returns the parsed number otherwise. NaN sneaks through as null because
// the server doesn't accept NaN.
function num(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function str(s: string): string | null {
  const t = s.trim();
  return t === "" ? null : t;
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

interface TradeFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  datasetId: number;
  // When editing, pass the existing trade (must have .id). When adding, omit.
  editingTrade?: BacktestTrade | null;
  // Live scaling series for both schedules — used to show a read-only
  // "current balance" hint above each PnL input so the user can size the
  // trade with their balance in view.
  premiumSeries: ScalingSeries;
  speedSeries: ScalingSeries;
  // Full trade list — used to auto-suggest the trade # for a new trade
  // based on how many trades already sit on the selected date.
  existingTrades: BacktestTrade[];
  // Optional scaling schedules — when present, PnL fields auto-populate
  // from the level whose recommendedBalance ≤ current running balance.
  premiumSchedule: ScalingSchedule | null;
  speedSchedule: ScalingSchedule | null;
  // TP/SL modes — when either is "fluid", show the Result (pts) field so the
  // realized points per trade feed the average TP/SL.
  tpMode?: "fixed" | "fluid";
  slMode?: "fixed" | "fluid";
}

export function TradeFormModal({
  open,
  onOpenChange,
  datasetId,
  editingTrade,
  premiumSeries,
  speedSeries,
  existingTrades,
  premiumSchedule,
  speedSchedule,
  tpMode = "fixed",
  slMode = "fixed",
}: TradeFormModalProps) {
  const showResult = tpMode === "fluid" || slMode === "fluid";
  const isEdit = editingTrade?.id != null;
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // How many trades already sit on the selected date. Pending placeholders
  // are excluded — their tradeNo is 0 and they don't represent real trades
  // yet. Editing an existing trade also excludes itself so the count
  // reflects "other trades on this date".
  const { countOnDate, suggestedTradeNo } = useMemo(() => {
    if (!form.date) return { countOnDate: 0, suggestedTradeNo: 1 };
    const target = new Date(`${form.date}T00:00:00`).getTime();
    let count = 0;
    let max = 0;
    for (const t of existingTrades) {
      if (t.isPending) continue;
      if (isEdit && t.id != null && t.id === editingTrade?.id) continue;
      const midnight = new Date(t.date);
      midnight.setHours(0, 0, 0, 0);
      if (midnight.getTime() !== target) continue;
      count++;
      if (t.tradeNo > max) max = t.tradeNo;
    }
    return { countOnDate: count, suggestedTradeNo: max + 1 };
  }, [existingTrades, form.date, isEdit, editingTrade?.id]);

  // Reset form whenever the modal opens / the editing target changes.
  useEffect(() => {
    if (!open) return;
    setForm(editingTrade ? tradeToForm(editingTrade) : EMPTY_FORM);
    setShowAdvanced(
      !!editingTrade &&
        (editingTrade.premium != null ||
          editingTrade.speed != null ||
          editingTrade.premiumResetBalance != null ||
          editingTrade.speedResetBalance != null),
    );
  }, [open, editingTrade]);

  // When adding, keep the trade # in sync with the "next slot for this
  // date" any time the date changes. Skips edit mode entirely so the
  // user's existing value isn't clobbered.
  useEffect(() => {
    if (!open || isEdit) return;
    setForm((f) => ({ ...f, tradeNo: String(suggestedTradeNo) }));
  }, [open, isEdit, suggestedTradeNo]);

  // Edit mode: a trade # of 0 is invalid (usually a leftover from a pending
  // placeholder that's now being filled in). Bump it to the next slot for
  // the date so the user never has to save a T0.
  useEffect(() => {
    if (!open || !isEdit) return;
    if (form.tradeNo === "0" || form.tradeNo === "") {
      setForm((f) => ({ ...f, tradeNo: String(suggestedTradeNo) }));
    }
  }, [open, isEdit, form.tradeNo, suggestedTradeNo]);

  // Auto-fill PnL from the scaling schedules whenever outcome or recovery
  // stage changes. Skips when there's no schedule set, when the balance is
  // below the first level, or when the level lacks that specific risk
  // (e.g. R2 = n/a on a Speed level). Skips edit mode by default so
  // recorded PnLs aren't clobbered.
  // The balance this trade is sized against: when adding, it's the current
  // end-of-series balance; when editing, it's the balance just BEFORE this
  // trade (so the level reflects where the account stood at entry, matching
  // the "Before this trade" hint). Everything scaling-related — level badge,
  // preview chips, and auto-fill — reads from this so they stay consistent.
  const premiumRefBalance =
    isEdit && editingTrade
      ? premiumSeries.points[editingTrade.index - 1]?.balance ??
        premiumSeries.start
      : premiumSeries.end;
  const speedRefBalance =
    isEdit && editingTrade
      ? speedSeries.points[editingTrade.index - 1]?.balance ??
        speedSeries.start
      : speedSeries.end;

  useEffect(() => {
    if (!open || isEdit) return;
    if (form.isPending) return;
    const outcome = (form.outcome || null) as Outcome | null;
    // For fluid datasets the schedule stores $/point, so pass the trade's
    // realized points (Result field, else MFE win / MAE loss).
    const fluidPts =
      num(form.resultPoints) ??
      (outcome === "Took Profit"
        ? num(form.mfe)
        : outcome === "Took Loss"
          ? num(form.mae)
          : null);
    const premiumSug = suggestedPnl(
      premiumRefBalance,
      premiumSchedule,
      outcome,
      form.recoveryStage,
      showResult,
      fluidPts,
    );
    const speedSug = suggestedPnl(
      speedRefBalance,
      speedSchedule,
      outcome,
      form.recoveryStage,
      showResult,
      fluidPts,
    );
    setForm((f) => ({
      ...f,
      premiumPnl: premiumSug != null ? String(premiumSug) : f.premiumPnl,
      speedPnl: speedSug != null ? String(speedSug) : f.speedPnl,
    }));
  }, [
    open,
    isEdit,
    form.isPending,
    form.outcome,
    form.recoveryStage,
    form.resultPoints,
    form.mfe,
    form.mae,
    showResult,
    premiumRefBalance,
    speedRefBalance,
    premiumSchedule,
    speedSchedule,
  ]);

  // Level for each scaling at this trade's reference balance.
  const premiumLevel = useMemo(
    () => findCurrentLevel(premiumRefBalance, premiumSchedule),
    [premiumRefBalance, premiumSchedule],
  );
  const speedLevel = useMemo(
    () => findCurrentLevel(speedRefBalance, speedSchedule),
    [speedRefBalance, speedSchedule],
  );

  const utils = trpc.useUtils();

  function invalidate() {
    utils.backtest.trade.list.invalidate({ datasetId });
    utils.backtest.dataset.list.invalidate();
  }

  const createMutation = trpc.backtest.trade.create.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success("Trade added");
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message ?? "Failed to add trade"),
  });
  const updateMutation = trpc.backtest.trade.update.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success("Trade saved");
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message ?? "Failed to save trade"),
  });

  const pending = createMutation.isPending || updateMutation.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Required: date, side, tradeNo (anything 0+ allowed).
    if (!form.date) {
      toast.error("Date is required");
      return;
    }

    // Pending-trade placeholder: stash a minimal row with sensible
    // defaults so the user can edit it once the actual trade arrives.
    const payload = form.isPending
      ? {
          date: new Date(`${form.date}T00:00:00`).getTime(),
          time: "",
          side: "LONG" as Side,
          tradeNo: 0,
          validEntry: true,
          outcome: null,
          mae: null,
          mfe: null,
          resultPoints: null,
          recoveryStage: (form.pendingStage === "regular"
            ? "none"
            : form.pendingStage) as RecoveryStage,
          premiumPnl: null,
          premiumBalance: null,
          premiumLabel: null,
          premiumResetBalance: null,
          speedPnl: null,
          speedBalance: null,
          speedLabel: null,
          speedResetBalance: null,
          notes: null,
          isPending: true,
        }
      : {
          // Local midnight on the chosen date — same convention as the parser.
          date: new Date(`${form.date}T00:00:00`).getTime(),
          time: form.time.trim(),
          side: form.side,
          tradeNo: Math.max(1, Number(form.tradeNo) || 1),
          validEntry: form.validEntry,
          outcome: (form.outcome || null) as Outcome | null,
          mae: num(form.mae),
          mfe: num(form.mfe),
          resultPoints: num(form.resultPoints),
          recoveryStage: form.recoveryStage,
          premiumPnl: num(form.premiumPnl),
          premiumBalance: null, // auto-computed from start + Σ pnl
          premiumLabel: str(form.premiumLabel),
          premiumResetBalance: num(form.premiumResetBalance),
          speedPnl: num(form.speedPnl),
          speedBalance: null, // auto-computed
          speedLabel: str(form.speedLabel),
          speedResetBalance: num(form.speedResetBalance),
          notes: str(form.notes),
          isPending: false,
        };

    if (isEdit && editingTrade?.id != null) {
      updateMutation.mutate({ id: editingTrade.id, patch: payload });
    } else {
      createMutation.mutate({ datasetId, trade: payload });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-card max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit trade" : "Add trade"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Modify this trade. Recompute happens automatically on save."
              : "Append a new trade to this dataset."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Pending recovery placeholder toggle — collapses the form when on */}
          <label className="flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
            <input
              type="checkbox"
              checked={form.isPending}
              onChange={(e) =>
                setForm((f) => ({ ...f, isPending: e.target.checked }))
              }
              className="mt-0.5 h-4 w-4 accent-amber-500"
            />
            <div className="flex-1 text-sm">
              <p className="font-medium text-amber-200">
                Mark as pending trade
              </p>
              <p className="text-xs text-amber-200/70">
                Reserves a placeholder row for an upcoming trade — fill in the
                details after it fires.
              </p>
            </div>
          </label>

          {form.isPending ? (
            <Field label="Pending type">
              <select
                value={form.pendingStage}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    pendingStage: e.target.value as "regular" | "first" | "second",
                  }))
                }
                className={inputClass}
              >
                <option value="regular">Regular trade</option>
                <option value="first">Recovery (R1)</option>
                <option value="second">Recovery 2 (R2)</option>
              </select>
            </Field>
          ) : (
          <>
          {/* Row 1: Date / Time / Side / Trade# */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Date">
              <input
                type="date"
                required
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="Time">
              <select
                value={form.time}
                onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
                className={inputClass}
              >
                {/* When editing a row whose time isn't on the hour, surface it
                    as the first option so the existing value isn't silently
                    replaced. */}
                {form.time && !HOUR_OPTIONS.includes(form.time) && (
                  <option value={form.time}>{form.time}</option>
                )}
                {HOUR_OPTIONS.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Side">
              <select
                value={form.side}
                onChange={(e) => setForm((f) => ({ ...f, side: e.target.value as Side }))}
                className={inputClass}
              >
                <option value="LONG">LONG</option>
                <option value="SHORT">SHORT</option>
              </select>
            </Field>
            <Field label="Trade #">
              <input
                type="number"
                min={1}
                value={form.tradeNo}
                onChange={(e) => setForm((f) => ({ ...f, tradeNo: e.target.value }))}
                className={inputClass}
              />
              <span className="text-[10px] text-muted-foreground">
                {countOnDate === 0
                  ? "First trade on this date"
                  : `${countOnDate} trade${countOnDate === 1 ? "" : "s"} already on this date`}
              </span>
            </Field>
          </div>

          {/* Row 2: Valid / Outcome / Recovery */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Outcome">
              <select
                value={form.outcome}
                onChange={(e) => setForm((f) => ({ ...f, outcome: e.target.value as FormState["outcome"] }))}
                className={inputClass}
              >
                <option value="">— (open / live)</option>
                <option value="Took Profit">Took Profit</option>
                <option value="Took Loss">Took Loss</option>
                <option value="Breakeven">Breakeven</option>
              </select>
              <span className="text-[10px] text-muted-foreground">
                Leave open to mark as live — fill in MAE/MFE/outcome after the trade closes.
              </span>
            </Field>
            <Field label="Recovery">
              <select
                value={form.recoveryStage}
                onChange={(e) =>
                  setForm((f) => ({ ...f, recoveryStage: e.target.value as RecoveryStage }))
                }
                className={inputClass}
              >
                <option value="none">None</option>
                <option value="first">First (R1)</option>
                <option value="second">Second (R2)</option>
              </select>
            </Field>
            <Field label="Valid entry">
              <label className="flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm">
                <input
                  type="checkbox"
                  checked={form.validEntry}
                  onChange={(e) => setForm((f) => ({ ...f, validEntry: e.target.checked }))}
                  className="h-4 w-4 accent-primary"
                />
                <span>{form.validEntry ? "Yes" : "No"}</span>
              </label>
            </Field>
          </div>

          {/* Row 3: MAE / MFE */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="MAE (points)">
              <input
                type="number"
                step="any"
                placeholder="blank = unrecorded"
                value={form.mae}
                onChange={(e) => setForm((f) => ({ ...f, mae: e.target.value }))}
                className={inputClass}
              />
            </Field>
            <Field label="MFE (points)">
              <input
                type="number"
                step="any"
                placeholder="blank = unrecorded"
                value={form.mfe}
                onChange={(e) => setForm((f) => ({ ...f, mfe: e.target.value }))}
                className={inputClass}
              />
            </Field>
          </div>

          {/* Result (pts) — only for fluid TP/SL datasets. Blank falls back to
              MFE (win) / MAE (loss) in the stats, so the placeholder shows that
              auto value; type to override. */}
          {showResult && (() => {
            const autoSrc =
              form.outcome === "Took Profit"
                ? form.mfe
                : form.outcome === "Took Loss"
                  ? form.mae
                  : "";
            const autoLabel =
              form.outcome === "Took Profit"
                ? "MFE"
                : form.outcome === "Took Loss"
                  ? "MAE"
                  : "";
            return (
              <Field label="Result (points captured / lost at exit)">
                <input
                  type="number"
                  step="any"
                  placeholder={
                    autoSrc !== ""
                      ? `auto: ${autoSrc} (${autoLabel})`
                      : "points at exit"
                  }
                  value={form.resultPoints}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, resultPoints: e.target.value }))
                  }
                  className={inputClass}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Feeds the fluid TP/SL average. Blank uses{" "}
                  {autoLabel ? `this trade's ${autoLabel}` : "MFE (win) / MAE (loss)"}.
                </p>
              </Field>
            );
          })()}

          {/* Notes */}
          <Field label="Notes">
            <textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className={`${inputClass} min-h-[60px] py-2`}
              placeholder="Anything worth remembering about this trade"
            />
          </Field>

          {/* Advanced: Scaling */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
            >
              {showAdvanced ? "Hide" : "Show"} scaling fields (Premium / Speed)
            </button>
            {showAdvanced && (
              <div className="mt-3 space-y-3 rounded-md border border-border bg-card/40 p-3">
                <p className="text-xs text-muted-foreground">
                  Balance is computed automatically from the dataset's starting
                  balance plus the sum of all trade PnLs. Use{" "}
                  <span className="font-medium text-foreground">
                    Reset balance
                  </span>{" "}
                  to declare a new starting point after this trade — typically
                  after the account blew.
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <div className="flex items-baseline justify-between">
                      <p className="text-xs uppercase tracking-wider text-muted-foreground">
                        Premium
                        {premiumLevel && (
                          <span className="ml-1.5 rounded bg-emerald-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase text-emerald-300">
                            {premiumLevel.name}
                          </span>
                        )}
                      </p>
                      <CurrentBalanceHint
                        series={premiumSeries}
                        editingIndex={editingTrade?.index ?? null}
                      />
                    </div>
                    <Field label="PnL">
                      <input
                        type="number"
                        step="any"
                        value={form.premiumPnl}
                        onChange={(e) => setForm((f) => ({ ...f, premiumPnl: e.target.value }))}
                        className={inputClass}
                      />
                    </Field>
                    <LevelPreview
                      level={premiumLevel}
                      fluid={showResult}
                      onPick={(v) => setForm((f) => ({ ...f, premiumPnl: String(v) }))}
                    />
                    <Field label="Reset balance to">
                      <input
                        type="number"
                        step="any"
                        placeholder="blank = no reset"
                        value={form.premiumResetBalance}
                        onChange={(e) => setForm((f) => ({ ...f, premiumResetBalance: e.target.value }))}
                        className={inputClass}
                      />
                    </Field>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-baseline justify-between">
                      <p className="text-xs uppercase tracking-wider text-muted-foreground">
                        Speed
                        {speedLevel && (
                          <span className="ml-1.5 rounded bg-sky-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase text-sky-300">
                            {speedLevel.name}
                          </span>
                        )}
                      </p>
                      <CurrentBalanceHint
                        series={speedSeries}
                        editingIndex={editingTrade?.index ?? null}
                      />
                    </div>
                    <Field label="PnL">
                      <input
                        type="number"
                        step="any"
                        value={form.speedPnl}
                        onChange={(e) => setForm((f) => ({ ...f, speedPnl: e.target.value }))}
                        className={inputClass}
                      />
                    </Field>
                    <LevelPreview
                      level={speedLevel}
                      fluid={showResult}
                      onPick={(v) => setForm((f) => ({ ...f, speedPnl: String(v) }))}
                    />
                    <Field label="Reset balance to">
                      <input
                        type="number"
                        step="any"
                        placeholder="blank = no reset"
                        value={form.speedResetBalance}
                        onChange={(e) => setForm((f) => ({ ...f, speedResetBalance: e.target.value }))}
                        className={inputClass}
                      />
                    </Field>
                  </div>
                </div>
              </div>
            )}
          </div>
          </>
          )}

          <DialogFooter className="gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending} className="gap-1.5">
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isEdit ? "Save changes" : "Add trade"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Field shell — small reusable label/input wrapper.
// ---------------------------------------------------------------------------

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputClass =
  "h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-ring";

// Reference chips for the current scaling level — profit and each risk tier.
// Clicking one fills the PnL input, so the user can size a trade even when
// auto-fill didn't fire (e.g. editing a pending trade).
function LevelPreview({
  level,
  onPick,
  fluid = false,
}: {
  level: import("./types").ScalingLevel | null;
  onPick: (value: number) => void;
  fluid?: boolean;
}) {
  if (!level) return null;
  // Fluid schedules hold $/point, not fixed profit/risk — show those instead.
  if (fluid) {
    const dpps: Array<{ label: string; value: number | null | undefined }> = [
      { label: "$/pt", value: level.dollarsPerPoint },
      { label: "R1 $/pt", value: level.recovery1DollarsPerPoint },
      { label: "R2 $/pt", value: level.recovery2DollarsPerPoint },
    ].filter((c) => c.value != null);
    return (
      <div className="flex flex-wrap items-center gap-1 pt-0.5">
        <span className="text-[10px] text-muted-foreground">{level.name}:</span>
        {dpps.map((c) => (
          <span
            key={c.label}
            className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-cyan-300"
          >
            {c.label} {formatCurrency(c.value as number)}
          </span>
        ))}
        {dpps.length === 0 && (
          <span className="text-[10px] text-muted-foreground">
            set $/point in Dataset settings
          </span>
        )}
      </div>
    );
  }
  const chips: Array<{ label: string; value: number }> = [
    { label: "Profit", value: level.profitPerTrade },
    { label: "Loss", value: -level.initialRisk },
    { label: "R1 Loss", value: -level.recovery1Risk },
  ];
  if (level.recovery2Risk != null) {
    chips.push({ label: "R2 Loss", value: -level.recovery2Risk });
  }
  if (level.recovery1Profit != null) {
    chips.push({ label: "R1 Profit", value: level.recovery1Profit });
  }
  if (level.recovery2Profit != null) {
    chips.push({ label: "R2 Profit", value: level.recovery2Profit });
  }
  return (
    <div className="flex flex-wrap items-center gap-1 pt-0.5">
      <span className="text-[10px] text-muted-foreground">
        {level.name}:
      </span>
      {chips.map((c) => (
        <button
          key={c.label}
          type="button"
          onClick={() => onPick(c.value)}
          title={`Use ${formatCurrency(c.value)} (${c.label})`}
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums transition-colors hover:brightness-125",
            c.value >= 0
              ? "bg-emerald-500/15 text-emerald-300"
              : "bg-red-500/15 text-red-300",
          )}
        >
          {c.label} {formatCurrency(c.value)}
        </button>
      ))}
    </div>
  );
}

// Tiny read-only badge that shows the running balance the user is "starting
// from" for this trade. When adding, that's the series' current end balance.
// When editing, it's the balance just before this trade was applied (so the
// user can size relative to what they had on entry).
function CurrentBalanceHint({
  series,
  editingIndex,
}: {
  series: ScalingSeries;
  editingIndex: number | null;
}) {
  if (!series.tracked) {
    return (
      <span className="text-[10px] text-muted-foreground">not tracked</span>
    );
  }
  const balance =
    editingIndex == null
      ? series.end
      : series.points[editingIndex - 1]?.balance ?? series.start;
  return (
    <span className="text-[10px] text-muted-foreground">
      {editingIndex == null ? "Current: " : "Before this trade: "}
      <span className="font-medium text-foreground">
        {formatCurrency(balance)}
      </span>
    </span>
  );
}
