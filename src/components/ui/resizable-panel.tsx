"use client";

export {
  Panel as ResizablePanel,
  Group as ResizablePanelGroup,
} from "react-resizable-panels";

import { Separator as PanelResizeHandle } from "react-resizable-panels";
import { GripVertical } from "lucide-react";

export function ResizableHandle({
  withHandle,
  className,
  ...props
}: {
  withHandle?: boolean;
  className?: string;
  id?: string;
}) {
  return (
    <PanelResizeHandle
      className={
        "group relative flex w-px items-center justify-center bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 data-[resize-handle-state=hover]:bg-primary/20 data-[resize-handle-state=drag]:bg-primary/30 data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-1 data-[panel-group-direction=vertical]:after:w-auto data-[panel-group-direction=vertical]:after:-translate-y-1/2 data-[panel-group-direction=vertical]:after:translate-x-0" +
        (className ? ` ${className}` : "")
      }
      {...props}
    >
      {withHandle && (
        <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border data-[panel-group-direction=vertical]:h-3 data-[panel-group-direction=vertical]:w-4">
          <GripVertical className="h-2.5 w-2.5" />
        </div>
      )}
    </PanelResizeHandle>
  );
}