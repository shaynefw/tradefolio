import React, { Suspense } from "react";
import { Router, Route, Switch, Redirect } from "wouter";
import { Toaster } from "sonner";

import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { AccountProvider } from "./contexts/AccountContext";
import { DateRangeProvider } from "./contexts/DateRangeContext";
import { StrategyProvider } from "./contexts/StrategyContext";

// Lazy-load all pages
const LoginPage = React.lazy(() => import("./pages/Login"));
const RegisterPage = React.lazy(() => import("./pages/Register"));
const DashboardHome = React.lazy(() => import("./pages/Home"));
const TradeLog = React.lazy(() => import("./pages/TradeLog"));
const TradeDetail = React.lazy(() => import("./pages/TradeDetail"));
const Analytics = React.lazy(() => import("./pages/Analytics"));
const CalendarView = React.lazy(() => import("./pages/Calendar"));
const ImportTrades = React.lazy(() => import("./pages/Import"));
const Accounts = React.lazy(() => import("./pages/Accounts"));
const Tags = React.lazy(() => import("./pages/Tags"));
const Strategies = React.lazy(() => import("./pages/Strategies"));
const NotFound = React.lazy(() => import("./pages/NotFound"));

function PageLoader() {
  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
    </div>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <PageLoader />;
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/login" component={LoginPage} />
        <Route path="/register" component={RegisterPage} />

        <Route path="/">
          {() => (
            <Protected>
              <DashboardHome />
            </Protected>
          )}
        </Route>

        <Route path="/trades">
          {() => (
            <Protected>
              <TradeLog />
            </Protected>
          )}
        </Route>

        <Route path="/trades/:id">
          {() => (
            <Protected>
              <TradeDetail />
            </Protected>
          )}
        </Route>

        <Route path="/analytics">
          {() => (
            <Protected>
              <Analytics />
            </Protected>
          )}
        </Route>

        <Route path="/calendar">
          {() => (
            <Protected>
              <CalendarView />
            </Protected>
          )}
        </Route>

        <Route path="/import">
          {() => (
            <Protected>
              <ImportTrades />
            </Protected>
          )}
        </Route>

        <Route path="/accounts">
          {() => (
            <Protected>
              <Accounts />
            </Protected>
          )}
        </Route>

        <Route path="/tags">
          {() => (
            <Protected>
              <Tags />
            </Protected>
          )}
        </Route>

        <Route path="/strategies">
          {() => (
            <Protected>
              <Strategies />
            </Protected>
          )}
        </Route>

        <Route>
          {() => (
            <Protected>
              <NotFound />
            </Protected>
          )}
        </Route>
      </Switch>
    </Suspense>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AccountProvider>
        <StrategyProvider>
        <DateRangeProvider>
          <Toaster
            position="top-right"
            theme="dark"
            toastOptions={{
              classNames: {
                toast: "bg-card border border-border text-foreground",
                error: "bg-card border border-destructive text-foreground",
                success: "bg-card border border-green-800 text-foreground",
              },
            }}
          />
          <Router>
            <AppRoutes />
          </Router>
        </DateRangeProvider>
        </StrategyProvider>
      </AccountProvider>
    </AuthProvider>
  );
}
