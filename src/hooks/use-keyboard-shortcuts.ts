"use client";

import { useEffect, useCallback } from "react";

interface KeyboardShortcutsProps {
  onToggleSidebar?: () => void;
  onNavigateNext?: () => void;
  onNavigatePrev?: () => void;
  onOpenArticle?: () => void;
  onToggleBookmark?: () => void;
  onToggleReadLater?: () => void;
  onToggleRead?: () => void;
  onRefresh?: () => void;
  enabled?: boolean;
}

export function useKeyboardShortcuts({
  onToggleSidebar,
  onNavigateNext,
  onNavigatePrev,
  onOpenArticle,
  onToggleBookmark,
  onToggleReadLater,
  onToggleRead,
  onRefresh,
  enabled = true,
}: KeyboardShortcutsProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      // Ignore if user is typing in an input
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }

      // Modifiers
      const mod = e.metaKey || e.ctrlKey;

      // Cmd+\ — toggle sidebar
      if (mod && e.key === "\\") {
        e.preventDefault();
        onToggleSidebar?.();
        return;
      }

      // Cmd+r / Ctrl+r — don't override browser refresh

      // Single key shortcuts (no modifiers)
      if (!mod && !e.altKey) {
        switch (e.key) {
          case "j":
          case "ArrowDown":
            e.preventDefault();
            onNavigateNext?.();
            break;
          case "k":
          case "ArrowUp":
            e.preventDefault();
            onNavigatePrev?.();
            break;
          case "Enter":
            e.preventDefault();
            onOpenArticle?.();
            break;
          case "s":
            e.preventDefault();
            onToggleBookmark?.();
            break;
          case "l":
            e.preventDefault();
            onToggleReadLater?.();
            break;
          case "r":
            e.preventDefault();
            onToggleRead?.();
            break;
          case "R":
            if (e.shiftKey) {
              e.preventDefault();
              onRefresh?.();
            }
            break;
        }
      }
    },
    [
      enabled,
      onToggleSidebar,
      onNavigateNext,
      onNavigatePrev,
      onOpenArticle,
      onToggleBookmark,
      onToggleReadLater,
      onToggleRead,
      onRefresh,
    ]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}