"use client";

import { TooltipProvider as TooltipProviderPrimitive } from "@/components/ui/tooltip";

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <TooltipProviderPrimitive>{children}</TooltipProviderPrimitive>;
}