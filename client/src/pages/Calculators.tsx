import { useEffect, useState } from "react";
import { Calculator } from "lucide-react";

import DashboardLayout from "../components/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import PositionSizePanel from "./SizeCalculator";
import PercentCalculator from "./PercentCalculator";

// Remembers which calculator you were last on, so returning to the page picks
// up where you left off.
const TAB_KEY = "tf.calculators.tab";

export default function Calculators() {
  const [tab, setTab] = useState<string>(() => {
    try {
      return localStorage.getItem(TAB_KEY) ?? "size";
    } catch {
      return "size";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      /* ignore */
    }
  }, [tab]);

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15">
            <Calculator className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Calculators</h1>
            <p className="text-sm text-muted-foreground">
              Sizing and percentage tools for planning trades.
            </p>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="max-w-full justify-start overflow-x-auto">
            <TabsTrigger value="size">Position Size</TabsTrigger>
            <TabsTrigger value="percent">Percentages</TabsTrigger>
          </TabsList>

          <TabsContent value="size" className="mt-6">
            <PositionSizePanel />
          </TabsContent>
          <TabsContent value="percent" className="mt-6">
            <PercentCalculator />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
