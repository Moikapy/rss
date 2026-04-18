"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface RefreshState {
  refreshing: boolean;
  lastRefresh: Date | null;
  feedsProcessed: number;
  totalNewArticles: number;
}

export function useAutoRefresh(intervalMs: number = 5 * 60 * 1000) {
  const [state, setState] = useState<RefreshState>({
    refreshing: false,
    lastRefresh: null,
    feedsProcessed: 0,
    totalNewArticles: 0,
  });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const refreshAll = useCallback(async () => {
    setState((prev) => ({ ...prev, refreshing: true }));
    try {
      const res = await fetch("/api/cron/fetch-feeds", { method: "POST" });
      const data = (await res.json()) as { feedsProcessed?: number; totalNewArticles?: number };
      if (mountedRef.current) {
        setState({
          refreshing: false,
          lastRefresh: new Date(),
          feedsProcessed: data.feedsProcessed ?? 0,
          totalNewArticles: data.totalNewArticles ?? 0,
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