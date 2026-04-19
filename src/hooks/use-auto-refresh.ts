"use client";
import { adminUrl, authHeaders } from "@/lib/api/client";

import { useCallback, useEffect, useRef, useState } from "react";

interface RefreshState {
  refreshing: boolean;
  lastRefresh: Date | null;
  feedsProcessed: number;
  totalNewArticles: number;
  skipped: number;
}

export function useAutoRefresh(intervalMs: number = 5 * 60 * 1000) {
  const [state, setState] = useState<RefreshState>({
    refreshing: false,
    lastRefresh: null,
    feedsProcessed: 0,
    totalNewArticles: 0,
    skipped: 0,
  });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const refreshAll = useCallback(async () => {
    setState((prev) => ({ ...prev, refreshing: true }));
    try {
      const res = await fetch(adminUrl("/fetch-feeds"), {
        method: "POST",
        headers: { ...authHeaders() },
      });
      const data: {
        success?: boolean;
        feedsProcessed?: number;
        totalNewArticles?: number;
        skipped?: number;
        error?: string;
      } = await res.json();

      if (!res.ok || !data.success) {
        console.warn("Feed refresh failed:", data.error || "Unknown error");
        if (mountedRef.current) {
          setState((prev) => ({ ...prev, refreshing: false }));
        }
        return;
      }

      if (mountedRef.current) {
        setState({
          refreshing: false,
          lastRefresh: new Date(),
          feedsProcessed: data.feedsProcessed ?? 0,
          totalNewArticles: data.totalNewArticles ?? 0,
          skipped: data.skipped ?? 0,
        });
      }
    } catch {
      if (mountedRef.current) {
        setState((prev) => ({ ...prev, refreshing: false }));
      }
    }
  }, []);

  // Start auto-poll timer
  useEffect(() => {
    mountedRef.current = true;
    timerRef.current = setInterval(refreshAll, intervalMs);
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [refreshAll, intervalMs]);

  return { ...state, refreshAll };
}