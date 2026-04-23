import { createContext, useContext, useState, useEffect, useRef } from "react";
import { trpc } from "../lib/trpc";

interface AccountContextValue {
  selectedAccountId: number | null;
  setSelectedAccountId: (id: number | null) => void;
  accounts: Array<{ id: number; name: string; color: string | null; isDefault: boolean }>;
  isLoading: boolean;
}

const AccountContext = createContext<AccountContextValue>({
  selectedAccountId: null,
  setSelectedAccountId: () => {},
  accounts: [],
  isLoading: true,
});

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const { data: accounts = [], isLoading } = trpc.account.list.useQuery();
  const hasInitialized = useRef(false);
  const [selectedAccountId, setSelectedAccountIdState] = useState<number | null>(() => {
    const stored = localStorage.getItem("tradefolio_account");
    if (stored === "all") return null; // explicit "All Accounts"
    return stored ? parseInt(stored, 10) : null;
  });

  // Only auto-select the default account on first load if the user hasn't
  // previously chosen "All Accounts" (stored as "all" in localStorage).
  useEffect(() => {
    if (!isLoading && accounts.length > 0 && !hasInitialized.current) {
      hasInitialized.current = true;
      const stored = localStorage.getItem("tradefolio_account");
      // If stored is "all", user explicitly chose All Accounts — keep null
      if (stored === "all") return;
      // If no stored value and selectedAccountId is null, pick default
      if (selectedAccountId === null && !stored) {
        const def = accounts.find((a) => a.isDefault) ?? accounts[0];
        if (def) setSelectedAccountIdState(def.id);
      }
    }
  }, [isLoading, accounts, selectedAccountId]);

  const setSelectedAccountId = (id: number | null) => {
    setSelectedAccountIdState(id);
    if (id === null) {
      localStorage.setItem("tradefolio_account", "all");
    } else {
      localStorage.setItem("tradefolio_account", String(id));
    }
  };

  return (
    <AccountContext.Provider value={{ selectedAccountId, setSelectedAccountId, accounts, isLoading }}>
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount() {
  return useContext(AccountContext);
}
