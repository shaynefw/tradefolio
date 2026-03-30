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
} from "lucide-react";
import { toast } from "sonner";

import { trpc } from "../lib/trpc";
import { useAuth } from "../contexts/AuthContext";
import { useAccount } from "../contexts/AccountContext";
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
// Sidebar
// ---------------------------------------------------------------------------

function Sidebar() {
  const [location, navigate] = useLocation();
  const { user, refetch } = useAuth();

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
    <aside className="fixed inset-y-0 left-0 z-30 flex w-60 flex-col border-r border-border bg-card">
      {/* Logo */}
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
          <TrendingUp className="h-4 w-4 text-primary-foreground" />
        </div>
        <span className="text-base font-semibold tracking-tight text-foreground">
          Tradefolio
        </span>
      </div>

      {/* Scrollable content */}
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-3">
        {/* Account selector */}
        <AccountSelector />

        {/* Nav */}
        <nav className="flex flex-1 flex-col gap-0.5">
          {NAV_ITEMS.map(({ label, icon: Icon, href }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                isActive(href)
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          ))}
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
  );
}

// ---------------------------------------------------------------------------
// Layout wrapper
// ---------------------------------------------------------------------------

export interface DashboardLayoutProps {
  children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />

      {/* Main content — offset by sidebar width */}
      <main className="ml-60 flex flex-1 flex-col overflow-y-auto">
        {children}
      </main>
    </div>
  );
}

export default DashboardLayout;
