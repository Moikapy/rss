"use client";
import { publicFetch, adminUrl } from "@/lib/api/client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Bookmark, CheckCircle2, Clock, ExternalLink, Share2, Link, Check, Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Article {
  id: string;
  feedId: string;
  title: string;
  url: string;
  author: string | null;
  summary: string | null;
  content: string | null;
  publishedAt: string;
  read: boolean;
  bookmarked: boolean;
  readLater: boolean;
}

interface ArticleReaderProps {
  articleId: string | null;
  articleState?: {
    isRead: (id: string) => boolean;
    isBookmarked: (id: string) => boolean;
    isReadLater: (id: string) => boolean;
    markRead: (id: string) => void;
    toggleBookmark: (id: string) => void;
    toggleReadLater: (id: string) => void;
  };
  authenticated?: boolean;
}

export function ArticleReader({ articleId, articleState, authenticated }: ArticleReaderProps) {
  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(false);
  const [shareStatus, setShareStatus] = useState<"idle" | "copied" | "shared">("idle");
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!articleId) {
      setArticle(null);
      return;
    }

    setLoading(true);
    // Use public route for reading — no auth required
    publicFetch<Article>(`/articles/${articleId}`)
      .then((data) => {
        if (!data?.id) {
          setArticle(null);
        } else {
          setArticle(data);
        }
        // Auto-mark as read locally
        if (articleState) articleState.markRead(articleId);
      })
      .catch(() => setArticle(null))
      .finally(() => setLoading(false));
  }, [articleId]);

  async function toggleState(field: "read" | "bookmarked" | "readLater") {
    if (!article) return;

    const newValue = !article[field];
    setArticle((prev) => prev ? { ...prev, [field]: newValue } : prev);

    // Update local state only — read/bookmark/readLater is tracked client-side
    if (articleState) {
      if (field === "bookmarked") articleState.toggleBookmark(article.id);
      else if (field === "readLater") articleState.toggleReadLater(article.id);
      else if (field === "read") {
        if (newValue) articleState.markRead(article.id);
      }
    }
  }

  async function handleShare() {
    if (!article) return;

    if (navigator.share) {
      try {
        await navigator.share({
          title: article.title,
          text: article.summary?.replace(/<[^>]*>/g, "").substring(0, 200) || article.title,
          url: article.url,
        });
        setShareStatus("shared");
        setTimeout(() => setShareStatus("idle"), 2000);
        return;
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(article.url);
      setShareStatus("copied");
      setTimeout(() => setShareStatus("idle"), 2000);
    } catch {
      const tempInput = document.createElement("input");
      tempInput.value = article.url;
      document.body.appendChild(tempInput);
      tempInput.select();
      document.execCommand("copy");
      document.body.removeChild(tempInput);
      setShareStatus("copied");
      setTimeout(() => setShareStatus("idle"), 2000);
    }
  }

  if (!articleId) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p className="text-4xl sm:text-lg">📭</p>
          <p className="mt-2 text-sm">Select an article to read</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p className="animate-pulse">Loading article...</p>
      </div>
    );
  }

  if (!article) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Article not found
      </div>
    );
  }

  return (
    <div className={fullscreen ? "fullscreen-overlay" : "flex h-full flex-col"}>
      {/* Article header — title only */}
      <div className="shrink-0 border-b px-4 py-3 sm:px-6 sm:py-4">
        <h1 className="text-lg sm:text-xl font-semibold leading-tight">{article.title}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
          {article.author && <span>By {article.author}</span>}
          {article.author && <span className="hidden sm:inline">·</span>}
          <span>{new Date(article.publishedAt).toLocaleDateString()}</span>
        </div>
      </div>

      {/* Article content — scrolls behind the sticky footer */}
      <div className="flex-1 overflow-y-auto">
        <div className="prose prose-sm dark:prose-invert max-w-none px-4 py-4 pb-16 sm:px-6">
          {article.content ? (
            <div
              dangerouslySetInnerHTML={{ __html: article.content }}
              className="article-content"
            />
          ) : article.summary ? (
            <p>{article.summary.replace(/<[^>]*>/g, "")}</p>
          ) : (
            <div className="text-center py-8">
              <p className="text-muted-foreground mb-2">No content available.</p>
              <a
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                Open original article <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Sticky action footer — always visible, content scrolls behind it */}
      <div className="sticky bottom-0 shrink-0 border-t bg-background/95 backdrop-blur-sm px-4 py-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => toggleState("bookmarked")}
            title={article.bookmarked ? "Remove bookmark" : "Bookmark"}
          >
            <Bookmark className={cn("h-4 w-4", article.bookmarked && "fill-current text-amber-500")} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => toggleState("readLater")}
            title={article.readLater ? "Remove from read later" : "Read later"}
          >
            <Clock className={cn("h-4 w-4", article.readLater && "fill-current text-blue-500")} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => toggleState("read")}
            title={article.read ? "Mark unread" : "Mark read"}
          >
            <CheckCircle2 className={cn("h-4 w-4", article.read && "fill-current")} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handleShare}
            title="Share article"
          >
            {shareStatus === "copied" ? (
              <Check className="h-4 w-4 text-green-500" />
            ) : shareStatus === "shared" ? (
              <Check className="h-4 w-4 text-green-500" />
            ) : (
              <Share2 className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 hidden sm:inline-flex"
            onClick={() => window.open(article.url, "_blank")}
            title="Open original"
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-0.5">
          {shareStatus === "copied" && (
            <span className="text-xs text-green-600 dark:text-green-400 mr-2">Link copied</span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setFullscreen(!fullscreen)}
            title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}