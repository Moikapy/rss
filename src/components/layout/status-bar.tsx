"use client";

interface StatusBarProps {
  refreshing: boolean;
  lastRefresh: Date | null;
  onRefresh: () => void;
  feedsProcessed?: number;
  totalNewArticles?: number;
  skipped?: number;
}

export function StatusBar({ refreshing, lastRefresh, onRefresh, feedsProcessed, totalNewArticles, skipped }: StatusBarProps) {
  const timeAgo = lastRefresh ? getTimeAgo(lastRefresh) : "Never";

  const statusText = refreshing
    ? "⟳ Refreshing feeds..."
    : lastRefresh && feedsProcessed !== undefined
      ? `${feedsProcessed} feeds refreshed${totalNewArticles ? `, ${totalNewArticles} new articles` : ""}${skipped ? `, ${skipped} unchanged` : ""}`
      : `Last updated ${timeAgo}`;

  return (
    <footer className="flex h-7 items-center justify-between border-t px-4 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        {refreshing ? <span className="animate-pulse">{statusText}</span> : <span>{statusText}</span>}
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