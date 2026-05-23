import { useState, useMemo } from "react";
import { Link } from "wouter";
import { trpc } from "../lib/trpc";
import { useAccount } from "../contexts/AccountContext";
import { useDateRange } from "../contexts/DateRangeContext";
import { useStrategy } from "../contexts/StrategyContext";
import { cn, formatCurrency, formatDate, pnlColor } from "../lib/utils";
import DashboardLayout from "../components/DashboardLayout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Badge } from "../components/ui/badge";
import { Separator } from "../components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Checkbox } from "../components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Search,
  Tags,
  Target,
  Copy,
} from "lucide-react";
import { format } from "date-fns";

const PAGE_SIZE = 25;

interface NewTradeForm {
  symbol: string;
  side: "long" | "short";
  quantity: string;
  entryPrice: string;
  exitPrice: string;
  entryDate: string;
  exitDate: string;
  fees: string;
  notes: string;
  accountId: string;
  strategyId: string;
  tagIds: number[];
}

const defaultForm: NewTradeForm = {
  symbol: "",
  side: "long",
  quantity: "",
  entryPrice: "",
  exitPrice: "",
  entryDate: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
  exitDate: "",
  fees: "",
  notes: "",
  accountId: "",
  strategyId: "",
  tagIds: [],
};

export default function TradeLog() {
  const { selectedAccountId, accounts } = useAccount();
  const { selectedStrategyId } = useStrategy();
  const { startDate, endDate } = useDateRange();

  // Filters
  const [search, setSearch] = useState("");
  const [filterSide, setFilterSide] = useState<"all" | "long" | "short">("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "open" | "closed">("all");
  const [filterAccount, setFilterAccount] = useState<string>("all");
  const [filterTag, setFilterTag] = useState<string>("all");

  // Pagination
  const [page, setPage] = useState(0);

  // Selection
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Dialogs
  const [showNewTrade, setShowNewTrade] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [showBulkTag, setShowBulkTag] = useState(false);
  const [bulkTagAdd, setBulkTagAdd] = useState<Set<number>>(new Set());
  const [bulkTagRemove, setBulkTagRemove] = useState<Set<number>>(new Set());
  const [showBulkStrategy, setShowBulkStrategy] = useState(false);
  const [bulkStrategyId, setBulkStrategyId] = useState<string>("none");
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [form, setForm] = useState<NewTradeForm>(defaultForm);

  const startDateStr = startDate ? format(new Date(startDate), "MM/dd/yyyy") : undefined;
  const endDateStr = endDate ? format(new Date(endDate), "MM/dd/yyyy") : undefined;

  const { data: trades = [], refetch } = trpc.trade.list.useQuery({
    accountId: selectedAccountId ?? undefined,
    strategyId: selectedStrategyId ?? undefined,
    startDate: startDateStr,
    endDate: endDateStr,
    status: filterStatus === "all" ? undefined : filterStatus,
  });

  const { data: tags = [] } = trpc.tag.list.useQuery();
  const { data: strategies = [] } = trpc.strategy.list.useQuery();
  const duplicatesQuery = trpc.trade.findDuplicates.useQuery(undefined, {
    enabled: showDuplicates,
  });

  const deleteMutation = trpc.trade.delete.useMutation({
    onSuccess: () => {
      toast.success("Trade deleted");
      refetch();
      setDeletingId(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteBulkMutation = trpc.trade.deleteBulk.useMutation({
    onSuccess: (data) => {
      toast.success(`Deleted ${data.deleted} trades`);
      setSelected(new Set());
      refetch();
      duplicatesQuery.refetch();
      setShowBulkDelete(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const bulkAssignTagsMutation = trpc.trade.bulkAssignTags.useMutation({
    onSuccess: (data) => {
      toast.success(`Tags updated for ${data.updated} trades`);
      setSelected(new Set());
      setBulkTagAdd(new Set());
      setBulkTagRemove(new Set());
      refetch();
      setShowBulkTag(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const bulkSetStrategyMutation = trpc.trade.bulkSetStrategy.useMutation({
    onSuccess: (data) => {
      toast.success(`Strategy updated for ${data.updated} trades`);
      setSelected(new Set());
      refetch();
      setShowBulkStrategy(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const createMutation = trpc.trade.create.useMutation({
    onSuccess: () => {
      toast.success("Trade created");
      refetch();
      setShowNewTrade(false);
      setForm(defaultForm);
    },
    onError: (err) => toast.error(err.message),
  });

  // Client-side filtering
  const filtered = useMemo(() => {
    return trades.filter((t) => {
      if (search && !t.symbol.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterSide !== "all" && t.side !== filterSide) return false;
      if (filterAccount !== "all" && String(t.accountId) !== filterAccount) return false;
      if (filterTag !== "all") {
        const hasTag = t.tags?.some((tag: { id: number }) => String(tag.id) === filterTag);
        if (!hasTag) return false;
      }
      return true;
    });
  }, [trades, search, filterSide, filterAccount, filterTag]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const allPageSelected =
    paginated.length > 0 && paginated.every((t) => selected.has(t.id));

  function toggleSelectAll() {
    if (allPageSelected) {
      const next = new Set(selected);
      paginated.forEach((t) => next.delete(t.id));
      setSelected(next);
    } else {
      const next = new Set(selected);
      paginated.forEach((t) => next.add(t.id));
      setSelected(next);
    }
  }

  function toggleSelect(id: number) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function handleCreateTrade() {
    if (!form.symbol.trim()) {
      toast.error("Symbol is required");
      return;
    }
    createMutation.mutate({
      symbol: form.symbol.trim(),
      side: form.side,
      quantity: form.quantity ? Number(form.quantity) : undefined,
      entryPrice: form.entryPrice ? Number(form.entryPrice) : undefined,
      exitPrice: form.exitPrice ? Number(form.exitPrice) : undefined,
      entryDate: form.entryDate ? new Date(form.entryDate).getTime() : undefined,
      exitDate: form.exitDate ? new Date(form.exitDate).getTime() : undefined,
      fees: form.fees ? Number(form.fees) : undefined,
      notes: form.notes || undefined,
      accountId: form.accountId ? Number(form.accountId) : undefined,
      strategyId: form.strategyId ? Number(form.strategyId) : undefined,
      tagIds: form.tagIds,
      status: form.exitDate ? "closed" : "open",
    });
  }

  function setField(key: keyof NewTradeForm, value: string | number[]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toggleTagInForm(tagId: number) {
    setForm((f) => ({
      ...f,
      tagIds: f.tagIds.includes(tagId)
        ? f.tagIds.filter((id) => id !== tagId)
        : [...f.tagIds, tagId],
    }));
  }

  return (
    <DashboardLayout>
      <div className="p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Trade Log</h1>
            <p className="text-sm text-muted-foreground">
              {filtered.length} of {trades.length} trades
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setShowDuplicates(true)}>
              <Copy className="h-4 w-4 mr-2" />
              Find Duplicates
            </Button>
            <Button onClick={() => setShowNewTrade(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New Trade
            </Button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[160px] max-w-xs">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search symbol..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                className="pl-8"
              />
            </div>
          </div>

          <Select
            value={filterSide}
            onValueChange={(v) => { setFilterSide(v as typeof filterSide); setPage(0); }}
          >
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Side" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sides</SelectItem>
              <SelectItem value="long">Long</SelectItem>
              <SelectItem value="short">Short</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={filterStatus}
            onValueChange={(v) => { setFilterStatus(v as typeof filterStatus); setPage(0); }}
          >
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={filterAccount}
            onValueChange={(v) => { setFilterAccount(v); setPage(0); }}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Account" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Accounts</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filterTag}
            onValueChange={(v) => { setFilterTag(v); setPage(0); }}
          >
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Tag" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Tags</SelectItem>
              {tags.map((tag) => (
                <SelectItem key={tag.id} value={String(tag.id)}>
                  {tag.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
            <span className="text-sm font-medium">{selected.size} selected</span>
            {tags.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setBulkTagAdd(new Set());
                  setBulkTagRemove(new Set());
                  setShowBulkTag(true);
                }}
              >
                <Tags className="h-4 w-4 mr-1" />
                Tags
              </Button>
            )}
            {strategies.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setBulkStrategyId("none");
                  setShowBulkStrategy(true);
                }}
              >
                <Target className="h-4 w-4 mr-1" />
                Strategy
              </Button>
            )}
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowBulkDelete(true)}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Delete
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected(new Set())}
            >
              Clear
            </Button>
          </div>
        )}

        {/* Table */}
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allPageSelected}
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead>Side</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Entry</TableHead>
                <TableHead className="text-right">Exit</TableHead>
                <TableHead className="text-right">P&L</TableHead>
                <TableHead className="text-right">Fees</TableHead>
                <TableHead className="text-right">Net P&L</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead className="w-20">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={13} className="text-center py-10 text-muted-foreground">
                    No trades found
                  </TableCell>
                </TableRow>
              ) : (
                paginated.map((trade) => (
                  <TableRow key={trade.id} className="hover:bg-muted/50">
                    <TableCell>
                      <Checkbox
                        checked={selected.has(trade.id)}
                        onCheckedChange={() => toggleSelect(trade.id)}
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {formatDate(trade.entryDate ?? undefined)}
                    </TableCell>
                    <TableCell className="font-medium">{trade.symbol}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs",
                          trade.side === "long"
                            ? "border-blue-500 text-blue-400"
                            : "border-orange-500 text-orange-400"
                        )}
                      >
                        {trade.side}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {trade.quantity ?? "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {trade.entryPrice != null ? formatCurrency(trade.entryPrice) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {trade.exitPrice != null ? formatCurrency(trade.exitPrice) : "—"}
                    </TableCell>
                    <TableCell className={cn("text-right text-sm font-medium", pnlColor(trade.pnl))}>
                      {trade.pnl != null ? formatCurrency(trade.pnl) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {trade.fees != null ? formatCurrency(trade.fees) : "—"}
                    </TableCell>
                    <TableCell className={cn("text-right text-sm font-semibold", pnlColor(trade.netPnl))}>
                      {trade.netPnl != null ? formatCurrency(trade.netPnl) : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {trade.accountName ?? "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(trade.tags as Array<{ id: number; name: string; color: string | null }>)?.map((tag) => (
                          <Badge
                            key={tag.id}
                            variant="outline"
                            className="text-xs px-1.5 py-0"
                            style={{ borderColor: tag.color ?? undefined, color: tag.color ?? undefined }}
                          >
                            {tag.name}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Link href={`/trades/${trade.id}`}>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </Link>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => setDeletingId(trade.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Page {page + 1} of {totalPages} ({filtered.length} trades)
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Duplicates Dialog */}
      <Dialog open={showDuplicates} onOpenChange={setShowDuplicates}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Duplicate Trades</DialogTitle>
          </DialogHeader>

          {duplicatesQuery.isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Scanning trades…
            </p>
          ) : !duplicatesQuery.data || duplicatesQuery.data.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm font-medium">No duplicate trades found</p>
              <p className="text-xs text-muted-foreground mt-1">
                Identical trades match on symbol, side, dates, prices and quantity.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  Found {duplicatesQuery.data.length} duplicate group
                  {duplicatesQuery.data.length !== 1 ? "s" : ""}. The oldest trade
                  in each group is kept.
                </p>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={deleteBulkMutation.isPending}
                  onClick={() => {
                    const allDupIds = duplicatesQuery.data!
                      .flatMap(([, ...rest]) => rest)
                      .map((t) => t.id);
                    if (allDupIds.length > 0) {
                      deleteBulkMutation.mutate({ ids: allDupIds });
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete all duplicates (
                  {duplicatesQuery.data.reduce((sum, g) => sum + g.length - 1, 0)})
                </Button>
              </div>

              <div className="space-y-3">
                {duplicatesQuery.data.map((group, i) => {
                  const [keep, ...dups] = group;
                  return (
                    <div
                      key={i}
                      className="rounded-lg border border-border bg-muted/20 p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-mono font-semibold">{keep.symbol}</span>
                          <Badge variant="outline" className="text-xs">
                            {keep.side}
                          </Badge>
                          <span className="text-muted-foreground">
                            {group.length} copies
                          </span>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          disabled={deleteBulkMutation.isPending}
                          onClick={() =>
                            deleteBulkMutation.mutate({ ids: dups.map((d) => d.id) })
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                          Delete {dups.length} duplicate{dups.length !== 1 ? "s" : ""}
                        </Button>
                      </div>
                      <div className="grid grid-cols-1 gap-1 text-xs">
                        {group.map((t, idx) => (
                          <div
                            key={t.id}
                            className={cn(
                              "flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded px-2 py-1",
                              idx === 0
                                ? "bg-green-500/10 text-foreground"
                                : "text-muted-foreground"
                            )}
                          >
                            <span className="font-medium">
                              {idx === 0 ? "Keep" : "Duplicate"}
                            </span>
                            <span>#{t.id}</span>
                            <span>Entry: {formatDate(t.entryDate)}</span>
                            <span>Exit: {formatDate(t.exitDate)}</span>
                            <span>Qty: {t.quantity ?? "—"}</span>
                            <span>
                              {t.entryPrice ?? "—"} → {t.exitPrice ?? "—"}
                            </span>
                            <span className={pnlColor(t.netPnl)}>
                              {t.netPnl != null ? formatCurrency(t.netPnl) : "—"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* New Trade Dialog */}
      <Dialog open={showNewTrade} onOpenChange={(o) => { setShowNewTrade(o); if (!o) setForm(defaultForm); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Trade</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="space-y-1.5">
              <Label>Symbol *</Label>
              <Input
                value={form.symbol}
                onChange={(e) => setField("symbol", e.target.value.toUpperCase())}
                placeholder="AAPL"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Side *</Label>
              <Select value={form.side} onValueChange={(v) => setField("side", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="long">Long</SelectItem>
                  <SelectItem value="short">Short</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Quantity</Label>
              <Input
                type="number"
                value={form.quantity}
                onChange={(e) => setField("quantity", e.target.value)}
                placeholder="100"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Entry Price</Label>
              <Input
                type="number"
                step="0.01"
                value={form.entryPrice}
                onChange={(e) => setField("entryPrice", e.target.value)}
                placeholder="0.00"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Exit Price</Label>
              <Input
                type="number"
                step="0.01"
                value={form.exitPrice}
                onChange={(e) => setField("exitPrice", e.target.value)}
                placeholder="Optional"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Fees</Label>
              <Input
                type="number"
                step="0.01"
                value={form.fees}
                onChange={(e) => setField("fees", e.target.value)}
                placeholder="0.00"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Entry Date/Time</Label>
              <Input
                type="datetime-local"
                value={form.entryDate}
                onChange={(e) => setField("entryDate", e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Exit Date/Time</Label>
              <Input
                type="datetime-local"
                value={form.exitDate}
                onChange={(e) => setField("exitDate", e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Account</Label>
              <Select value={form.accountId} onValueChange={(v) => setField("accountId", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Strategy</Label>
              <Select value={form.strategyId} onValueChange={(v) => setField("strategyId", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select strategy" />
                </SelectTrigger>
                <SelectContent>
                  {strategies.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label>Notes</Label>
              <textarea
                className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none min-h-[80px]"
                value={form.notes}
                onChange={(e) => setField("notes", e.target.value)}
                placeholder="Trade notes..."
                maxLength={1000}
              />
            </div>

            {tags.length > 0 && (
              <div className="col-span-2 space-y-1.5">
                <Label>Tags</Label>
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <label key={tag.id} className="flex items-center gap-1.5 cursor-pointer">
                      <Checkbox
                        checked={form.tagIds.includes(tag.id)}
                        onCheckedChange={() => toggleTagInForm(tag.id)}
                      />
                      <span
                        className="text-sm"
                        style={{ color: tag.color ?? undefined }}
                      >
                        {tag.name}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewTrade(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateTrade} disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating..." : "Create Trade"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Single delete confirmation */}
      <AlertDialog open={deletingId !== null} onOpenChange={(o) => { if (!o) setDeletingId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Trade</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this trade? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => deletingId !== null && deleteMutation.mutate({ id: deletingId })}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk tag dialog */}
      <Dialog open={showBulkTag} onOpenChange={(o) => { setShowBulkTag(o); if (!o) { setBulkTagAdd(new Set()); setBulkTagRemove(new Set()); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Tag {selected.size} Selected Trade{selected.size !== 1 ? "s" : ""}</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-4">
            <div>
              <p className="text-sm font-medium mb-2">Add tags</p>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <label key={tag.id} className="flex items-center gap-1.5 cursor-pointer">
                    <Checkbox
                      checked={bulkTagAdd.has(tag.id)}
                      onCheckedChange={() => {
                        setBulkTagAdd((prev) => {
                          const next = new Set(prev);
                          if (next.has(tag.id)) next.delete(tag.id); else next.add(tag.id);
                          return next;
                        });
                        // Can't add and remove same tag
                        setBulkTagRemove((prev) => {
                          const next = new Set(prev);
                          next.delete(tag.id);
                          return next;
                        });
                      }}
                    />
                    <span className="text-sm" style={{ color: tag.color ?? undefined }}>{tag.name}</span>
                  </label>
                ))}
              </div>
            </div>
            <Separator />
            <div>
              <p className="text-sm font-medium mb-2">Remove tags</p>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <label key={tag.id} className="flex items-center gap-1.5 cursor-pointer">
                    <Checkbox
                      checked={bulkTagRemove.has(tag.id)}
                      onCheckedChange={() => {
                        setBulkTagRemove((prev) => {
                          const next = new Set(prev);
                          if (next.has(tag.id)) next.delete(tag.id); else next.add(tag.id);
                          return next;
                        });
                        // Can't add and remove same tag
                        setBulkTagAdd((prev) => {
                          const next = new Set(prev);
                          next.delete(tag.id);
                          return next;
                        });
                      }}
                    />
                    <span className="text-sm" style={{ color: tag.color ?? undefined }}>{tag.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkTag(false)}>Cancel</Button>
            <Button
              onClick={() =>
                bulkAssignTagsMutation.mutate({
                  tradeIds: Array.from(selected),
                  addTagIds: Array.from(bulkTagAdd),
                  removeTagIds: Array.from(bulkTagRemove),
                })
              }
              disabled={bulkAssignTagsMutation.isPending || (bulkTagAdd.size === 0 && bulkTagRemove.size === 0)}
            >
              {bulkAssignTagsMutation.isPending ? "Applying..." : "Apply Tags"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk strategy dialog */}
      <Dialog open={showBulkStrategy} onOpenChange={(o) => setShowBulkStrategy(o)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Set Strategy for {selected.size} Trade{selected.size !== 1 ? "s" : ""}</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <Select value={bulkStrategyId} onValueChange={setBulkStrategyId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a strategy" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="clear">
                  <span className="text-muted-foreground">Remove strategy</span>
                </SelectItem>
                {strategies.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    <span className="flex items-center gap-2">
                      {s.color && (
                        <span className="h-2 w-2 rounded-full inline-block" style={{ backgroundColor: s.color }} />
                      )}
                      {s.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkStrategy(false)}>Cancel</Button>
            <Button
              onClick={() =>
                bulkSetStrategyMutation.mutate({
                  tradeIds: Array.from(selected),
                  strategyId: bulkStrategyId === "clear" ? null : Number(bulkStrategyId),
                })
              }
              disabled={bulkSetStrategyMutation.isPending || bulkStrategyId === "none"}
            >
              {bulkSetStrategyMutation.isPending ? "Applying..." : "Apply Strategy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk delete confirmation */}
      <AlertDialog open={showBulkDelete} onOpenChange={setShowBulkDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selected.size} Trades</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selected.size} selected trades? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => deleteBulkMutation.mutate({ ids: Array.from(selected) })}
            >
              Delete All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
