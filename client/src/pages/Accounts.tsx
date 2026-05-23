import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Plus, Pencil, Trash2, Loader2, Star, Download, Upload } from "lucide-react"
import DashboardLayout from "../components/DashboardLayout"
import { trpc } from "../lib/trpc"
import { cn } from "../lib/utils"

const ACCOUNT_LIMIT = 40
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { Label } from "../components/ui/label"
import { Card, CardContent } from "../components/ui/card"
import { Textarea } from "../components/ui/textarea"
import { Checkbox } from "../components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog"

const COLOR_SWATCHES = [
  "#6366f1", "#8b5cf6", "#a855f7", "#d946ef", "#ec4899",
  "#f43f5e", "#ef4444", "#f97316", "#f59e0b", "#eab308",
  "#84cc16", "#22c55e", "#10b981", "#14b8a6", "#06b6d4",
  "#0ea5e9", "#3b82f6", "#6366f1", "#64748b", "#78716c",
]

const accountSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Max 100 characters"),
  broker: z.string().optional(),
  accountNumber: z.string().optional(),
  description: z.string().optional(),
  color: z.string().min(1, "Please select a color"),
  isDefault: z.boolean().default(false),
})

type AccountFormValues = z.infer<typeof accountSchema>

type Account = {
  id: number
  userId: number
  name: string
  broker?: string | null
  accountNumber?: string | null
  description?: string | null
  color: string | null
  isDefault: boolean
  createdAt: Date
  updatedAt: Date
  tradeCount: number
}

export default function Accounts() {
  const [createOpen, setCreateOpen] = useState(false)
  const [editAccount, setEditAccount] = useState<Account | null>(null)
  const [deleteAccount, setDeleteAccount] = useState<Account | null>(null)
  const [deleteTradesWithAccount, setDeleteTradesWithAccount] = useState(false)
  const [exportingId, setExportingId] = useState<number | null>(null)
  const [importingId, setImportingId] = useState<number | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [showBulkDelete, setShowBulkDelete] = useState(false)
  const [bulkDeleteTrades, setBulkDeleteTrades] = useState(false)

  const { data: accounts = [], isLoading } = trpc.account.list.useQuery()
  const utils = trpc.useUtils()

  function invalidate() {
    utils.account.list.invalidate()
  }

  const createMutation = trpc.account.create.useMutation({
    onSuccess: () => {
      toast.success("Account created")
      setCreateOpen(false)
      invalidate()
    },
    onError: (err) => toast.error(err.message),
  })

  const updateMutation = trpc.account.update.useMutation({
    onSuccess: () => {
      toast.success("Account updated")
      setEditAccount(null)
      invalidate()
    },
    onError: (err) => toast.error(err.message),
  })

  const deleteMutation = trpc.account.delete.useMutation({
    onSuccess: (data) => {
      if (data.tradesDeleted > 0) {
        toast.success(
          `Account deleted along with ${data.tradesDeleted} trade${data.tradesDeleted !== 1 ? "s" : ""}`
        )
      } else {
        toast.success("Account deleted")
      }
      setDeleteAccount(null)
      setDeleteTradesWithAccount(false)
      invalidate()
      utils.trade.list.invalidate()
    },
    onError: (err) => toast.error(err.message),
  })

  const setDefaultMutation = trpc.account.setDefault.useMutation({
    onSuccess: () => {
      toast.success("Default account updated")
      invalidate()
    },
    onError: (err) => toast.error(err.message),
  })

  const deleteBulkMutation = trpc.account.deleteBulk.useMutation({
    onSuccess: (data) => {
      const parts = [
        `${data.accountsDeleted} account${data.accountsDeleted !== 1 ? "s" : ""} deleted`,
      ]
      if (data.tradesDeleted > 0) {
        parts.push(
          `${data.tradesDeleted} trade${data.tradesDeleted !== 1 ? "s" : ""} removed`
        )
      }
      toast.success(parts.join(", "))
      setSelected(new Set())
      setShowBulkDelete(false)
      setBulkDeleteTrades(false)
      invalidate()
      utils.trade.list.invalidate()
    },
    onError: (err) => toast.error(err.message),
  })

  const importMutation = trpc.backup.import.useMutation({
    onSuccess: (data) => {
      const parts = [`${data.imported} trade${data.imported !== 1 ? "s" : ""} restored`]
      if (data.accountsCreated > 0) {
        parts.push(`${data.accountsCreated} account${data.accountsCreated !== 1 ? "s" : ""} created`)
      }
      if (data.accountsSkipped > 0) {
        parts.push(`${data.accountsSkipped} duplicate account${data.accountsSkipped !== 1 ? "s" : ""} skipped`)
      }
      toast.success(parts.join(", "))
      setImportingId(null)
      invalidate()
      utils.trade.list.invalidate()
    },
    onError: (err) => toast.error(err.message),
  })

  async function handleExport(accountId: number, accountName: string) {
    setExportingId(accountId)
    try {
      const json = await utils.backup.export.fetch({ accountId })
      const blob = new Blob([json], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `tradefolio-${accountName.toLowerCase().replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.success("Backup exported")
    } catch (err: any) {
      toast.error(err.message ?? "Export failed")
    } finally {
      setExportingId(null)
    }
  }

  function handleImport(accountId: number) {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".json"
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        importMutation.mutate({ data: text, accountId })
      } catch {
        toast.error("Failed to read file")
      }
    }
    input.click()
  }

  async function handleExportAll() {
    try {
      const json = await utils.backup.export.fetch({})
      const blob = new Blob([json], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `tradefolio-all-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.success("Backup exported")
    } catch (err: any) {
      toast.error(err.message ?? "Export failed")
    }
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 px-4 py-4 sm:px-6 sm:py-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Accounts</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage your trading accounts and broker profiles
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={handleExportAll}
              disabled={accounts.length === 0}
            >
              <Download className="mr-2 h-4 w-4" />
              Export All
            </Button>
            <Button
              onClick={() => setCreateOpen(true)}
              disabled={accounts.length >= ACCOUNT_LIMIT}
            >
              <Plus className="mr-2 h-4 w-4" />
              New Account ({accounts.length}/{ACCOUNT_LIMIT})
            </Button>
          </div>
        </div>

        {/* Bulk action bar */}
        {accounts.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
            <Checkbox
              id="acc-select-all"
              checked={selected.size === accounts.length && accounts.length > 0}
              onCheckedChange={(v) => {
                if (Boolean(v)) {
                  setSelected(new Set(accounts.map((a) => a.id)))
                } else {
                  setSelected(new Set())
                }
              }}
            />
            <Label
              htmlFor="acc-select-all"
              className="cursor-pointer text-sm font-medium"
            >
              {selected.size === 0
                ? `Select all (${accounts.length})`
                : `${selected.size} of ${accounts.length} selected`}
            </Label>
            {selected.size > 0 && (
              <>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setShowBulkDelete(true)}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  Delete {selected.size} account{selected.size !== 1 ? "s" : ""}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelected(new Set())}
                >
                  Clear
                </Button>
              </>
            )}
          </div>
        )}

        {/* Account List */}
        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : accounts.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
              <p className="text-muted-foreground text-lg">No accounts yet</p>
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create your first account
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {accounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                isSelected={selected.has(account.id)}
                onToggleSelect={() => {
                  const next = new Set(selected)
                  if (next.has(account.id)) {
                    next.delete(account.id)
                  } else {
                    next.add(account.id)
                  }
                  setSelected(next)
                }}
                onEdit={() => setEditAccount(account)}
                onDelete={() => setDeleteAccount(account)}
                onSetDefault={() => setDefaultMutation.mutate({ id: account.id })}
                onExport={() => handleExport(account.id, account.name)}
                onImport={() => handleImport(account.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create Dialog */}
      <AccountDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New Account"
        onSubmit={(values) => createMutation.mutate(values)}
        isPending={createMutation.isPending}
      />

      {/* Edit Dialog */}
      {editAccount && (
        <AccountDialog
          open={!!editAccount}
          onClose={() => setEditAccount(null)}
          title="Edit Account"
          defaultValues={{
            name: editAccount.name,
            broker: editAccount.broker ?? "",
            accountNumber: editAccount.accountNumber ?? "",
            description: editAccount.description ?? "",
            color: editAccount.color ?? undefined,
            isDefault: editAccount.isDefault,
          }}
          onSubmit={(values) =>
            updateMutation.mutate({ id: editAccount.id, ...values })
          }
          isPending={updateMutation.isPending}
        />
      )}

      {/* Delete Dialog */}
      <AlertDialog
        open={!!deleteAccount}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteAccount(null)
            setDeleteTradesWithAccount(false)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete account?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              <span className="font-semibold">{deleteAccount?.name}</span>?
              {deleteAccount?.tradeCount ? (
                <>
                  {" "}This account has{" "}
                  <span className="font-semibold">
                    {deleteAccount.tradeCount} trade
                    {deleteAccount.tradeCount !== 1 ? "s" : ""}
                  </span>
                  .
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex items-start gap-3 rounded-md border border-border bg-muted/30 px-3 py-2.5">
            <Checkbox
              id="delete-trades-with-account"
              checked={deleteTradesWithAccount}
              onCheckedChange={(v) => setDeleteTradesWithAccount(Boolean(v))}
              className="mt-0.5"
            />
            <div className="space-y-0.5">
              <Label
                htmlFor="delete-trades-with-account"
                className="cursor-pointer font-medium"
              >
                Also delete all trades on this account
              </Label>
              <p className="text-xs text-muted-foreground">
                {deleteTradesWithAccount
                  ? "Trades will be permanently removed. This cannot be undone."
                  : "Trades will be kept and unlinked from this account."}
              </p>
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteAccount &&
                deleteMutation.mutate({
                  id: deleteAccount.id,
                  deleteTrades: deleteTradesWithAccount,
                })
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteTradesWithAccount ? "Delete account & trades" : "Delete account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Delete Dialog */}
      <AlertDialog
        open={showBulkDelete}
        onOpenChange={(open) => {
          if (!open) {
            setShowBulkDelete(false)
            setBulkDeleteTrades(false)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selected.size} account{selected.size !== 1 ? "s" : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const selectedAccounts = accounts.filter((a) => selected.has(a.id))
                const totalTrades = selectedAccounts.reduce(
                  (sum, a) => sum + (a.tradeCount ?? 0),
                  0
                )
                return (
                  <>
                    You're about to delete{" "}
                    <span className="font-semibold">{selected.size}</span>{" "}
                    account{selected.size !== 1 ? "s" : ""}.
                    {totalTrades > 0 && (
                      <>
                        {" "}They hold{" "}
                        <span className="font-semibold">
                          {totalTrades} trade{totalTrades !== 1 ? "s" : ""}
                        </span>{" "}
                        in total.
                      </>
                    )}
                  </>
                )
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex items-start gap-3 rounded-md border border-border bg-muted/30 px-3 py-2.5">
            <Checkbox
              id="bulk-delete-trades"
              checked={bulkDeleteTrades}
              onCheckedChange={(v) => setBulkDeleteTrades(Boolean(v))}
              className="mt-0.5"
            />
            <div className="space-y-0.5">
              <Label
                htmlFor="bulk-delete-trades"
                className="cursor-pointer font-medium"
              >
                Also delete all trades on these accounts
              </Label>
              <p className="text-xs text-muted-foreground">
                {bulkDeleteTrades
                  ? "Trades will be permanently removed. This cannot be undone."
                  : "Trades will be kept and unlinked from these accounts."}
              </p>
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteBulkMutation.mutate({
                  ids: Array.from(selected),
                  deleteTrades: bulkDeleteTrades,
                })
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {bulkDeleteTrades
                ? `Delete ${selected.size} account${selected.size !== 1 ? "s" : ""} & trades`
                : `Delete ${selected.size} account${selected.size !== 1 ? "s" : ""}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  )
}

// ── Account Card ──────────────────────────────────────────────────────────────

function AccountCard({
  account,
  isSelected,
  onToggleSelect,
  onEdit,
  onDelete,
  onSetDefault,
  onExport,
  onImport,
}: {
  account: Account
  isSelected: boolean
  onToggleSelect: () => void
  onEdit: () => void
  onDelete: () => void
  onSetDefault: () => void
  onExport: () => void
  onImport: () => void
}) {
  const accountColor = account.color ?? "#6366f1"
  const initial = account.name.trim().charAt(0).toUpperCase() || "?"

  return (
    <Card
      className={cn(
        "overflow-hidden transition-colors",
        isSelected && "ring-2 ring-primary/60"
      )}
    >
      {/* Colored top stripe */}
      <div
        className="h-1 w-full"
        style={{ backgroundColor: accountColor }}
      />
      <CardContent className="p-5">
        {/* Header: checkbox + avatar + name + default star */}
        <div className="flex items-center gap-3">
          <Checkbox
            checked={isSelected}
            onCheckedChange={onToggleSelect}
            aria-label={`Select ${account.name}`}
            className="shrink-0"
          />
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-base font-semibold text-white"
            style={{ backgroundColor: accountColor }}
          >
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-base font-semibold">{account.name}</p>
              {account.isDefault && (
                <Star
                  className="h-4 w-4 shrink-0 fill-yellow-400 text-yellow-400"
                  aria-label="Default account"
                />
              )}
            </div>
            {(account.broker || account.accountNumber) && (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {[account.broker, account.accountNumber]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </div>
        </div>

        {/* Backup / Restore buttons */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Backup
          </Button>
          <Button variant="outline" size="sm" onClick={onImport}>
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            Restore
          </Button>
        </div>

        {/* Bottom action row: Set Default (if applicable) + Edit | Delete */}
        <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
          <div className="flex items-center gap-1">
            {!account.isDefault && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-muted-foreground hover:text-yellow-400"
                onClick={onSetDefault}
              >
                <Star className="mr-1.5 h-3.5 w-3.5" />
                Set Default
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-muted-foreground hover:text-foreground"
              onClick={onEdit}
            >
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              Edit
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Account Dialog ────────────────────────────────────────────────────────────

function AccountDialog({
  open,
  onClose,
  title,
  defaultValues,
  onSubmit,
  isPending,
}: {
  open: boolean
  onClose: () => void
  title: string
  defaultValues?: Partial<AccountFormValues>
  onSubmit: (values: AccountFormValues) => void
  isPending: boolean
}) {
  const form = useForm<AccountFormValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      name: defaultValues?.name ?? "",
      broker: defaultValues?.broker ?? "",
      accountNumber: defaultValues?.accountNumber ?? "",
      description: defaultValues?.description ?? "",
      color: defaultValues?.color ?? COLOR_SWATCHES[0],
      isDefault: defaultValues?.isDefault ?? false,
    },
  })

  const selectedColor = form.watch("color")

  function handleSubmit(values: AccountFormValues) {
    onSubmit(values)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="acc-name">Name *</Label>
            <Input id="acc-name" {...form.register("name")} placeholder="My Brokerage Account" />
            {form.formState.errors.name && (
              <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>

          {/* Broker */}
          <div className="space-y-1.5">
            <Label htmlFor="acc-broker">Broker</Label>
            <Input id="acc-broker" {...form.register("broker")} placeholder="TD Ameritrade" />
          </div>

          {/* Account Number */}
          <div className="space-y-1.5">
            <Label htmlFor="acc-number">Account Number</Label>
            <Input id="acc-number" {...form.register("accountNumber")} placeholder="XXXX-1234" />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="acc-description">Description</Label>
            <Textarea
              id="acc-description"
              {...form.register("description")}
              placeholder="Optional notes about this account..."
              rows={2}
            />
          </div>

          {/* Color */}
          <div className="space-y-1.5">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {COLOR_SWATCHES.map((color, i) => (
                <button
                  key={`${color}-${i}`}
                  type="button"
                  className={cn(
                    "h-7 w-7 rounded-full transition-transform hover:scale-110 focus:outline-none",
                    selectedColor === color && "ring-2 ring-white ring-offset-2 ring-offset-background scale-110"
                  )}
                  style={{ backgroundColor: color }}
                  onClick={() => form.setValue("color", color)}
                />
              ))}
            </div>
            {form.formState.errors.color && (
              <p className="text-xs text-destructive">{form.formState.errors.color.message}</p>
            )}
          </div>

          {/* Set as Default */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="acc-default"
              checked={form.watch("isDefault")}
              onCheckedChange={(v) => form.setValue("isDefault", Boolean(v))}
            />
            <Label htmlFor="acc-default" className="cursor-pointer font-normal">
              Set as default account
            </Label>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
