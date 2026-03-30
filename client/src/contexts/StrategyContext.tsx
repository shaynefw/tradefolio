import { createContext, useContext, useState } from "react";

interface StrategyContextValue {
  selectedStrategyId: number | null;
  setSelectedStrategyId: (id: number | null) => void;
}

const StrategyContext = createContext<StrategyContextValue>({
  selectedStrategyId: null,
  setSelectedStrategyId: () => {},
});

export function StrategyProvider({ children }: { children: React.ReactNode }) {
  const [selectedStrategyId, setSelectedStrategyId] = useState<number | null>(null);
  return (
    <StrategyContext.Provider value={{ selectedStrategyId, setSelectedStrategyId }}>
      {children}
    </StrategyContext.Provider>
  );
}

export function useStrategy() {
  return useContext(StrategyContext);
}
