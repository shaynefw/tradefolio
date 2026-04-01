import { useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Calendar } from "./ui/calendar";
import { useDateRange, type DatePreset } from "../contexts/DateRangeContext";
import type { DateRange as RDPDateRange } from "react-day-picker";

const presets: { value: DatePreset; label: string }[] = [
  { value: "all", label: "All Time" },
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 Days" },
  { value: "30d", label: "Last 30 Days" },
  { value: "90d", label: "Last 90 Days" },
  { value: "ytd", label: "Year to Date" },
];

export function DateRangePicker() {
  const { preset, dateRange, setPreset, setCustomRange, label } = useDateRange();
  const [open, setOpen] = useState(false);

  const calendarRange: RDPDateRange | undefined =
    dateRange.from || dateRange.to
      ? { from: dateRange.from ?? undefined, to: dateRange.to ?? undefined }
      : undefined;

  const handleCalendarSelect = (range: RDPDateRange | undefined) => {
    if (!range) {
      setPreset("all");
      return;
    }
    let toDate = range.to ?? null;
    if (toDate) {
      toDate = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate(), 23, 59, 59, 999);
    }
    setCustomRange(range.from ?? null, toDate);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5 text-xs font-normal text-muted-foreground hover:text-foreground"
        >
          <CalendarDays className="h-3.5 w-3.5" />
          <span>{label}</span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <div className="flex">
          {/* Presets sidebar */}
          <div className="border-r p-2 space-y-0.5 min-w-[130px]">
            {presets.map((p) => (
              <button
                key={p.value}
                className={`w-full text-left px-3 py-1.5 rounded-md text-xs transition-colors ${
                  preset === p.value
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => {
                  setPreset(p.value);
                  if (p.value !== "custom") setOpen(false);
                }}
              >
                {p.label}
              </button>
            ))}
            <div className="border-t my-1.5" />
            <button
              className={`w-full text-left px-3 py-1.5 rounded-md text-xs transition-colors ${
                preset === "custom"
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setPreset("custom")}
            >
              Custom Range
            </button>
          </div>
          {/* Calendar */}
          <div className="p-2">
            <Calendar
              mode="range"
              selected={calendarRange}
              onSelect={handleCalendarSelect}
              numberOfMonths={2}
              defaultMonth={
                dateRange.from
                  ? new Date(dateRange.from.getFullYear(), dateRange.from.getMonth())
                  : new Date(new Date().getFullYear(), new Date().getMonth() - 1)
              }
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
