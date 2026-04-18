"use client";

import { useEffect, useState, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bookmark, Clock, ExternalLink, Share2, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface ArticleSummary {
  id: string;
  feedId: string;
  title: string;
  url: string;
  author: string | null;
  summary: string | null;
  publishedAt: string;
  read: boolean;
  bookmarked: boolean;
  readLater: boolean;
  feedTitle: string | null;
}

interface ArticleListProps {
  feedId: string | null;
  folderId: string | null;
  tagId: string | null;
  filter: "all" | "unread" | "bookmarked" | "read-later";
  searchQuery: string;
  selectedArticleId: string | null;
  onSelectArticle: (id: string) => void;
  version?: number;
  onArticlesLoaded?: (articles: ArticleSummary[]) => void;
  articleState?: {
    isRead: (id: string) => boolean;
    isBookmarked: (id: string) => boolean;
    isReadLater: (id: string) => boolean;
  };
  onMarkRead?: (id: string) => void;
}

export function ArticleList({
  feedId,
  folderId,
  tagId,
  filter,
  searchQuery,
  selectedArticleId,
  onSelectArticle,
  version = 0,
  onArticlesLoaded,
  articleState,
  onMarkRead,
}: ArticleListProps) {
  const [allArticles, setAllArticles] = useState<ArticleSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchArticles = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (feedId) params.set("feedId", feedId);
      if (folderId) params.set("folderId", folderId);
      // Don't filter server-side when using local state (filter client-side instead)
      if (!articleState && filter !== "all") params.set("filter", filter);
      if (searchQuery) params.set("q", searchQuery);

      const url = searchQuery
        ? `/api/search?${params}`
        : `/api/articles?${params}`;

      const res = await fetch(url);
      const raw = (await res.json()) as any;
      const results: ArticleSummary[] = searchQuery ? (raw.results || []) : (raw || []);
      setAllArticles(results);
      onArticlesLoaded?.(results);
    } catch (err) {
      console.error("Failed to fetch articles:", err);
      setAllArticles([]);
    } finally {
      setLoading(false);
    }
  // articleState is intentionally excluded — it's an object that changes identity
  // on every render. Filtering is done in the derived `articles` memo below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedId, folderId, filter, searchQuery, onArticlesLoaded]);

  useEffect(() => {
    fetchArticles();
  }, [fetchArticles, version]);

  // Derive filtered display from raw data + local state
  const articles = articleState
    ? allArticles.filter((a) => {
        if (filter === "unread") return !articleState.isRead(a.id);
        if (filter === "bookmarked") return articleState.isBookmarked(a.id);
        if (filter === "read-later") return articleState.isReadLater(a.id);
        return true;
      })
    : allArticles;

  async function handleShare(article: ArticleSummary) {
    if (navigator.share) {
      try {
        await navigator.share({
          title: article.title,
          text: article.summary?.replace(/<[^>]*>/g, "").substring(0, 200) || article.title,
          url: article.url,
        });
        return;
      } catch {
        // Fall through to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(article.url);
    } catch {
      const temp = document.createElement("input");
      temp.value = article.url;
      document.body.appendChild(temp);
      temp.select();
      document.execCommand("copy");
      document.body.removeChild(temp);
    }
  }

  if (loading && articles.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p className="animate-pulse">Loading articles...</p>
      </div>
    );
  }

  if (articles.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <p className="text-4xl">📭</p>
        <p className="text-sm">No articles found</p>
        <p className="text-xs">Add a feed to get started</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col">
        {articles.map((article) => {
          const read = articleState?.isRead(article.id) ?? article.read;
          const bookmarked = articleState?.isBookmarked(article.id) ?? article.bookmarked;
          const readLater = articleState?.isReadLater(article.id) ?? article.readLater;

          return (
          <div
            key={article.id}
            onClick={() => { onSelectArticle(article.id); onMarkRead?.(article.id); }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter") { onSelectArticle(article.id); onMarkRead?.(article.id); } }}
            className={cn(
              "flex flex-col gap-1 border-b px-3 py-3 text-left transition-colors hover:bg-muted/50 active:bg-muted cursor-pointer sm:py-2.5",
              selectedArticleId === article.id && "bg-muted",
              !read && "border-l-2 border-l-primary"
            )}
          >
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  {!read && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  )}
                  <span
                    className={cn(
                      "text-sm truncate",
                      read ? "text-muted-foreground" : "font-medium"
                    )}
                  >
                    {article.title}
                  </span>
                </div>
                {article.summary && (
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {article.summary.replace(/<[^>]*>/g, "").substring(0, 200)}
                  </p>
                )}
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  {article.feedTitle && <span>{article.feedTitle}</span>}
                  {article.feedTitle && <span>·</span>}
                  <span>{formatTimeAgo(article.publishedAt)}</span>
                  {bookmarked && <Bookmark className="h-3 w-3 fill-current text-amber-500" />}
                  {readLater && <Clock className="h-3 w-3 text-blue-500" />}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleShare(article); }}
                    className="shrink-0 p-1 text-muted-foreground hover:text-foreground transition-colors md:hidden"
                    title="Share"
                  >
                    <Share2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}