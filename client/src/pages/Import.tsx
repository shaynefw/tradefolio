import React, { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Upload, FileText, X, AlertTriangle, CheckCircle2,
  ChevronRight, Info, Zap,
} from "lucide-react";

import DashboardLayout from "../components/DashboardLayout";
import { trpc } from "../lib/trpc";
import { cn, formatCurrency } from "../lib/utils";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { Checkbox } from "../components/ui/checkbox";
import { Separator } from "../components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Badge } from "../components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";

// ---------------------------------------------------------------------------
// Futures multipliers ($ per point)
// ---------------------------------------------------------------------------
const FUTURES_MULTIPLIERS: Record<string, number> = {
  MNQ: 2, NQ: 20, MES: 5, ES: 50, M2K: 5, RTY: 50,
  MYM: 0.5, YM: 5, MCL: 100, CL: 1000, MGC: 10, GC: 100,
  MSI: 500, SI: 5000, HG: 25000, ZB: 1000, ZN: 1000,
  "6E": 125000, "6J": 12500000, "6B": 62500, "6A": 100000, "6C": 100000,
};

function getFuturesMultiplier(symbol: string): number {
  // Strip expiry suffix (MNQH6 → MNQ, ESZ5 → ES)
  const base = symbol.replace(/[FGHJKMNQUVXZ]\d{1,2}$/, "");
  return FUTURES_MULTIPLIERS[base] ?? FUTURES_MULTIPLIERS[symbol] ?? 1;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ParsedTrade {
  symbol: string;
  side: string;
  entryDate?: string | null;
  exitDate?: string | null;
  entryPrice?: string | null;
  exitPrice?: string | null;
  quantity?: string | null;
  pnl?: string | null;
  fees?: string | null;
  notes?: string | null;
}

interface ParseResult {
  trades: ParsedTrade[];
  warnings: string[];
  detectedFormat: "tradovate" | "trade-level" | "unknown";
  columnMap: Record<string, string>;
  rawRowCount: number;
}

// ---------------------------------------------------------------------------
// CSV line parser (handles quoted fields with commas)
// ---------------------------------------------------------------------------
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

// ---------------------------------------------------------------------------
// Tradovate order-level parser
// Tradovate CSVs have: B/S, Contract, Product, Fill Time, Status, Filled Qty, Avg Fill Price
// ---------------------------------------------------------------------------
function isTradovateFormat(headers: string[]): boolean {
  const norm = headers.map((h) => h.toLowerCase().trim());
  return (
    norm.some((h) => h === "b/s") &&
    norm.some((h) => h.includes("fill time")) &&
    norm.some((h) => h.includes("contract") || h.includes("product"))
  );
}

function parseTradovateCSV(lines: string[], headers: string[]): ParseResult {
  const warnings: string[] = [];

  const hTrimmed = headers.map((h) => h.trim());
  const col = (name: string) => hTrimmed.findIndex((h) => h.toLowerCase() === name.toLowerCase());

  const bsIdx          = col("B/S");
  const contractIdx    = col("Contract");
  const productIdx     = col("Product");
  const fillTimeIdx    = col("Fill Time");
  const statusIdx      = col("Status");
  const filledQtyIdx   = col("Filled Qty");
  const avgPriceIdx    = col("Avg Fill Price");

  if (bsIdx === -1 || fillTimeIdx === -1 || statusIdx === -1) {
    warnings.push("Could not find required Tradovate columns (B/S, Fill Time, Status).");
    return { trades: [], warnings, detectedFormat: "tradovate", columnMap: {}, rawRowCount: 0 };
  }

  // Parse only Filled rows
  interface Fill {
    symbol: string;
    side: "buy" | "sell";
    fillTime: Date;
    price: number;
    qty: number;
  }

  const fills: Fill[] = [];
  let canceledCount = 0;

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = parseCSVLine(lines[i]);
    const status = (cols[statusIdx] ?? "").trim();

    if (status !== "Filled") {
      if (status === "Canceled") canceledCount++;
      continue;
    }

    const bs = (cols[bsIdx] ?? "").trim().toLowerCase();
    const side = bs === "buy" ? "buy" : bs === "sell" ? "sell" : null;
    if (!side) continue;

    // Prefer Product (MNQ) over Contract (MNQH6) for cleaner symbol
    const rawSymbol =
      productIdx !== -1
        ? (cols[productIdx] ?? "").trim()
        : (cols[contractIdx] ?? "").trim();
    const symbol = rawSymbol.toUpperCase();
    if (!symbol) continue;

    const fillTimeStr = (cols[fillTimeIdx] ?? "").trim();
    const fillTime = new Date(fillTimeStr);
    if (isNaN(fillTime.getTime())) {
      warnings.push(`Row ${i + 1}: could not parse fill time "${fillTimeStr}"`);
      continue;
    }

    const price = parseFloat((cols[avgPriceIdx] ?? "").replace(/,/g, ""));
    const qty   = parseFloat((cols[filledQtyIdx] ?? "").replace(/,/g, ""));

    if (isNaN(price) || isNaN(qty) || qty <= 0) continue;

    fills.push({ symbol, side, fillTime, price, qty });
  }

  if (canceledCount > 0) {
    warnings.push(`Skipped ${canceledCount} canceled orders (only Filled orders are imported).`);
  }

  if (fills.length === 0) {
    warnings.push("No filled orders found in the CSV.");
    return { trades: [], warnings, detectedFormat: "tradovate", columnMap: {}, rawRowCount: 0 };
  }

  // Sort fills chronologically
  fills.sort((a, b) => a.fillTime.getTime() - b.fillTime.getTime());

  // FIFO position matching per symbol
  interface OpenPosition {
    side: "long" | "short";
    qty: number;
    entryPrice: number;
    entryTime: Date;
  }

  const openPositions = new Map<string, OpenPosition[]>();
  const trades: ParsedTrade[] = [];

  for (const fill of fills) {
    const positions = openPositions.get(fill.symbol) ?? [];
    const closingSide = fill.side === "buy" ? "short" : "long";
    const existingPos = positions.find((p) => p.side === closingSide);

    if (existingPos) {
      // Closing an existing position (partially or fully)
      const closedQty = Math.min(fill.qty, existingPos.qty);
      const multiplier = getFuturesMultiplier(fill.symbol);

      const pnl =
        existingPos.side === "long"
          ? (fill.price - existingPos.entryPrice) * closedQty * multiplier
          : (existingPos.entryPrice - fill.price) * closedQty * multiplier;

      trades.push({
        symbol: fill.symbol,
        side: existingPos.side,
        entryDate: existingPos.entryTime.toISOString(),
        exitDate:  fill.fillTime.toISOString(),
        entryPrice: String(existingPos.entryPrice),
        exitPrice:  String(fill.price),
        quantity:   String(closedQty),
        pnl:        pnl.toFixed(2),
        fees:       null,
      });

      existingPos.qty -= closedQty;
      const remaining = fill.qty - closedQty;

      if (existingPos.qty <= 0) {
        openPositions.set(fill.symbol, positions.filter((p) => p !== existingPos));
      }

      // If fill was larger than position, open new position in opposite direction
      if (remaining > 0) {
        const newSide = fill.side === "buy" ? "long" : "short";
        const pos2 = openPositions.get(fill.symbol) ?? [];
        pos2.push({ side: newSide, qty: remaining, entryPrice: fill.price, entryTime: fill.fillTime });
        openPositions.set(fill.symbol, pos2);
      }
    } else {
      // Opening a new position (or adding to existing same-side position)
      const sameSide = fill.side === "buy" ? "long" : "short";
      const existingSame = positions.find((p) => p.side === sameSide);

      if (existingSame) {
        // Weighted average entry
        const totalQty = existingSame.qty + fill.qty;
        existingSame.entryPrice =
          (existingSame.entryPrice * existingSame.qty + fill.price * fill.qty) / totalQty;
        existingSame.qty = totalQty;
      } else {
        positions.push({
          side: sameSide,
          qty: fill.qty,
          entryPrice: fill.price,
          entryTime: fill.fillTime,
        });
        openPositions.set(fill.symbol, positions);
      }
    }
  }

  // Remaining open positions → open trades
  for (const [symbol, positions] of openPositions) {
    for (const pos of positions) {
      if (pos.qty > 0) {
        trades.push({
          symbol,
          side: pos.side,
          entryDate: pos.entryTime.toISOString(),
          exitDate: null,
          entryPrice: String(pos.entryPrice),
          exitPrice: null,
          quantity: String(pos.qty),
          pnl: null,
          fees: null,
        });
      }
    }
  }

  const columnMap = {
    symbol: productIdx !== -1 ? "Product" : "Contract",
    side: "B/S",
    fillTime: "Fill Time",
    price: "Avg Fill Price",
    quantity: "Filled Qty",
    status: "Status",
  };

  return {
    trades,
    warnings,
    detectedFormat: "tradovate",
    columnMap,
    rawRowCount: fills.length,
  };
}

// ---------------------------------------------------------------------------
// Generic trade-level CSV parser
// ---------------------------------------------------------------------------
const SYMBOL_ALIASES    = ["symbol", "ticker", "product", "instrument", "contract", "asset", "name"];
const SIDE_ALIASES      = ["side", "direction", "type", "action", "position", "b/s"];
const ENTRY_DATE_ALIASES= ["entry_date", "entrydate", "open_date", "opendate", "date_opened", "entry", "date", "open"];
const EXIT_DATE_ALIASES = ["exit_date", "exitdate", "close_date", "closedate", "date_closed", "close", "exit"];
const ENTRY_PRICE_ALIASES=["entry_price","entryprice","buy_price","open_price","avg_entry","avg_open","entry"];
const EXIT_PRICE_ALIASES =["exit_price","exitprice","sell_price","close_price","avg_exit","avg_close","exit"];
const QTY_ALIASES       = ["quantity","qty","size","shares","contracts","units","filled_qty"];
const PNL_ALIASES       = ["pnl","p&l","profit_loss","profit/loss","realized_pnl","realized","gain_loss","net_profit","profit","return"];
const FEES_ALIASES      = ["fees","commission","commissions","fee","charges","cost"];

function normalizeHeader(h: string) {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "_").trim();
}
function findCol(headers: string[], aliases: string[]) {
  const norm = headers.map(normalizeHeader);
  for (const a of aliases) {
    const idx = norm.indexOf(a);
    if (idx !== -1) return idx;
  }
  for (const a of aliases) {
    const idx = norm.findIndex((h) => h.includes(a));
    if (idx !== -1) return idx;
  }
  return -1;
}

function detectSide(value: string): string {
  const v = value.toLowerCase().trim();
  if (["long", "buy", "bought", "b"].includes(v)) return "long";
  if (["short", "sell", "sold", "s"].includes(v)) return "short";
  return v;
}

function parseTradeLevelCSV(lines: string[], headers: string[]): ParseResult {
  const warnings: string[] = [];

  const symIdx  = findCol(headers, SYMBOL_ALIASES);
  const sideIdx = findCol(headers, SIDE_ALIASES);
  const edIdx   = findCol(headers, ENTRY_DATE_ALIASES);
  const xdIdx   = findCol(headers, EXIT_DATE_ALIASES);
  const epIdx   = findCol(headers, ENTRY_PRICE_ALIASES);
  const xpIdx   = findCol(headers, EXIT_PRICE_ALIASES);
  const qtyIdx  = findCol(headers, QTY_ALIASES);
  const pnlIdx  = findCol(headers, PNL_ALIASES);
  const feesIdx = findCol(headers, FEES_ALIASES);

  if (symIdx  === -1) warnings.push("No 'symbol' column found.");
  if (sideIdx === -1) warnings.push("No 'side' column found. Expected: side, direction, B/S…");

  const columnMap: Record<string, string> = {};
  if (symIdx  !== -1) columnMap.symbol    = headers[symIdx];
  if (sideIdx !== -1) columnMap.side      = headers[sideIdx];
  if (edIdx   !== -1) columnMap.entryDate = headers[edIdx];
  if (xdIdx   !== -1) columnMap.exitDate  = headers[xdIdx];
  if (epIdx   !== -1) columnMap.entryPrice= headers[epIdx];
  if (xpIdx   !== -1) columnMap.exitPrice = headers[xpIdx];
  if (qtyIdx  !== -1) columnMap.quantity  = headers[qtyIdx];
  if (pnlIdx  !== -1) columnMap.pnl       = headers[pnlIdx];
  if (feesIdx !== -1) columnMap.fees      = headers[feesIdx];

  const trades: ParsedTrade[] = [];

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = parseCSVLine(lines[i]);
    const symbol = symIdx !== -1 ? (cols[symIdx] ?? "").trim().toUpperCase() : "";
    if (!symbol) continue;
    const rawSide = sideIdx !== -1 ? (cols[sideIdx] ?? "") : "";
    trades.push({
      symbol,
      side: detectSide(rawSide),
      entryDate:  edIdx   !== -1 ? cols[edIdx]   || null : null,
      exitDate:   xdIdx   !== -1 ? cols[xdIdx]   || null : null,
      entryPrice: epIdx   !== -1 ? cols[epIdx]   || null : null,
      exitPrice:  xpIdx   !== -1 ? cols[xpIdx]   || null : null,
      quantity:   qtyIdx  !== -1 ? cols[qtyIdx]  || null : null,
      pnl:        pnlIdx  !== -1 ? cols[pnlIdx]  || null : null,
      fees:       feesIdx !== -1 ? cols[feesIdx] || null : null,
    });
  }

  if (trades.length === 0) {
    warnings.push("No valid data rows found.");
  }

  return {
    trades,
    warnings,
    detectedFormat: "trade-level",
    columnMap,
    rawRowCount: lines.length - 1,
  };
}

// ---------------------------------------------------------------------------
// Main parse dispatcher
// ---------------------------------------------------------------------------
function parseCSV(text: string): ParseResult {
  // Strip BOM
  const cleaned = text.replace(/^\uFEFF/, "");
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim().length > 0);

  if (lines.length < 2) {
    return {
      trades: [], warnings: ["File appears empty."],
      detectedFormat: "unknown", columnMap: {}, rawRowCount: 0,
    };
  }

  const headers = parseCSVLine(lines[0]);

  if (isTradovateFormat(headers)) {
    return parseTradovateCSV(lines, headers);
  }

  return parseTradeLevelCSV(lines, headers);
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function FormatBadge({ format }: { format: ParseResult["detectedFormat"] }) {
  if (format === "tradovate") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-500/15 px-2.5 py-0.5 text-xs font-medium text-violet-400">
        <Zap className="h-3 w-3" />
        Tradovate order-level (auto-detected)
      </span>
    );
  }
  if (format === "trade-level") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/15 px-2.5 py-0.5 text-xs font-medium text-blue-400">
        Trade-level (auto-detected)
      </span>
    );
  }
  return null;
}

function ColumnMapTable({ map }: { map: Record<string, string> }) {
  const entries = Object.entries(map);
  if (entries.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
        <Info className="h-3.5 w-3.5" /> Detected column mapping
      </p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        {entries.map(([field, col]) => (
          <div key={field} className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground w-20 shrink-0 capitalize">{field}:</span>
            <span className="font-mono text-foreground">{col}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PreviewTable({ trades }: { trades: ParsedTrade[] }) {
  const preview = trades.slice(0, 10);
  if (preview.length === 0) return null;

  const fmt = (v: string | null | undefined) =>
    v ? parseFloat(v).toLocaleString("en-US", { maximumFractionDigits: 4 }) : "—";
  const fmtDate = (v: string | null | undefined) => {
    if (!v) return "—";
    try { return new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit", hour: "2-digit", minute: "2-digit" }); }
    catch { return v; }
  };
  const fmtPnl = (v: string | null | undefined) => {
    if (!v) return "—";
    const n = parseFloat(v);
    return (
      <span className={n >= 0 ? "text-green-400" : "text-red-400"}>
        {n >= 0 ? "+" : ""}${Math.abs(n).toFixed(2)}
      </span>
    );
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            {["Symbol","Side","Entry Date","Exit Date","Entry $","Exit $","Qty","P&L"].map((h) => (
              <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {preview.map((row, i) => (
            <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
              <td className="px-3 py-2 font-mono font-medium">{row.symbol}</td>
              <td className="px-3 py-2">
                <Badge variant="outline" className={cn("text-[10px]",
                  row.side === "long"  ? "border-blue-700 text-blue-400" :
                  row.side === "short" ? "border-orange-700 text-orange-400" :
                                        "border-border text-muted-foreground")}>
                  {row.side || "—"}
                </Badge>
              </td>
              <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{fmtDate(row.entryDate)}</td>
              <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{fmtDate(row.exitDate)}</td>
              <td className="px-3 py-2">{fmt(row.entryPrice)}</td>
              <td className="px-3 py-2">{fmt(row.exitPrice)}</td>
              <td className="px-3 py-2">{row.quantity || "—"}</td>
              <td className="px-3 py-2">{fmtPnl(row.pnl)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {trades.length > 10 && (
        <div className="px-3 py-2 text-xs text-muted-foreground border-t border-border bg-muted/20">
          Showing first 10 of {trades.length} matched trades
        </div>
      )}
    </div>
  );
}

function DropZone({ onFile, file, onClear }: { onFile: (f: File) => void; file: File | null; onClear: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped?.name.endsWith(".csv")) onFile(dropped);
    else toast.error("Please drop a .csv file.");
  }, [onFile]);

  if (file) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
        <FileText className="h-5 w-5 shrink-0 text-primary" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{file.name}</p>
          <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
        </div>
        <button onClick={onClear} className="text-muted-foreground hover:text-destructive transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-8 py-12 cursor-pointer transition-colors",
        dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"
      )}
    >
      <Upload className={cn("h-8 w-8", dragging ? "text-primary" : "text-muted-foreground")} />
      <div className="text-center">
        <p className="text-sm font-medium">Drop your CSV file here</p>
        <p className="text-xs text-muted-foreground mt-1">or click to browse — .csv files only</p>
        <p className="text-xs text-muted-foreground mt-2">Supports Tradovate, NinjaTrader, generic trade-level CSVs</p>
      </div>
      <input ref={inputRef} type="file" accept=".csv" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// JSON Backup tab
// ---------------------------------------------------------------------------
function BackupImportTab() {
  const [jsonText, setJsonText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const accountsQuery = trpc.account.list.useQuery();
  const [accountId, setAccountId] = useState<string>("");

  const importMutation = trpc.backup.import.useMutation({
    onSuccess: (data) => { toast.success(`Backup imported: ${data.imported} trades added.`); setJsonText(""); },
    onError: (err) => { toast.error(err.message ?? "Import failed"); },
  });

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
        Restore from a Tradefolio JSON backup. Tags and accounts from the backup will be merged with your existing data.
      </div>
      <div className="space-y-2">
        <Label>JSON Backup</Label>
        <textarea
          className="w-full h-48 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
          placeholder='{"version": 1, "exportedAt": "...", "trades": [...], ...}'
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
        />
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload className="h-3.5 w-3.5 mr-1.5" /> Upload JSON file
          </Button>
          {jsonText && <span className="text-xs text-muted-foreground">{jsonText.length.toLocaleString()} chars</span>}
        </div>
        <input ref={fileRef} type="file" accept=".json" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = (ev) => setJsonText(ev.target?.result as string ?? ""); r.readAsText(f); }} />
      </div>
      <div className="space-y-2">
        <Label>Override Account (optional)</Label>
        <Select value={accountId} onValueChange={setAccountId}>
          <SelectTrigger className="w-72"><SelectValue placeholder="Use accounts from backup" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Use accounts from backup</SelectItem>
            {accountsQuery.data?.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Separator />
      <Button onClick={() => {
        if (!jsonText.trim()) { toast.error("Paste or upload a JSON backup file."); return; }
        importMutation.mutate({ data: jsonText, accountId: accountId && accountId !== "none" ? Number(accountId) : null });
      }} disabled={importMutation.isPending || !jsonText.trim()}>
        {importMutation.isPending ? "Importing…" : "Import Backup"}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function ImportTrades() {
  const [step, setStep]                 = useState<1 | 2 | 3>(1);
  const [file, setFile]                 = useState<File | null>(null);
  const [parseResult, setParseResult]   = useState<ParseResult | null>(null);
  const [accountId, setAccountId]       = useState<string>("");
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);

  const accountsQuery = trpc.account.list.useQuery();
  const utils = trpc.useUtils();

  const importMutation = trpc.trade.importCSV.useMutation({
    onSuccess: (data) => {
      setImportResult({ imported: data.imported, skipped: data.skipped });
      toast.success(`${data.imported} trade${data.imported !== 1 ? "s" : ""} imported.`);
      utils.trade.list.invalidate();
    },
    onError: (err) => toast.error(err.message ?? "Import failed"),
  });

  const handleFile = (f: File) => {
    setFile(f);
    setParseResult(null);
    setImportResult(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = (ev.target?.result as string) ?? "";
      const result = parseCSV(text);
      setParseResult(result);
      setStep(2);
    };
    reader.readAsText(f);
  };

  const handleClear = () => {
    setFile(null);
    setParseResult(null);
    setImportResult(null);
    setStep(1);
  };

  const handleImport = () => {
    if (!parseResult || parseResult.trades.length === 0) {
      toast.error("No trades to import.");
      return;
    }
    if (!accountId) {
      toast.error("Please select an account.");
      return;
    }
    importMutation.mutate({
      rows: parseResult.trades.map((r) => ({
        symbol: r.symbol,
        side: r.side,
        entryPrice:  r.entryPrice  ?? null,
        exitPrice:   r.exitPrice   ?? null,
        entryDate:   r.entryDate   ?? null,
        exitDate:    r.exitDate    ?? null,
        quantity:    r.quantity    ?? null,
        pnl:         r.pnl         ?? null,
        fees:        r.fees        ?? null,
        notes:       r.notes       ?? null,
      })),
      accountId: Number(accountId),
    });
  };

  const noAccounts = !accountsQuery.isLoading && (accountsQuery.data?.length ?? 0) === 0;

  return (
    <DashboardLayout>
      <div className="p-6 max-w-4xl mx-auto w-full">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Import Trades</h1>
          <p className="text-muted-foreground mt-1">
            Import your trade history from a CSV export or a Tradefolio JSON backup.
          </p>
        </div>

        {noAccounts && (
          <div className="mb-6 rounded-lg border border-amber-800/40 bg-amber-500/10 p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-400">No accounts yet</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Create a trading account first before importing trades. Go to <a href="/accounts" className="underline text-amber-400">Accounts</a>.
              </p>
            </div>
          </div>
        )}

        <Tabs defaultValue="csv">
          <TabsList className="mb-6">
            <TabsTrigger value="csv">CSV Import</TabsTrigger>
            <TabsTrigger value="backup">JSON Backup</TabsTrigger>
          </TabsList>

          <TabsContent value="csv" className="space-y-6">
            {/* Step 1 */}
            <div className="space-y-4">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">1</span>
                Upload CSV
              </h2>
              <DropZone onFile={handleFile} file={file} onClear={handleClear} />
            </div>

            {/* Step 2: Preview */}
            {step >= 2 && parseResult && (
              <>
                <Separator />
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-sm font-semibold flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">2</span>
                      Preview
                    </h2>
                    <div className="flex flex-wrap items-center gap-2">
                      <FormatBadge format={parseResult.detectedFormat} />
                      <Badge variant="secondary">{parseResult.trades.length} trades parsed</Badge>
                      {parseResult.detectedFormat === "tradovate" && (
                        <Badge variant="outline" className="text-muted-foreground text-xs">
                          from {parseResult.rawRowCount} filled orders
                        </Badge>
                      )}
                    </div>
                  </div>

                  {parseResult.warnings.length > 0 && (
                    <div className="rounded-lg border border-amber-800/40 bg-amber-500/10 p-3 space-y-1">
                      {parseResult.warnings.map((w, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-amber-400">
                          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          {w}
                        </div>
                      ))}
                    </div>
                  )}

                  <ColumnMapTable map={parseResult.columnMap} />
                  <PreviewTable trades={parseResult.trades} />

                  <Button onClick={() => setStep(3)} disabled={parseResult.trades.length === 0}>
                    Continue to Import <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </>
            )}

            {/* Step 3: Configure & Import */}
            {step >= 3 && parseResult && (
              <>
                <Separator />
                <div className="space-y-5">
                  <h2 className="text-sm font-semibold flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">3</span>
                    Configure &amp; Import
                  </h2>

                  <div className="space-y-2">
                    <Label>Account <span className="text-destructive">*</span></Label>
                    <Select value={accountId} onValueChange={setAccountId}>
                      <SelectTrigger className="w-72">
                        <SelectValue placeholder="Select account…" />
                      </SelectTrigger>
                      <SelectContent>
                        {accountsQuery.data?.map((a) => (
                          <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center gap-3">
                    <Checkbox
                      id="skip-dups"
                      checked={skipDuplicates}
                      onCheckedChange={(v) => setSkipDuplicates(Boolean(v))}
                    />
                    <Label htmlFor="skip-dups" className="cursor-pointer">
                      Skip duplicate trades (same symbol, side, prices &amp; dates)
                    </Label>
                  </div>

                  {importResult ? (
                    <div className="rounded-lg border border-green-800/40 bg-green-500/10 p-4 flex items-start gap-3">
                      <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-green-400">Import complete</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {importResult.imported} trade{importResult.imported !== 1 ? "s" : ""} imported
                          {importResult.skipped > 0 && `, ${importResult.skipped} skipped`}.
                        </p>
                        <Button variant="outline" size="sm" className="mt-3" onClick={handleClear}>
                          Import another file
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <Button
                        onClick={handleImport}
                        disabled={importMutation.isPending || !accountId || parseResult.trades.length === 0 || noAccounts}
                      >
                        {importMutation.isPending
                          ? "Importing…"
                          : `Import ${parseResult.trades.length} Trade${parseResult.trades.length !== 1 ? "s" : ""}`}
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        {parseResult.trades.length} trades ready
                      </span>
                    </div>
                  )}
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="backup">
            <BackupImportTab />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
