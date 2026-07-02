import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import DashboardLayout from "../components/DashboardLayout";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { trpc } from "../lib/trpc";
import { useAuth } from "../contexts/AuthContext";

export default function Settings() {
  const { user } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const mutation = trpc.auth.changePassword.useMutation({
    onSuccess: () => {
      toast.success("Password changed");
      setCurrent("");
      setNext("");
      setConfirm("");
    },
    onError: (err) => toast.error(err.message ?? "Failed to change password"),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (next.length < 8) {
      toast.error("New password must be at least 8 characters");
      return;
    }
    if (next !== confirm) {
      toast.error("New password and confirmation don't match");
      return;
    }
    mutation.mutate({ currentPassword: current, newPassword: next });
  }

  const inputClass =
    "h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-ring";

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-sm text-muted-foreground">Account settings</p>
        </div>

        <Card className="bg-card/60 max-w-md">
          <CardContent className="pt-5 pb-5 space-y-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                Signed in as
              </p>
              <p className="text-sm font-medium">{user?.email}</p>
            </div>

            <div className="border-t border-border/40 pt-4">
              <p className="text-sm font-semibold mb-3">Change password</p>
              <form onSubmit={handleSubmit} className="space-y-3">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">
                    Current password
                  </span>
                  <input
                    type="password"
                    autoComplete="current-password"
                    required
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                    className={inputClass}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">
                    New password
                  </span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                    className={inputClass}
                  />
                  <span className="text-[10px] text-muted-foreground">Minimum 8 characters</span>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">
                    Confirm new password
                  </span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className={inputClass}
                  />
                </label>
                <Button type="submit" disabled={mutation.isPending} className="w-full gap-1.5">
                  {mutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {mutation.isPending ? "Changing…" : "Change password"}
                </Button>
              </form>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
