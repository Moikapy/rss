"use client";

interface StatusBarProps {
  refreshing: boolean;
  lastRefresh: Date | null;
  onRefresh: () => void;
}

export function StatusBar({ refreshing, lastRefresh, onRefresh }: StatusBarProps) {
  const timeAgo = lastRefresh ? getTimeAgo(lastRefresh) : "Never";

  return (
    <footer className="flex h-7 items-center justify-between border-t px-4 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        {refreshing && <span className="animate-pulse">⟳ Refreshing feeds...</span>}
        {!refreshing && <span>Last updated {timeAgo}</span>}
      </div>
      <button
        onClick={onRefresh}
        disabled={refreshing}
        className="hover:text-foreground disabled:opacity-50 transition-colors"
      >
        {refreshing ? "Refreshing..." : "Refresh all (⇧R)"}
      </button>
    </footer>
  );
}

function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}