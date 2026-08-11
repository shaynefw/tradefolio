import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "../../lib/utils"

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      // Recessed tray, so the keys sitting in it read as raised.
      "inline-flex items-center justify-center gap-1.5 rounded-xl border border-black/30! bg-black/20 p-1.5 text-muted-foreground",
      "shadow-[inset_0_2px_4px_rgba(0,0,0,0.35)]",
      className
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      // Base — a physical key. Bottom shadow is the "edge" that gives depth.
      "relative inline-flex select-none items-center justify-center whitespace-nowrap rounded-lg border px-3.5 py-1.5 text-sm font-semibold ring-offset-background transition-all duration-100 cursor-pointer",
      // Focus / disabled
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
      // Inactive → raised dark key: top highlight + hard bottom edge. Aqua
      // label reads as "clickable" without colliding with the app's semantic
      // colours (green = profit, red = loss, blue = short, amber = paused).
      "border-white/10! bg-secondary text-cyan-300",
      "shadow-[0_3px_0_0_rgba(0,0,0,0.55),inset_0_1px_0_0_rgba(255,255,255,0.07)]",
      "hover:-translate-y-px hover:bg-accent hover:text-cyan-100",
      "hover:shadow-[0_4px_0_0_rgba(0,0,0,0.55),inset_0_1px_0_0_rgba(255,255,255,0.12)]",
      // Press → sink into the tray
      "active:translate-y-[2px] active:shadow-[0_1px_0_0_rgba(0,0,0,0.55)]",
      // Selected → bright key, inverted text, unmistakably the current one
      "data-[state=active]:border-white/25! data-[state=active]:bg-foreground data-[state=active]:text-background",
      "data-[state=active]:shadow-[0_3px_0_0_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.55)]",
      "data-[state=active]:hover:bg-foreground data-[state=active]:hover:text-background",
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
