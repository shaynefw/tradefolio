import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Plus, Pencil, Trash2, Loader2, Star } from "lucide-react"
import DashboardLayout from "../components/DashboardLayout"
import { trpc } from "../lib/trpc"
import { cn } from "../lib/utils"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { Label } from "../components/ui/label"
import { Card, CardContent } from "../components/ui/card"
import { Badge } from "../components/ui/badge"
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
  "#6366f1",
  "#8b5cf6",
  "#06b6d4",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#64748b",
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
    onSuccess: () => {
      toast.success("Account deleted")
      setDeleteAccount(null)
      invalidate()
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

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Accounts</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage your trading accounts
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Account
          </Button>
        </div>

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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {accounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                onEdit={() => setEditAccount(account)}
                onDelete={() => setDeleteAccount(account)}
                onSetDefault={() => setDefaultMutation.mutate({ id: account.id })}
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
        onOpenChange={(open) => !open && setDeleteAccount(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete account?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              <span className="font-semibold">{deleteAccount?.name}</span>?
              Your trades will not be deleted, just unlinked from this account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteAccount && deleteMutation.mutate({ id: deleteAccount.id })
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
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
  onEdit,
  onDelete,
  onSetDefault,
}: {
  account: Account
  onEdit: () => void
  onDelete: () => void
  onSetDefault: () => void
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex">
        {/* Colored stripe */}
        <div
          className="w-1.5 flex-shrink-0"
          style={{ backgroundColor: account.color ?? undefined }}
        />
        <CardContent className="flex-1 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold truncate">{account.name}</p>
                {account.isDefault && (
                  <Badge
                    variant="outline"
                    className="text-xs border-yellow-500/40 text-yellow-400 bg-yellow-500/10"
                  >
                    Default
                  </Badge>
                )}
              </div>
              {(account.broker || account.accountNumber) && (
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {[account.broker, account.accountNumber]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
              {account.description && (
                <p className="text-sm text-muted-foreground mt-1.5 line-clamp-2">
                  {account.description}
                </p>
              )}
              <div className="mt-3 flex items-center gap-2">
                {account.tradeCount != null && (
                  <Badge variant="secondary" className="text-xs">
                    {account.tradeCount} trade{account.tradeCount !== 1 ? "s" : ""}
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1">
            {!account.isDefault && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-yellow-400"
                onClick={onSetDefault}
                title="Set as default"
              >
                <Star className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={onEdit}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={onDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </CardContent>
      </div>
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
            <div className="flex gap-2">
              {COLOR_SWATCHES.map((color) => (
                <button
                  key={color}
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
