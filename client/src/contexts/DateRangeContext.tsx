import { createContext, useContext, useState, useCallback } from "react";
import { endOfDay, startOfDay, subDays, startOfYear, format } from "date-fns";

export type DatePreset = "all" | "today" | "7d" | "30d" | "90d" | "ytd" | "custom";

interface DateRange {
  from: Date | undefined;
  to: Date | undefined;
}

interface DateRangeContextValue {
  dateRange: DateRange;
  setDateRange: (range: DateRange) => void;
  startDate: number | undefined;
  endDate: number | undefined;
  preset: DatePreset;
  setPreset: (p: DatePreset) => void;
  setCustomRange: (from: Date | null, to: Date | null) => void;
  label: string;
}

function computeRange(preset: DatePreset): DateRange {
  const now = new Date();
  switch (preset) {
    case "today":
      return { from: startOfDay(now), to: endOfDay(now) };
    case "7d":
      return { from: startOfDay(subDays(now, 6)), to: endOfDay(now) };
    case "30d":
      return { from: startOfDay(subDays(now, 29)), to: endOfDay(now) };
    case "90d":
      return { from: startOfDay(subDays(now, 89)), to: endOfDay(now) };
    case "ytd":
      return { from: startOfYear(now), to: endOfDay(now) };
    case "all":
    default:
      return { from: undefined, to: undefined };
  }
}

function computeLabel(preset: DatePreset, range: DateRange): string {
  switch (preset) {
    case "all":
      return "All Time";
    case "today":
      return "Today";
    case "7d":
      return "Last 7 Days";
    case "30d":
      return "Last 30 Days";
    case "90d":
      return "Last 90 Days";
    case "ytd":
      return "Year to Date";
    case "custom": {
      if (range.from && range.to) {
        return `${format(range.from, "MMM d")} – ${format(range.to, "MMM d")}`;
      }
      if (range.from) return `${format(range.from, "MMM d")} –`;
      return "Custom";
    }
  }
}

const DateRangeContext = createContext<DateRangeContextValue>({
  dateRange: { from: undefined, to: undefined },
  setDateRange: () => {},
  startDate: undefined,
  endDate: undefined,
  preset: "all",
  setPreset: () => {},
  setCustomRange: () => {},
  label: "All Time",
});

export function DateRangeProvider({ children }: { children: React.ReactNode }) {
  const [preset, setPresetState] = useState<DatePreset>("all");
  const [dateRange, setDateRange] = useState<DateRange>({
    from: undefined,
    to: undefined,
  });

  const setPreset = useCallback((p: DatePreset) => {
    setPresetState(p);
    if (p !== "custom") {
      setDateRange(computeRange(p));
    }
  }, []);

  const setCustomRange = useCallback((from: Date | null, to: Date | null) => {
    setPresetState("custom");
    setDateRange({ from: from ?? undefined, to: to ?? undefined });
  }, []);

  const startDate = dateRange.from?.getTime();
  const endDate = dateRange.to ? endOfDay(dateRange.to).getTime() : undefined;
  const label = computeLabel(preset, dateRange);

  return (
    <DateRangeContext.Provider
      value={{ dateRange, setDateRange, startDate, endDate, preset, setPreset, setCustomRange, label }}
    >
      {children}
    </DateRangeContext.Provider>
  );
}

export function useDateRange() {
  return useContext(DateRangeContext);
}
