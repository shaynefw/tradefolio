import { useEffect, useState } from "react";
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
import type { BacktestTrade, Outcome, RecoveryStage, Side } from "./types";

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
  recoveryStage: RecoveryStage;
  premiumPnl: string;
  premiumLabel: string;
  premiumResetBalance: string;
  speedPnl: string;
  speedLabel: string;
  speedResetBalance: string;
  notes: string;
  // Placeholder mode — the user reserves a row for an upcoming recovery
  // trade. When true, the row renders as a glowing "Pending Recovery"
  // banner in the log and nearly all other fields are ignored until edit.
  isPending: boolean;
  // Recovery stage to pre-assign when isPending is true. Defaults to first.
  pendingStage: "first" | "second";
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
  recoveryStage: "none",
  premiumPnl: "",
  premiumLabel: "",
  premiumResetBalance: "",
  speedPnl: "",
  speedLabel: "",
  speedResetBalance: "",
  notes: "",
  isPending: false,
  pendingStage: "first",
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
    recoveryStage: t.recoveryStage,
    premiumPnl: t.premium?.pnl == null ? "" : String(t.premium.pnl),
    premiumLabel: t.premium?.label ?? "",
    premiumResetBalance:
      t.premiumResetBalance == null ? "" : String(t.premiumResetBalance),
    speedPnl: t.speed?.pnl == null ? "" : String(t.speed.pnl),
    speedLabel: t.speed?.label ?? "",
    speedResetBalance:
      t.speedResetBalance == null ? "" : String(t.speedResetBalance),
    notes: "",
    isPending: t.isPending,
    pendingStage: t.recoveryStage === "second" ? "second" : "first",
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
}

export function TradeFormModal({
  open,
  onOpenChange,
  datasetId,
  editingTrade,
}: TradeFormModalProps) {
  const isEdit = editingTrade?.id != null;
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [showAdvanced, setShowAdvanced] = useState(false);

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

    // Pending-recovery placeholder: stash a minimal row with sensible
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
          recoveryStage: form.pendingStage,
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
          tradeNo: Number(form.tradeNo) || 0,
          validEntry: form.validEntry,
          outcome: (form.outcome || null) as Outcome | null,
          mae: num(form.mae),
          mfe: num(form.mfe),
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
                Mark as pending recovery
              </p>
              <p className="text-xs text-amber-200/70">
                Reserves a placeholder row for an upcoming recovery trade — fill
                in the details after it fires.
              </p>
            </div>
          </label>

          {form.isPending ? (
            <Field label="Pending stage">
              <select
                value={form.pendingStage}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    pendingStage: e.target.value as "first" | "second",
                  }))
                }
                className={inputClass}
              >
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
                min={0}
                value={form.tradeNo}
                onChange={(e) => setForm((f) => ({ ...f, tradeNo: e.target.value }))}
                className={inputClass}
              />
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
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">
                      Premium
                    </p>
                    <Field label="PnL">
                      <input
                        type="number"
                        step="any"
                        value={form.premiumPnl}
                        onChange={(e) => setForm((f) => ({ ...f, premiumPnl: e.target.value }))}
                        className={inputClass}
                      />
                    </Field>
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
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">
                      Speed
                    </p>
                    <Field label="PnL">
                      <input
                        type="number"
                        step="any"
                        value={form.speedPnl}
                        onChange={(e) => setForm((f) => ({ ...f, speedPnl: e.target.value }))}
                        className={inputClass}
                      />
                    </Field>
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
