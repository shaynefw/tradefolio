import { createContext, useContext, useState, useEffect } from "react";
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
  const [selectedAccountId, setSelectedAccountIdState] = useState<number | null>(() => {
    const stored = localStorage.getItem("tradefolio_account");
    return stored ? parseInt(stored, 10) : null;
  });

  useEffect(() => {
    if (!isLoading && accounts.length > 0 && selectedAccountId === null) {
      const def = accounts.find((a) => a.isDefault) ?? accounts[0];
      if (def) setSelectedAccountIdState(def.id);
    }
  }, [isLoading, accounts, selectedAccountId]);

  const setSelectedAccountId = (id: number | null) => {
    setSelectedAccountIdState(id);
    if (id === null) {
      localStorage.removeItem("tradefolio_account");
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
