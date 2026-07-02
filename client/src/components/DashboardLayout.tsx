import React from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  List,
  BarChart2,
  CalendarDays,
  Upload,
  Wallet,
  Tag,
  Target,
  TrendingUp,
  LogOut,
  ChevronDown,
  Calendar,
  AlertTriangle,
  Menu,
  X,
  FlaskConical,
  Settings,
} from "lucide-react";
import { toast } from "sonner";

import { trpc } from "../lib/trpc";
import { useAuth } from "../contexts/AuthContext";
import { useAccount } from "../contexts/AccountContext";
import { useStrategy } from "../contexts/StrategyContext";
import { useDateRange, type DatePreset } from "../contexts/DateRangeContext";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";

// ---------------------------------------------------------------------------
// Nav item definition
// ---------------------------------------------------------------------------

interface NavItem {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/" },
  { label: "Trade Log", icon: List, href: "/trades" },
  { label: "Analytics", icon: BarChart2, href: "/analytics" },
  { label: "Calendar", icon: CalendarDays, href: "/calendar" },
  { label: "Import", icon: Upload, href: "/import" },
  { label: "Accounts", icon: Wallet, href: "/accounts" },
  { label: "Tags", icon: Tag, href: "/tags" },
  { label: "Strategies", icon: Target, href: "/strategies" },
  { label: "Backtesting", icon: FlaskConical, href: "/backtest" },
  { label: "Settings", icon: Settings, href: "/settings" },
];

// ---------------------------------------------------------------------------
// Account selector (inline, no Radix Select required)
// ---------------------------------------------------------------------------

function AccountSelector() {
  const { accounts, selectedAccountId, setSelectedAccountId } = useAccount();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  // Close on outside click
  React.useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selected =
    selectedAccountId === null
      ? "All Accounts"
      : (accounts.find((a) => a.id === selectedAccountId)?.name ?? "Account");

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent focus:outline-none"
      >
        <span className="flex items-center gap-2 truncate">
          <Wallet className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{selected}</span>
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border border-border bg-popover shadow-lg">
          {/* All Accounts */}
          <button
            className={cn(
              "flex w-full items-center px-3 py-2 text-sm transition-colors hover:bg-accent",
              selectedAccountId === null
                ? "text-primary font-medium"
                : "text-foreground"
            )}
            onClick={() => {
              setSelectedAccountId(null);
              setOpen(false);
            }}
          >
            All Accounts
          </button>

          {accounts.map((acct) => (
            <button
              key={acct.id}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-accent",
                selectedAccountId === acct.id
                  ? "text-primary font-medium"
                  : "text-foreground"
              )}
              onClick={() => {
                setSelectedAccountId(acct.id);
                setOpen(false);
              }}
            >
              {acct.color && (
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: acct.color }}
                />
              )}
              <span className="truncate">{acct.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Strategy selector (inline, no Radix Select required)
// ---------------------------------------------------------------------------

function StrategySelector() {
  const { selectedStrategyId, setSelectedStrategyId } = useStrategy();
  const { data: strategies = [] } = trpc.strategy.list.useQuery();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selected =
    selectedStrategyId === null
      ? "All Strategies"
      : (strategies.find((s) => s.id === selectedStrategyId)?.name ?? "Strategy");

  if (strategies.length === 0) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent focus:outline-none"
      >
        <span className="flex items-center gap-2 truncate">
          <Target className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{selected}</span>
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border border-border bg-popover shadow-lg">
          <button
            className={cn(
              "flex w-full items-center px-3 py-2 text-sm transition-colors hover:bg-accent",
              selectedStrategyId === null
                ? "text-primary font-medium"
                : "text-foreground"
            )}
            onClick={() => {
              setSelectedStrategyId(null);
              setOpen(false);
            }}
          >
            All Strategies
          </button>

          {strategies.map((s) => (
            <button
              key={s.id}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-accent",
                selectedStrategyId === s.id
                  ? "text-primary font-medium"
                  : "text-foreground"
              )}
              onClick={() => {
                setSelectedStrategyId(s.id);
                setOpen(false);
              }}
            >
              {s.color && (
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
              )}
              <span className="truncate">{s.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Date range selector (sidebar-friendly)
// ---------------------------------------------------------------------------

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: "all", label: "All Time" },
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 Days" },
  { value: "30d", label: "Last 30 Days" },
  { value: "90d", label: "Last 90 Days" },
  { value: "ytd", label: "Year to Date" },
];

function DateRangeSelector() {
  const { preset, label, setPreset, setCustomRange, dateRange } = useDateRange();
  const [open, setOpen] = React.useState(false);
  const [showCustom, setShowCustom] = React.useState(false);
  const [customFrom, setCustomFrom] = React.useState("");
  const [customTo, setCustomTo] = React.useState("");
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setShowCustom(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent focus:outline-none"
      >
        <span className="flex items-center gap-2 truncate">
          <Calendar className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{label}</span>
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border border-border bg-popover shadow-lg">
          {DATE_PRESETS.map((p) => (
            <button
              key={p.value}
              className={cn(
                "flex w-full items-center px-3 py-2 text-sm transition-colors hover:bg-accent",
                preset === p.value && !showCustom
                  ? "text-primary font-medium"
                  : "text-foreground"
              )}
              onClick={() => {
                setPreset(p.value);
                setShowCustom(false);
                setOpen(false);
              }}
            >
              {p.label}
            </button>
          ))}
          <div className="border-t border-border" />
          <button
            className={cn(
              "flex w-full items-center px-3 py-2 text-sm transition-colors hover:bg-accent",
              preset === "custom"
                ? "text-primary font-medium"
                : "text-foreground"
            )}
            onClick={() => setShowCustom((v) => !v)}
          >
            Custom Range
          </button>
          {showCustom && (
            <div className="px-3 pb-3 pt-1 space-y-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">From</label>
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">To</label>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <Button
                size="sm"
                className="w-full"
                onClick={() => {
                  const from = customFrom ? new Date(customFrom + "T00:00:00") : null;
                  const to = customTo ? new Date(customTo + "T23:59:59") : null;
                  setCustomRange(from, to);
                  setOpen(false);
                  setShowCustom(false);
                }}
              >
                Apply
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function Sidebar({
  mobileOpen,
  onMobileClose,
}: {
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  const [location, navigate] = useLocation();
  const { user, refetch } = useAuth();

  // Lightweight duplicate-trade count so the nav can flag a warning next to
  // Trade Log when duplicates exist. Refresh once a minute in the background
  // so deletions elsewhere clear the indicator without a hard reload.
  const { data: dupCount } = trpc.trade.duplicateCount.useQuery(undefined, {
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const dupGroups = dupCount?.groups ?? 0;
  const dupExtras = dupCount?.extras ?? 0;

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      refetch();
      navigate("/login");
    },
    onError: (err) => {
      toast.error(err.message ?? "Logout failed");
    },
  });

  function isActive(href: string) {
    if (href === "/") return location === "/";
    return location.startsWith(href);
  }

  return (
    <>
      {/* Mobile backdrop — clicking outside the drawer closes it */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/60 transition-opacity md:hidden",
          mobileOpen
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        )}
        onClick={onMobileClose}
        aria-hidden="true"
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-card transition-transform duration-200 md:w-60 md:translate-x-0 md:z-30",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
      {/* Logo + mobile close button */}
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
          <TrendingUp className="h-4 w-4 text-primary-foreground" />
        </div>
        <span className="flex-1 text-base font-semibold tracking-tight text-foreground">
          Tradefolio
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 md:hidden"
          onClick={onMobileClose}
          aria-label="Close menu"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Scrollable content */}
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-3">
        {/* Account selector */}
        <AccountSelector />

        {/* Strategy selector */}
        <StrategySelector />

        {/* Date range */}
        <DateRangeSelector />

        {/* Nav */}
        <nav className="flex flex-1 flex-col gap-0.5">
          {NAV_ITEMS.map(({ label, icon: Icon, href }) => {
            const showDupBadge = href === "/trades" && dupGroups > 0;
            const dupTitle = showDupBadge
              ? `${dupExtras} duplicate trade${dupExtras !== 1 ? "s" : ""} across ${dupGroups} group${dupGroups !== 1 ? "s" : ""} — open Trade Log to review`
              : undefined;
            return (
              <Link
                key={href}
                href={href}
                title={dupTitle}
                onClick={onMobileClose}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  isActive(href)
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex-1">{label}</span>
                {showDupBadge && (
                  <span
                    className="flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400"
                    aria-label={dupTitle}
                  >
                    <AlertTriangle className="h-3 w-3" />
                    {dupExtras}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Footer: user + logout */}
      <div className="shrink-0 border-t border-border p-3">
        <div className="mb-2 flex items-center gap-2 rounded-md px-2 py-1.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground uppercase">
            {user?.email?.[0] ?? "?"}
          </div>
          <span className="flex-1 truncate text-xs text-muted-foreground">
            {user?.email}
          </span>
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground hover:text-destructive-foreground hover:bg-destructive/10"
          onClick={() => logoutMutation.mutate()}
          disabled={logoutMutation.isPending}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {logoutMutation.isPending ? "Logging out…" : "Logout"}
        </Button>
      </div>
    </aside>
    </>
  );
}

// ---------------------------------------------------------------------------
// Layout wrapper
// ---------------------------------------------------------------------------

export interface DashboardLayoutProps {
  children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      {/* Main content — offset by sidebar width on md+; full width on mobile */}
      <div className="flex min-h-screen flex-1 flex-col md:ml-60">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card/95 px-4 backdrop-blur md:hidden">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary">
              <TrendingUp className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
            <span className="text-sm font-semibold tracking-tight text-foreground">
              Tradefolio
            </span>
          </div>
        </header>

        <main className="flex flex-1 flex-col overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

export default DashboardLayout;
