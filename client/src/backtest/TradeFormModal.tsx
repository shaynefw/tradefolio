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
  premiumBalance: string;
  premiumLabel: string;
  speedPnl: string;
  speedBalance: string;
  speedLabel: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  date: new Date().toISOString().slice(0, 10),
  time: "",
  side: "LONG",
  tradeNo: "1",
  validEntry: true,
  outcome: "",
  mae: "",
  mfe: "",
  recoveryStage: "none",
  premiumPnl: "",
  premiumBalance: "",
  premiumLabel: "",
  speedPnl: "",
  speedBalance: "",
  speedLabel: "",
  notes: "",
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
    premiumBalance: t.premium?.balance == null ? "" : String(t.premium.balance),
    premiumLabel: t.premium?.label ?? "",
    speedPnl: t.speed?.pnl == null ? "" : String(t.speed.pnl),
    speedBalance: t.speed?.balance == null ? "" : String(t.speed.balance),
    speedLabel: t.speed?.label ?? "",
    notes: "",
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
    setShowAdvanced(!!editingTrade && (editingTrade.premium != null || editingTrade.speed != null));
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

    const payload = {
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
      premiumBalance: num(form.premiumBalance),
      premiumLabel: str(form.premiumLabel),
      speedPnl: num(form.speedPnl),
      speedBalance: num(form.speedBalance),
      speedLabel: str(form.speedLabel),
      notes: str(form.notes),
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
              <input
                type="text"
                placeholder="9:00:00 AM"
                value={form.time}
                onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
                className={inputClass}
              />
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
                <option value="">— (open)</option>
                <option value="Took Profit">Took Profit</option>
                <option value="Took Loss">Took Loss</option>
              </select>
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
              <div className="mt-3 grid grid-cols-1 gap-3 rounded-md border border-border bg-card/40 p-3 sm:grid-cols-2">
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
                  <Field label="Balance">
                    <input
                      type="number"
                      step="any"
                      value={form.premiumBalance}
                      onChange={(e) => setForm((f) => ({ ...f, premiumBalance: e.target.value }))}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Label">
                    <input
                      type="text"
                      placeholder="e.g. lossA, Art1c"
                      value={form.premiumLabel}
                      onChange={(e) => setForm((f) => ({ ...f, premiumLabel: e.target.value }))}
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
                  <Field label="Balance">
                    <input
                      type="number"
                      step="any"
                      value={form.speedBalance}
                      onChange={(e) => setForm((f) => ({ ...f, speedBalance: e.target.value }))}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Label">
                    <input
                      type="text"
                      value={form.speedLabel}
                      onChange={(e) => setForm((f) => ({ ...f, speedLabel: e.target.value }))}
                      className={inputClass}
                    />
                  </Field>
                </div>
              </div>
            )}
          </div>

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
