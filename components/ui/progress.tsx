"use client"

import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"
import { useDirection } from "@radix-ui/react-direction"

import { cn } from "@/lib/utils"

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  const direction = useDirection()
  const offset = 100 - (value || 0)
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        "bg-primary/20 relative h-2 w-full overflow-hidden rounded-full",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="bg-gradient-to-r from-emerald-400 to-emerald-300 dark:from-emerald-500 dark:to-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.4)] h-full w-full flex-1 transition-all rounded-full"
        // Fill grows from the inline-start: leftwards in LTR, rightwards in RTL.
        style={{ transform: `translateX(${direction === "rtl" ? offset : -offset}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
