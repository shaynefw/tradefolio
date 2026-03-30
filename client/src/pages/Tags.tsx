import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Plus, Pencil, Trash2, Loader2, Tag } from "lucide-react"
import DashboardLayout from "../components/DashboardLayout"
import { trpc } from "../lib/trpc"
import { cn } from "../lib/utils"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { Label } from "../components/ui/label"
import { Card, CardContent } from "../components/ui/card"
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

const tagSchema = z.object({
  name: z.string().min(1, "Name is required").max(50, "Max 50 characters"),
  color: z.string().min(1, "Please select a color"),
})

type TagFormValues = z.infer<typeof tagSchema>

type TagItem = {
  id: number
  userId: number
  name: string
  color: string | null
  createdAt: Date
  usageCount: number
}

export default function Tags() {
  const [createOpen, setCreateOpen] = useState(false)
  const [editTag, setEditTag] = useState<TagItem | null>(null)
  const [deleteTag, setDeleteTag] = useState<TagItem | null>(null)

  const { data: tags = [], isLoading } = trpc.tag.list.useQuery()
  const utils = trpc.useUtils()

  function invalidate() {
    utils.tag.list.invalidate()
  }

  const createMutation = trpc.tag.create.useMutation({
    onSuccess: () => {
      toast.success("Tag created")
      setCreateOpen(false)
      invalidate()
    },
    onError: (err) => toast.error(err.message),
  })

  const updateMutation = trpc.tag.update.useMutation({
    onSuccess: () => {
      toast.success("Tag updated")
      setEditTag(null)
      invalidate()
    },
    onError: (err) => toast.error(err.message),
  })

  const deleteMutation = trpc.tag.delete.useMutation({
    onSuccess: () => {
      toast.success("Tag deleted")
      setDeleteTag(null)
      invalidate()
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Tags</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Organize your trades with tags
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Tag
          </Button>
        </div>

        {/* Tag List */}
        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : tags.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
              <Tag className="h-10 w-10 text-muted-foreground" />
              <p className="text-muted-foreground text-lg">No tags yet</p>
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create your first tag
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-wrap gap-3">
            {tags.map((tag: TagItem) => (
              <div
                key={tag.id}
                className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm shadow-sm"
              >
                {/* Colored dot */}
                <span
                  className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: tag.color ?? undefined }}
                />
                {/* Tag name + count */}
                <span className="font-medium">
                  {tag.name}
                </span>
                <span className="text-muted-foreground">
                  ({tag.usageCount})
                </span>
                {/* Actions */}
                <div className="flex items-center gap-0.5 ml-1">
                  <button
                    onClick={() => setEditTag(tag)}
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title="Edit tag"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => setDeleteTag(tag)}
                    className="rounded p-0.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    title="Delete tag"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Dialog */}
      <TagDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New Tag"
        onSubmit={(values) => createMutation.mutate(values)}
        isPending={createMutation.isPending}
      />

      {/* Edit Dialog */}
      {editTag && (
        <TagDialog
          open={!!editTag}
          onClose={() => setEditTag(null)}
          title="Edit Tag"
          defaultValues={{ name: editTag.name, color: editTag.color ?? undefined }}
          onSubmit={(values) => updateMutation.mutate({ id: editTag.id, ...values })}
          isPending={updateMutation.isPending}
        />
      )}

      {/* Delete Dialog */}
      <AlertDialog
        open={!!deleteTag}
        onOpenChange={(open) => !open && setDeleteTag(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete tag?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTag && deleteTag.usageCount > 0 ? (
                <>
                  This tag is used on{" "}
                  <span className="font-semibold text-foreground">
                    {deleteTag.usageCount} trade{deleteTag.usageCount !== 1 ? "s" : ""}
                  </span>
                  . Deleting it will remove it from those trades.
                </>
              ) : (
                <>
                  Are you sure you want to delete{" "}
                  <span className="font-semibold text-foreground">{deleteTag?.name}</span>?
                  This action cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteTag && deleteMutation.mutate({ id: deleteTag.id })
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

// ── Tag Dialog ────────────────────────────────────────────────────────────────

function TagDialog({
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
  defaultValues?: Partial<TagFormValues>
  onSubmit: (values: TagFormValues) => void
  isPending: boolean
}) {
  const form = useForm<TagFormValues>({
    resolver: zodResolver(tagSchema),
    defaultValues: {
      name: defaultValues?.name ?? "",
      color: defaultValues?.color ?? COLOR_SWATCHES[0],
    },
  })

  const selectedColor = form.watch("color")

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="tag-name">Name *</Label>
            <Input
              id="tag-name"
              {...form.register("name")}
              placeholder="Breakout, Earnings, Swing..."
            />
            {form.formState.errors.name && (
              <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
            )}
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
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: selectedColor }}
            />
            <span className="text-sm font-medium">
              {form.watch("name") || "Preview"}
            </span>
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
