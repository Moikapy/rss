import * as React from "react"

import { cn } from "@/lib/utils"
import { CheckIcon } from "lucide-react"

/**
 * Checkbox component using native HTML checkbox with visual overlay.
 *
 * Previously used @base-ui/react/checkbox which requires
 * Field.Root context for controlled inputs to work properly. Without it,
 * onCheckedChange-based state updates don't propagate correctly, causing
 * checkboxes to appear interactive but never update React state.
 *
 * This native implementation supports standard React checked/onChange handlers
 * without any framework-specific event bridging.
 * Accepts both `onCheckedChange` (old API) and standard `onChange`.
 */
const Checkbox = React.forwardRef<
  HTMLInputElement,
  Omit<React.ComponentProps<"input">, "type"> & {
    /** Alias for checked — matches the old Base UI API */
    onCheckedChange?: (checked: boolean) => void
  }
>(({ className, checked, onCheckedChange, onChange, disabled, ...props }, ref) => {
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    onChange?.(e)
    onCheckedChange?.(e.target.checked)
  }

  return (
    <span
      data-slot="checkbox"
      className={cn(
        "peer relative inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input transition-colors",
        disabled && "cursor-not-allowed opacity-50",
        checked && "border-primary bg-primary text-primary-foreground dark:bg-primary",
        !checked && "dark:bg-input/30",
        className
      )}
    >
      {checked && (
        <CheckIcon className="pointer-events-none size-3.5" />
      )}
      <input
        type="checkbox"
        ref={ref}
        checked={checked}
        onChange={handleChange}
        disabled={disabled}
        className="absolute inset-0 cursor-[inherit] opacity-0"
        {...props}
      />
    </span>
  )
})

Checkbox.displayName = "Checkbox"

export { Checkbox }