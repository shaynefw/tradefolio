import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Plus, Pencil, Trash2, Loader2, BookOpen, Search } from "lucide-react"
import DashboardLayout from "../components/DashboardLayout"
import { trpc } from "../lib/trpc"
import { cn } from "../lib/utils"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { Label } from "../components/ui/label"
import { Card, CardContent } from "../components/ui/card"
import { Textarea } from "../components/ui/textarea"
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

const strategySchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Max 100 characters"),
  description: z.string().optional(),
  color: z.string().min(1, "Please select a color"),
})

type StrategyFormValues = z.infer<typeof strategySchema>

type Strategy = {
  id: number
  userId: number
  name: string
  description?: string | null
  color: string | null
  createdAt: Date
  updatedAt: Date
}

export default function Strategies() {
  const [createOpen, setCreateOpen] = useState(false)
  const [editStrategy, setEditStrategy] = useState<Strategy | null>(null)
  const [deleteStrategy, setDeleteStrategy] = useState<Strategy | null>(null)
  const [search, setSearch] = useState("")

  const { data: strategies = [], isLoading } = trpc.strategy.list.useQuery()

  const filteredStrategies = strategies.filter((s: Strategy) =>
    !search || s.name.toLowerCase().includes(search.toLowerCase())
  )
  const utils = trpc.useUtils()

  function invalidate() {
    utils.strategy.list.invalidate()
  }

  const createMutation = trpc.strategy.create.useMutation({
    onSuccess: () => {
      toast.success("Strategy created")
      setCreateOpen(false)
      invalidate()
    },
    onError: (err) => toast.error(err.message),
  })

  const updateMutation = trpc.strategy.update.useMutation({
    onSuccess: () => {
      toast.success("Strategy updated")
      setEditStrategy(null)
      invalidate()
    },
    onError: (err) => toast.error(err.message),
  })

  const deleteMutation = trpc.strategy.delete.useMutation({
    onSuccess: () => {
      toast.success("Strategy deleted")
      setDeleteStrategy(null)
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
            <h1 className="text-2xl font-bold">Strategies</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Define and manage your trading strategies
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Strategy
          </Button>
        </div>

        {/* Search */}
        {strategies.length > 0 && (
          <div className="relative max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search strategies..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
        )}

        {/* Strategy List */}
        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : strategies.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
              <BookOpen className="h-10 w-10 text-muted-foreground" />
              <p className="text-muted-foreground text-lg">No strategies yet</p>
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create your first strategy
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredStrategies.map((strategy: Strategy) => (
              <StrategyCard
                key={strategy.id}
                strategy={strategy}
                onEdit={() => setEditStrategy(strategy)}
                onDelete={() => setDeleteStrategy(strategy)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create Dialog */}
      <StrategyDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New Strategy"
        onSubmit={(values) => createMutation.mutate(values)}
        isPending={createMutation.isPending}
      />

      {/* Edit Dialog */}
      {editStrategy && (
        <StrategyDialog
          open={!!editStrategy}
          onClose={() => setEditStrategy(null)}
          title="Edit Strategy"
          defaultValues={{
            name: editStrategy.name,
            description: editStrategy.description ?? "",
            color: editStrategy.color ?? undefined,
          }}
          onSubmit={(values) =>
            updateMutation.mutate({ id: editStrategy.id, ...values })
          }
          isPending={updateMutation.isPending}
        />
      )}

      {/* Delete Dialog */}
      <AlertDialog
        open={!!deleteStrategy}
        onOpenChange={(open) => !open && setDeleteStrategy(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete strategy?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              <span className="font-semibold text-foreground">{deleteStrategy?.name}</span>?
              Trades using this strategy will have their strategy unlinked.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteStrategy && deleteMutation.mutate({ id: deleteStrategy.id })
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

// ── Strategy Card ─────────────────────────────────────────────────────────────

function StrategyCard({
  strategy,
  onEdit,
  onDelete,
}: {
  strategy: Strategy
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <Card className="overflow-hidden">
      {/* Colored top stripe */}
      <div className="h-1.5 w-full" style={{ backgroundColor: strategy.color ?? undefined }} />
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-semibold truncate">{strategy.name}</p>
            {strategy.description ? (
              <p className="mt-1.5 text-sm text-muted-foreground line-clamp-2">
                {strategy.description}
              </p>
            ) : (
              <p className="mt-1.5 text-sm text-muted-foreground italic">No description</p>
            )}
          </div>
        </div>
        <div className="mt-4 flex items-center gap-1">
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
    </Card>
  )
}

// ── Strategy Dialog ───────────────────────────────────────────────────────────

function StrategyDialog({
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
  defaultValues?: Partial<StrategyFormValues>
  onSubmit: (values: StrategyFormValues) => void
  isPending: boolean
}) {
  const form = useForm<StrategyFormValues>({
    resolver: zodResolver(strategySchema),
    defaultValues: {
      name: defaultValues?.name ?? "",
      description: defaultValues?.description ?? "",
      color: defaultValues?.color ?? COLOR_SWATCHES[0],
    },
  })

  const selectedColor = form.watch("color")

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="strat-name">Name *</Label>
            <Input
              id="strat-name"
              {...form.register("name")}
              placeholder="Momentum, Mean Reversion, Scalping..."
            />
            {form.formState.errors.name && (
              <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="strat-description">Description</Label>
            <Textarea
              id="strat-description"
              {...form.register("description")}
              placeholder="Describe your strategy, entry/exit rules, conditions..."
              rows={3}
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
                    selectedColor === color &&
                      "ring-2 ring-white ring-offset-2 ring-offset-background scale-110"
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

          {/* Preview */}
          <div
            className="rounded-md border-l-4 bg-muted/30 px-3 py-2"
            style={{ borderLeftColor: selectedColor }}
          >
            <p className="text-sm font-medium">{form.watch("name") || "Strategy Preview"}</p>
            {form.watch("description") && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                {form.watch("description")}
              </p>
            )}
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
