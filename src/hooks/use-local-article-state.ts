"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEYS = {
  read: "0xrss-read",
  bookmarked: "0xrss-bookmarked",
  readLater: "0xrss-read-later",
};

function loadSet(key: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveSet(key: string, set: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    // localStorage full or unavailable
  }
}

export function useLocalArticleState() {
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(new Set());
  const [readLaterIds, setReadLaterIds] = useState<Set<string>>(new Set());

  // Load from localStorage on mount
  useEffect(() => {
    setReadIds(loadSet(STORAGE_KEYS.read));
    setBookmarkedIds(loadSet(STORAGE_KEYS.bookmarked));
    setReadLaterIds(loadSet(STORAGE_KEYS.readLater));
  }, []);

  const isRead = useCallback(
    (id: string) => readIds.has(id),
    [readIds]
  );

  const isBookmarked = useCallback(
    (id: string) => bookmarkedIds.has(id),
    [bookmarkedIds]
  );

  const isReadLater = useCallback(
    (id: string) => readLaterIds.has(id),
    [readLaterIds]
  );

  const markRead = useCallback((id: string) => {
    setReadIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      saveSet(STORAGE_KEYS.read, next);
      return next;
    });
  }, []);

  const markUnread = useCallback((id: string) => {
    setReadIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      saveSet(STORAGE_KEYS.read, next);
      return next;
    });
  }, []);

  const toggleBookmark = useCallback((id: string) => {
    setBookmarkedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveSet(STORAGE_KEYS.bookmarked, next);
      return next;
    });
  }, []);

  const toggleReadLater = useCallback((id: string) => {
    setReadLaterIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveSet(STORAGE_KEYS.readLater, next);
      return next;
    });
  }, []);

  // Sync server state on first load for auth'd users
  const syncFromServer = useCallback(
    async (articles: { id: string; read: boolean; bookmarked: boolean; readLater: boolean }[]) => {
      const newRead = loadSet(STORAGE_KEYS.read);
      const newBookmarked = loadSet(STORAGE_KEYS.bookmarked);
      const newReadLater = loadSet(STORAGE_KEYS.readLater);
      let changed = false;

      for (const a of articles) {
        if (a.read && !newRead.has(a.id)) { newRead.add(a.id); changed = true; }
        if (a.bookmarked && !newBookmarked.has(a.id)) { newBookmarked.add(a.id); changed = true; }
        if (a.readLater && !newReadLater.has(a.id)) { newReadLater.add(a.id); changed = true; }
      }

      if (changed) {
        saveSet(STORAGE_KEYS.read, newRead);
        saveSet(STORAGE_KEYS.bookmarked, newBookmarked);
        saveSet(STORAGE_KEYS.readLater, newReadLater);
        setReadIds(newRead);
        setBookmarkedIds(newBookmarked);
        setReadLaterIds(newReadLater);
      }
    },
    []
  );

  return {
    isRead,
    isBookmarked,
    isReadLater,
    markRead,
    markUnread,
    toggleBookmark,
    toggleReadLater,
    readIds,
    bookmarkedIds,
    readLaterIds,
    syncFromServer,
  };
}