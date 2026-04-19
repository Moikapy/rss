"use client";
import { apiFetch, adminUrl, publicFetch } from "@/lib/api/client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Trash2 } from "lucide-react";

interface Feed {
  id: string;
  title: string;
  url: string;
  siteUrl: string | null;
  description: string | null;
  folderId: string | null;
  refreshInterval: number;
  autoRefresh: boolean;
}

interface Folder {
  id: string;
  name: string;
}

interface Tag {
  id: string;
  name: string;
}

interface FeedEditDialogProps {
  feedId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
  onUpdated?: () => void;
}

export function FeedEditDialog({
  feedId,
  open,
  onOpenChange,
  onDeleted,
  onUpdated,
}: FeedEditDialogProps) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [newTagName, setNewTagName] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  // Form state
  const [title, setTitle] = useState("");
  const [folderId, setFolderId] = useState("");
  const [refreshInterval, setRefreshInterval] = useState(30);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Refs to track latest form values — guards against stale closures
  // if Base UI Dialog/Button intercept events in a way that delays
  // React's state propagation to the onClick handler.
  const titleRef = useRef("");
  const folderIdRef = useRef("");
  const refreshIntervalRef = useRef(30);
  const autoRefreshRef = useRef(true);
  const selectedTagIdsRef = useRef(new Set<string>());

  // Keep refs in sync with state
  useEffect(() => { titleRef.current = title; }, [title]);
  useEffect(() => { folderIdRef.current = folderId; }, [folderId]);
  useEffect(() => { refreshIntervalRef.current = refreshInterval; }, [refreshInterval]);
  useEffect(() => { autoRefreshRef.current = autoRefresh; }, [autoRefresh]);
  useEffect(() => { selectedTagIdsRef.current = selectedTagIds; }, [selectedTagIds]);

  useEffect(() => {
    if (!feedId || !open) return;

    setLoading(true);
    setError("");

    // Load feed data, folders, tags
    Promise.all([
      apiFetch<any>(adminUrl(`/feeds/${feedId}`)),
      publicFetch<Folder[]>("/folders"),
      publicFetch<Tag[]>("/tags"),
      apiFetch<{ tagId: string }[]>(adminUrl(`/feeds/${feedId}/tags`)),
    ]).then(([feedData, foldersData, tagsData, feedTagsData]) => {
      setFeed(feedData);
      setTitle(feedData.title || "");
      setFolderId(feedData.folderId || "");
      setRefreshInterval(feedData.refreshInterval || 30);
      setAutoRefresh(feedData.autoRefresh !== false);
      setFolders(foldersData);
      setTags(tagsData);
      setSelectedTagIds(new Set(feedTagsData.map((t: any) => t.tagId)));
    }).catch((err) => {
      setError(err instanceof Error ? err.message : "Failed to load feed data");
    }).finally(() => {
      setLoading(false);
    });
  }, [feedId, open, retryKey]);

  async function handleSave() {
    if (!feedId) return;
    setSaving(true);
    setError("");

    try {
      const updated = await apiFetch<any>(adminUrl(`/feeds/${feedId}`), {
        method: "PATCH",
        body: JSON.stringify({
          title: titleRef.current,
          folderId: folderIdRef.current || null,
          refreshInterval: refreshIntervalRef.current,
          autoRefresh: autoRefreshRef.current,
          tagIds: Array.from(selectedTagIdsRef.current),
        }),
      });

      console.log("[feed-edit] PATCH sent:", { title: titleRef.current, folderId: folderIdRef.current, refreshInterval: refreshIntervalRef.current, autoRefresh: autoRefreshRef.current });

      // Update local feed state with response
      if (updated) {
        setFeed(updated);
        setTitle(updated.title || title);
      }

      onUpdated?.();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update feed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!feedId) return;
    if (!confirm("Delete this feed and all its articles?")) return;

    setDeleting(true);
    try {
      await apiFetch(adminUrl(`/feeds/${feedId}`), { method: "DELETE" });
      onDeleted?.();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete feed");
    } finally {
      setDeleting(false);
    }
  }

  async function handleCreateTag() {
    if (!newTagName.trim()) return;
    try {
      const data = await apiFetch<{ id?: string; error?: string }>(adminUrl("/tags"), {
        method: "POST",
        body: JSON.stringify({ name: newTagName.trim() }),
      });
      if (data.id) {
        setTags((prev) => [...prev, { id: data.id!, name: newTagName.trim() }]);
        setSelectedTagIds((prev) => new Set([...prev, data.id!]));
        setNewTagName("");
      }
    } catch {
      // ignore
    }
  }

  function toggleTag(tagId: string) {
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) {
        next.delete(tagId);
      } else {
        next.add(tagId);
      }
      return next;
    });
  }

  const intervalOptions = [
    { value: 5, label: "5 min" },
    { value: 15, label: "15 min" },
    { value: 30, label: "30 min" },
    { value: 60, label: "1 hour" },
    { value: 120, label: "2 hours" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Feed</DialogTitle>
          <DialogDescription>
            Update feed settings, folder, and tags
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading...</div>
        )}

        {error && !loading && (
          <div className="space-y-3 py-2">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={() => { setError(""); setRetryKey(k => k + 1); }}>Retry</Button>
          </div>
        )}

        {!loading && !error && feed && (
          <div className="space-y-4 py-2">
            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="feed-title">Title</Label>
              <Input
                id="feed-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            {/* URL (read-only) */}
            <div className="space-y-2">
              <Label htmlFor="feed-url">Feed URL</Label>
              <Input id="feed-url" value={feed.url} readOnly className="text-muted-foreground" />
            </div>

            {/* Folder */}
            <div className="space-y-2">
              <Label htmlFor="feed-folder">Category</Label>
              <select
                id="feed-folder"
                value={folderId}
                onChange={(e) => setFolderId(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">No category</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Tags */}
            <div className="space-y-2">
              <Label>Tags</Label>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <label
                    key={tag.id}
                    className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs cursor-pointer transition-colors ${
                      selectedTagIds.has(tag.id)
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    <Checkbox
                      checked={selectedTagIds.has(tag.id)}
                      onCheckedChange={() => toggleTag(tag.id)}
                      className="h-3 w-3"
                    />
                    {tag.name}
                  </label>
                ))}
              </div>
              {/* Create new tag inline */}
              <form
                onSubmit={(e) => { e.preventDefault(); handleCreateTag(); }}
                className="flex items-center gap-1"
              >
                <Input
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  placeholder="New tag..."
                  className="h-7 text-xs"
                />
                <Button type="submit" size="sm" variant="outline" className="h-7 text-xs shrink-0">
                  Add
                </Button>
              </form>
            </div>

            {/* Refresh interval */}
            <div className="space-y-2">
              <Label htmlFor="feed-refresh">Refresh interval</Label>
              <select
                id="feed-refresh"
                value={refreshInterval}
                onChange={(e) => setRefreshInterval(parseInt(e.target.value))}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {intervalOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Auto-refresh toggle */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="feed-auto-refresh"
                checked={autoRefresh}
                onCheckedChange={(checked) => setAutoRefresh(checked === true)}
              />
              <Label htmlFor="feed-auto-refresh" className="text-sm font-normal">
                Auto-refresh enabled
              </Label>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter className="flex justify-between sm:justify-between">
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            disabled={deleting}
            className="gap-1"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {deleting ? "Deleting..." : "Delete"}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}