"use client";

import { useEffect, useState, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Folder, Tag, ChevronRight, ChevronDown, Plus, Rss, X, Settings, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { FeedEditDialog } from "@/components/feed/feed-edit-dialog";

interface FeedItem {
  id: string;
  title: string;
  url: string;
  unreadCount: number;
  folderId: string | null;
}

interface FolderItem {
  id: string;
  name: string;
  order: number;
  feeds: FeedItem[];
}

interface TagItem {
  id: string;
  name: string;
}

interface SidebarProps {
  selectedFeedId: string | null;
  selectedFolderId: string | null;
  selectedTagId: string | null;
  filter: "all" | "unread" | "bookmarked" | "read-later";
  onSelectFeed: (feedId: string) => void;
  onSelectFolder: (folderId: string) => void;
  onSelectTag: (tagId: string) => void;
  onFilterChange: (filter: "all" | "unread" | "bookmarked" | "read-later") => void;
  isAuthenticated?: boolean;
}

export function Sidebar({
  selectedFeedId,
  selectedFolderId,
  selectedTagId,
  filter,
  onSelectFeed,
  onSelectFolder,
  onSelectTag,
  onFilterChange,
  isAuthenticated = true,
}: SidebarProps) {
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [uncategorizedFeeds, setUncategorizedFeeds] = useState<FeedItem[]>([]);
  const [tags, setTags] = useState<TagItem[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [editingFeedId, setEditingFeedId] = useState<string | null>(null);
  const [copiedFeedId, setCopiedFeedId] = useState<string | null>(null);

  // Inline creation
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [creatingTag, setCreatingTag] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newTagName, setNewTagName] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [foldersRes, feedsRes, tagsRes, unreadRes] = await Promise.all([
        fetch("/api/folders"),
        fetch("/api/feeds"),
        fetch("/api/tags"),
        fetch("/api/stats/unread-counts"),
      ]);

      const foldersData = (await foldersRes.json()) as any[];
      const feedsData = (await feedsRes.json()) as any[];
      const tagsData = (await tagsRes.json()) as any[];
      const unreadCounts = (await unreadRes.json()) as Record<string, number>;

      const folderMap = new Map<string, FeedItem[]>();
      const uncategorized: FeedItem[] = [];

      for (const feed of feedsData) {
        const item: FeedItem = {
          id: feed.id,
          title: feed.title,
          url: feed.url,
          unreadCount: unreadCounts[feed.id] || 0,
          folderId: feed.folderId,
        };

        if (feed.folderId) {
          if (!folderMap.has(feed.folderId)) {
            folderMap.set(feed.folderId, []);
          }
          folderMap.get(feed.folderId)!.push(item);
        } else {
          uncategorized.push(item);
        }
      }

      const folderItems: FolderItem[] = foldersData.map((f: any) => ({
        id: f.id,
        name: f.name,
        order: f.order,
        feeds: folderMap.get(f.id) || [],
      }));

      setFolders(folderItems);
      setUncategorizedFeeds(uncategorized);
      setTags(tagsData);
      setExpandedFolders(new Set(folderItems.map((f) => f.id)));
    } catch (err) {
      console.error("Failed to load sidebar data:", err);
    } finally {
      setLoading(false);
    }
  }

  function toggleFolder(folderId: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }

  function copyFeedUrl(feedId: string, url: string) {
    navigator.clipboard.writeText(url).then(() => {
      setCopiedFeedId(feedId);
      setTimeout(() => setCopiedFeedId(null), 2000);
    }).catch(() => {
      // Fallback
      const temp = document.createElement("input");
      temp.value = url;
      document.body.appendChild(temp);
      temp.select();
      document.execCommand("copy");
      document.body.removeChild(temp);
      setCopiedFeedId(feedId);
      setTimeout(() => setCopiedFeedId(null), 2000);
    });
  }

  async function createFolder() {
    if (!newFolderName.trim()) return;
    try {
      await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newFolderName.trim() }),
      });
      setNewFolderName("");
      setCreatingFolder(false);
      loadData();
    } catch {
      // ignore
    }
  }

  async function createTag() {
    if (!newTagName.trim()) return;
    try {
      await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTagName.trim() }),
      });
      setNewTagName("");
      setCreatingTag(false);
      loadData();
    } catch {
      // ignore
    }
  }

  const filters = [
    { key: "all" as const, label: "All" },
    { key: "unread" as const, label: "Unread" },
    { key: "bookmarked" as const, label: "⭐" },
    { key: "read-later" as const, label: "📋" },
  ];

  return (
    <div className="flex h-full flex-col border-r bg-muted/30 max-w-xs">
      {/* Filter tabs */}
      <div className="flex gap-1 border-b p-2">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => onFilterChange(f.key)}
            className={cn(
              "rounded-md px-2 py-1 text-xs font-medium transition-colors",
              filter === f.key
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted text-muted-foreground"
            )}
            title={f.key === "bookmarked" ? "Bookmarked" : f.key === "read-later" ? "Read Later" : f.label}
          >
            {f.label}
          </button>
        ))}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2">
          {/* Folders section */}
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Folders</span>
            {isAuthenticated && (
              <button
                onClick={() => setCreatingFolder(true)}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="New folder"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {creatingFolder && (
            <form
              onSubmit={(e) => { e.preventDefault(); createFolder(); }}
              className="flex items-center gap-1 px-2 py-1"
            >
              <Input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="Folder name"
                className="h-7 text-xs"
                autoFocus
                onBlur={() => { if (!newFolderName.trim()) setCreatingFolder(false); }}
              />
              <Button type="submit" size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0">✓</Button>
              <button
                type="button"
                onClick={() => { setCreatingFolder(false); setNewFolderName(""); }}
                className="shrink-0 p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </form>
          )}

          {folders.map((folder) => (
            <div key={folder.id}>
              <button
                onClick={() => {
                  toggleFolder(folder.id);
                  onSelectFolder(folder.id);
                }}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted transition-colors",
                  selectedFolderId === folder.id && "bg-muted font-medium"
                )}
              >
                {expandedFolders.has(folder.id) ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                )}
                <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate text-left">{folder.name}</span>
                {folder.feeds.length > 0 && (
                  <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                    {folder.feeds.length}
                  </Badge>
                )}
              </button>

              {expandedFolders.has(folder.id) && (
                <div className="ml-4">
                  {folder.feeds.map((feed) => (
                    <div key={feed.id} className="group flex items-center">
                      <button
                        onClick={() => onSelectFeed(feed.id)}
                        className={cn(
                          "flex flex-1 items-center  gap-1.5 rounded-md px-2 py-1.5 text-sm text-left hover:bg-muted transition-colors",
                          selectedFeedId === feed.id && "bg-muted font-medium"
                        )}
                      >
                        <Rss className="h-3 w-3 shrink-0 text-orange-500" />
                        <span className="flex-1 truncate">{feed.title}</span>
                        {feed.unreadCount > 0 && (
                          <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                            {feed.unreadCount}
                          </Badge>
                        )}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); copyFeedUrl(feed.id, feed.url); }}
                        className="shrink-0 p-1 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
                        title="Copy feed URL"
                      >
                        {copiedFeedId === feed.id ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                      </button>
                      {isAuthenticated && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditingFeedId(feed.id); }}
                          className="shrink-0 p-1 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
                          title="Edit feed"
                        >
                          <Settings className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* Uncategorized */}
          {uncategorizedFeeds.length > 0 && (
            <>
              {folders.length > 0 && (
                <div className="my-1 px-2 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  Uncategorized
                </div>
              )}
              {uncategorizedFeeds.map((feed) => (
                <div key={feed.id} className="group flex items-center">
                  <button
                    onClick={() => onSelectFeed(feed.id)}
                    className={cn(
                      "flex flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted transition-colors",
                      selectedFeedId === feed.id && "bg-muted font-medium"
                    )}
                  >
                    <Rss className="h-3 w-3 shrink-0 text-orange-500" />
                    <span className="flex-1 truncate">{feed.title}</span>
                    {feed.unreadCount > 0 && (
                      <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                        {feed.unreadCount}
                      </Badge>
                    )}
                  </button>
                  <button
                    onClick={() => copyFeedUrl(feed.id, feed.url)}
                    className="shrink-0 p-1 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
                    title="Copy feed URL"
                  >
                    {copiedFeedId === feed.id ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                  </button>
                  {isAuthenticated && (
                    <button
                      onClick={() => setEditingFeedId(feed.id)}
                      className="shrink-0 p-1 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
                      title="Edit feed"
                    >
                      <Settings className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
            </>
          )}

          {/* Tags */}
          <div className="my-2 border-t" />

          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Tags</span>
            {isAuthenticated && (
              <button
                onClick={() => setCreatingTag(true)}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="New tag"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {creatingTag && (
            <form
              onSubmit={(e) => { e.preventDefault(); createTag(); }}
              className="flex items-center gap-1 px-2 py-1"
            >
              <Input
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder="Tag name"
                className="h-7 text-xs"
                autoFocus
                onBlur={() => { if (!newTagName.trim()) setCreatingTag(false); }}
              />
              <Button type="submit" size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0">✓</Button>
              <button
                type="button"
                onClick={() => { setCreatingTag(false); setNewTagName(""); }}
                className="shrink-0 p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </form>
          )}

          {tags.map((tag) => (
            <button
              key={tag.id}
              onClick={() => onSelectTag(tag.id)}
              className={cn(
                "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted transition-colors",
                selectedTagId === tag.id && "bg-muted font-medium"
              )}
            >
              <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">{tag.name}</span>
            </button>
          ))}
        </div>
      </ScrollArea>

      {/* Add feed button — auth only */}
      {isAuthenticated && (
        <div className="border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 h-10"
            onClick={() => (window.location.href = "/feeds/add")}
          >
            <Plus className="h-4 w-4" />
            Add Feed
          </Button>
        </div>
      )}

      {/* Feed edit dialog — auth only */}
      {isAuthenticated && (
        <FeedEditDialog
          feedId={editingFeedId}
          open={editingFeedId !== null}
          onOpenChange={(open) => { if (!open) setEditingFeedId(null); }}
          onUpdated={loadData}
          onDeleted={loadData}
        />
      )}
    </div>
  );
}