import { createContext, useContext, useState } from "react";
import { startOfMonth, endOfDay } from "date-fns";

interface DateRange {
  from: Date | undefined;
  to: Date | undefined;
}

interface DateRangeContextValue {
  dateRange: DateRange;
  setDateRange: (range: DateRange) => void;
  startDate: number | undefined;
  endDate: number | undefined;
}

const DateRangeContext = createContext<DateRangeContextValue>({
  dateRange: { from: undefined, to: undefined },
  setDateRange: () => {},
  startDate: undefined,
  endDate: undefined,
});

export function DateRangeProvider({ children }: { children: React.ReactNode }) {
  const [dateRange, setDateRange] = useState<DateRange>({
    from: startOfMonth(new Date()),
    to: endOfDay(new Date()),
  });

  const startDate = dateRange.from?.getTime();
  const endDate = dateRange.to ? endOfDay(dateRange.to).getTime() : undefined;

  return (
    <DateRangeContext.Provider value={{ dateRange, setDateRange, startDate, endDate }}>
      {children}
    </DateRangeContext.Provider>
  );
}

export function useDateRange() {
  return useContext(DateRangeContext);
}
