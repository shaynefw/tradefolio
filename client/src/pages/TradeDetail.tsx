import { useState, useEffect } from "react"
import { useParams, useLocation, Link } from "wouter"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import {
  ArrowLeft,
  Loader2,
  Save,
  Trash2,
} from "lucide-react"
import DashboardLayout from "../components/DashboardLayout"
import { trpc } from "../lib/trpc"
import { cn, formatCurrency, formatDate, pnlColor, pnlBg } from "../lib/utils"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { Label } from "../components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Badge } from "../components/ui/badge"
import { Separator } from "../components/ui/separator"
import { Textarea } from "../components/ui/textarea"
import { Checkbox } from "../components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../components/ui/alert-dialog"

function tsToDatetimeLocal(ts: number | null | undefined): string {
  if (!ts) return ""
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function datetimeLocalToTs(s: string): number | undefined {
  if (!s) return undefined
  return new Date(s).getTime()
}

const tradeSchema = z.object({
  symbol: z.string().min(1, "Symbol is required"),
  side: z.enum(["long", "short"]),
  status: z.enum(["open", "closed"]),
  quantity: z.coerce.number().positive("Quantity must be positive"),
  entryPrice: z.coerce.number().positive("Entry price must be positive"),
  exitPrice: z.coerce.number().optional().nullable(),
  entryDate: z.string().min(1, "Entry date is required"),
  exitDate: z.string().optional(),
  pnl: z.coerce.number().optional().nullable(),
  fees: z.coerce.number().min(0).optional().nullable(),
  accountId: z.string().optional(),
  strategyId: z.string().optional(),
  notes: z.string().max(1000).optional(),
})

type TradeFormValues = z.infer<typeof tradeSchema>

export default function TradeDetail() {
  const params = useParams<{ id: string }>()
  const tradeId = Number(params.id)
  const [, navigate] = useLocation()
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([])

  const { data: trade, isLoading } = trpc.trade.get.useQuery({ id: tradeId })
  const { data: accounts = [] } = trpc.account.list.useQuery()
  const { data: strategies = [] } = trpc.strategy.list.useQuery()
  const { data: tags = [] } = trpc.tag.list.useQuery()

  const utils = trpc.useUtils()

  const updateMutation = trpc.trade.update.useMutation({
    onSuccess: () => {
      toast.success("Trade updated")
      utils.trade.get.invalidate({ id: tradeId })
      utils.trade.list.invalidate()
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  const deleteMutation = trpc.trade.delete.useMutation({
    onSuccess: () => {
      toast.success("Trade deleted")
      navigate("/trades")
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  const form = useForm<TradeFormValues>({
    resolver: zodResolver(tradeSchema),
    defaultValues: {
      symbol: "",
      side: "long",
      status: "open",
      quantity: 0,
      entryPrice: 0,
      exitPrice: null,
      entryDate: "",
      exitDate: "",
      pnl: null,
      fees: null,
      accountId: "",
      strategyId: "",
      notes: "",
    },
  })

  const watchedPnl = form.watch("pnl")
  const watchedFees = form.watch("fees")
  const netPnl =
    watchedPnl != null && watchedFees != null
      ? watchedPnl - watchedFees
      : watchedPnl ?? null
  const notesValue = form.watch("notes") ?? ""

  useEffect(() => {
    if (trade) {
      form.reset({
        symbol: trade.symbol ?? "",
        side: (trade.side as "long" | "short") ?? "long",
        status: (trade.status as "open" | "closed") ?? "open",
        quantity: trade.quantity ?? 0,
        entryPrice: trade.entryPrice ?? 0,
        exitPrice: trade.exitPrice ?? null,
        entryDate: tsToDatetimeLocal(trade.entryDate),
        exitDate: tsToDatetimeLocal(trade.exitDate),
        pnl: trade.pnl ?? null,
        fees: trade.fees ?? null,
        accountId: trade.accountId ? String(trade.accountId) : "",
        strategyId: trade.strategyId ? String(trade.strategyId) : "",
        notes: trade.notes ?? "",
      })
      setSelectedTagIds((trade.tags ?? []).map((t: { id: number }) => t.id))
    }
  }, [trade])

  function onSubmit(values: TradeFormValues) {
    updateMutation.mutate({
      id: tradeId,
      symbol: values.symbol,
      side: values.side,
      status: values.status,
      quantity: values.quantity,
      entryPrice: values.entryPrice,
      exitPrice: values.exitPrice ?? undefined,
      entryDate: datetimeLocalToTs(values.entryDate),
      exitDate: datetimeLocalToTs(values.exitDate ?? "") ?? undefined,
      pnl: values.pnl ?? undefined,
      fees: values.fees ?? undefined,
      accountId: values.accountId ? Number(values.accountId) : undefined,
      strategyId: values.strategyId ? Number(values.strategyId) : undefined,
      notes: values.notes ?? undefined,
      tagIds: selectedTagIds,
    })
  }

  function toggleTag(tagId: number) {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    )
  }

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    )
  }

  if (!trade) {
    return (
      <DashboardLayout>
        <div className="flex h-64 flex-col items-center justify-center gap-4">
          <p className="text-muted-foreground text-lg">Trade not found</p>
          <Link href="/trades">
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Trade Log
            </Button>
          </Link>
        </div>
      </DashboardLayout>
    )
  }

  const displayNetPnl = trade.pnl != null && trade.fees != null
    ? trade.pnl - trade.fees
    : trade.pnl ?? null

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <Link href="/trades">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Trade Log
            </Button>
          </Link>
          <div className="flex gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={deleteMutation.isPending}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Trade
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Trade?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete this trade. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteMutation.mutate({ id: tradeId })}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        {/* Summary Card */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Symbol</p>
                <p className="text-3xl font-bold">{trade.symbol}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge
                    className={cn(
                      trade.side === "long"
                        ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
                        : "bg-amber-500/20 text-amber-400 border-amber-500/30"
                    )}
                    variant="outline"
                  >
                    {trade.side === "long" ? "Long" : "Short"}
                  </Badge>
                  <Badge
                    className={cn(
                      trade.status === "open"
                        ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
                        : "bg-green-500/20 text-green-400 border-green-500/30"
                    )}
                    variant="outline"
                  >
                    {trade.status === "open" ? "Open" : "Closed"}
                  </Badge>
                </div>
                {trade.entryDate && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {formatDate(trade.entryDate)}
                    {trade.exitDate ? ` → ${formatDate(trade.exitDate)}` : " → Present"}
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="text-sm text-muted-foreground mb-1">Net P&L</p>
                <p
                  className={cn(
                    "text-4xl font-bold",
                    displayNetPnl != null ? pnlColor(displayNetPnl) : "text-muted-foreground"
                  )}
                >
                  {displayNetPnl != null ? formatCurrency(displayNetPnl) : "—"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Edit Form */}
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Trade Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {/* Symbol */}
                <div className="space-y-1.5">
                  <Label htmlFor="symbol">Symbol</Label>
                  <Input
                    id="symbol"
                    {...form.register("symbol")}
                    placeholder="AAPL"
                    className="uppercase"
                  />
                  {form.formState.errors.symbol && (
                    <p className="text-xs text-destructive">{form.formState.errors.symbol.message}</p>
                  )}
                </div>

                {/* Side */}
                <div className="space-y-1.5">
                  <Label>Side</Label>
                  <Select
                    value={form.watch("side")}
                    onValueChange={(v) => form.setValue("side", v as "long" | "short")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="long">Long</SelectItem>
                      <SelectItem value="short">Short</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Status */}
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <Select
                    value={form.watch("status")}
                    onValueChange={(v) => form.setValue("status", v as "open" | "closed")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Quantity */}
                <div className="space-y-1.5">
                  <Label htmlFor="quantity">Quantity</Label>
                  <Input
                    id="quantity"
                    type="number"
                    step="any"
                    {...form.register("quantity")}
                  />
                  {form.formState.errors.quantity && (
                    <p className="text-xs text-destructive">{form.formState.errors.quantity.message}</p>
                  )}
                </div>

                {/* Entry Price */}
                <div className="space-y-1.5">
                  <Label htmlFor="entryPrice">Entry Price</Label>
                  <Input
                    id="entryPrice"
                    type="number"
                    step="any"
                    {...form.register("entryPrice")}
                  />
                  {form.formState.errors.entryPrice && (
                    <p className="text-xs text-destructive">{form.formState.errors.entryPrice.message}</p>
                  )}
                </div>

                {/* Exit Price */}
                <div className="space-y-1.5">
                  <Label htmlFor="exitPrice">Exit Price</Label>
                  <Input
                    id="exitPrice"
                    type="number"
                    step="any"
                    {...form.register("exitPrice")}
                    placeholder="—"
                  />
                </div>

                {/* Entry Date */}
                <div className="space-y-1.5">
                  <Label htmlFor="entryDate">Entry Date</Label>
                  <Input
                    id="entryDate"
                    type="datetime-local"
                    {...form.register("entryDate")}
                  />
                  {form.formState.errors.entryDate && (
                    <p className="text-xs text-destructive">{form.formState.errors.entryDate.message}</p>
                  )}
                </div>

                {/* Exit Date */}
                <div className="space-y-1.5">
                  <Label htmlFor="exitDate">Exit Date</Label>
                  <Input
                    id="exitDate"
                    type="datetime-local"
                    {...form.register("exitDate")}
                  />
                </div>

                {/* P&L */}
                <div className="space-y-1.5">
                  <Label htmlFor="pnl">P&L</Label>
                  <Input
                    id="pnl"
                    type="number"
                    step="any"
                    {...form.register("pnl")}
                    placeholder="0.00"
                  />
                </div>

                {/* Fees */}
                <div className="space-y-1.5">
                  <Label htmlFor="fees">Fees</Label>
                  <Input
                    id="fees"
                    type="number"
                    step="any"
                    min="0"
                    {...form.register("fees")}
                    placeholder="0.00"
                  />
                </div>

                {/* Net P&L (read-only) */}
                <div className="space-y-1.5">
                  <Label>Net P&L</Label>
                  <Input
                    readOnly
                    value={netPnl != null ? netPnl.toFixed(2) : ""}
                    placeholder="—"
                    className={cn(
                      "cursor-default bg-muted/50",
                      netPnl != null && pnlColor(netPnl)
                    )}
                  />
                </div>

                {/* Account */}
                <div className="space-y-1.5">
                  <Label>Account</Label>
                  <Select
                    value={form.watch("accountId") || "none"}
                    onValueChange={(v) => form.setValue("accountId", v === "none" ? "" : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="No account" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No account</SelectItem>
                      {accounts.map((acc: { id: number; name: string }) => (
                        <SelectItem key={acc.id} value={String(acc.id)}>
                          {acc.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Strategy */}
                <div className="space-y-1.5">
                  <Label>Strategy</Label>
                  <Select
                    value={form.watch("strategyId") || "none"}
                    onValueChange={(v) => form.setValue("strategyId", v === "none" ? "" : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="No strategy" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No strategy</SelectItem>
                      {strategies.map((s: { id: number; name: string }) => (
                        <SelectItem key={s.id} value={String(s.id)}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator />

              {/* Notes */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="notes">Notes</Label>
                  <span className="text-xs text-muted-foreground">
                    {notesValue.length} / 1000
                  </span>
                </div>
                <Textarea
                  id="notes"
                  {...form.register("notes")}
                  placeholder="Add your trade notes here..."
                  rows={4}
                  maxLength={1000}
                />
              </div>
            </CardContent>
          </Card>

          {/* Tags */}
          {tags.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Tags</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-3">
                  {tags.map((tag: { id: number; name: string; color: string | null; usageCount: number; userId: number; createdAt: Date }) => (
                    <label
                      key={tag.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:bg-primary/10"
                    >
                      <Checkbox
                        checked={selectedTagIds.includes(tag.id)}
                        onCheckedChange={() => toggleTag(tag.id)}
                      />
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: tag.color ?? undefined }}
                      />
                      <span>{tag.name}</span>
                    </label>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Save Button */}
          <div className="flex justify-end">
            <Button type="submit" disabled={updateMutation.isPending} size="lg">
              {updateMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save Changes
            </Button>
          </div>
        </form>
      </div>
    </DashboardLayout>
  )
}
