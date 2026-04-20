/**
 * 0xRSS SDK — DRY data access layer for the API Worker.
 *
 * Every route handler should call these functions instead of writing
 * raw drizzle/D1 queries. This ensures:
 * - Cache invalidation is always consistent
 * - D1 stale-read-after-write is handled consistently
 * - Validation is centralized
 * - No copy-pasted query patterns
 */

import type { Bindings } from "../types";
import { createDb } from "../db/client";
import { feeds, articles, folders, tags, feedTags } from "../db/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { invalidateCache } from "../middleware/cache";

// ─── DB helper types ─────────────────────────────────────────────────────────

type Db = ReturnType<typeof createDb>;

/** Standard paginated list params */
interface ListParams {
  limit?: number;
  offset?: number;
}

/** Result of a cache-aware write — the merged row */
interface WriteResult<T> {
  data: T;
  invalidated: string[];
}

// ─── Feeds ───────────────────────────────────────────────────────────────────

export async function listFeeds(env: Bindings): Promise<any[]> {
  const db = createDb(env.DB);
  const allFeeds = await db.select({
    id: feeds.id,
    title: feeds.title,
    url: feeds.url,
    siteUrl: feeds.siteUrl,
    description: feeds.description,
    folderId: feeds.folderId,
    lastFetched: feeds.lastFetched,
    refreshInterval: feeds.refreshInterval,
    autoRefresh: feeds.autoRefresh,
    createdAt: feeds.createdAt,
    updatedAt: feeds.updatedAt,
  }).from(feeds).orderBy(desc(feeds.createdAt)).all();

  // Enrich with folder names, tags, and article counts
  const [folderRows, tagRows, counts] = await Promise.all([
    db.select().from(folders).all(),
    db.select({ feedId: feedTags.feedId, tagName: tags.name })
      .from(feedTags).leftJoin(tags, eq(feedTags.tagId, tags.id)).all(),
    db.select({ feedId: articles.feedId, count: sql<number>`count(*)` })
      .from(articles).groupBy(articles.feedId).all(),
  ]);

  const folderMap = new Map(folderRows.map((f) => [f.id, f.name]));
  const tagMap = new Map<string, string[]>();
  for (const row of tagRows) {
    if (!tagMap.has(row.feedId)) tagMap.set(row.feedId, []);
    if (row.tagName) tagMap.get(row.feedId)!.push(row.tagName);
  }
  const countMap = new Map(counts.map((r) => [r.feedId, r.count]));

  return allFeeds.map((f) => ({
    ...f,
    folderName: f.folderId ? folderMap.get(f.folderId) ?? null : null,
    tagNames: tagMap.get(f.id) ?? [],
    articleCount: countMap.get(f.id) ?? 0,
  }));
}

export async function getFeed(env: Bindings, id: string): Promise<any | null> {
  const db = createDb(env.DB);
  return db.select().from(feeds).where(eq(feeds.id, id)).get();
}

export async function createFeed(env: Bindings, data: {
  title?: string;
  url: string;
  siteUrl?: string | null;
  description?: string | null;
  folderId?: string | null;
  tagIds?: string[];
}): Promise<{ id: string; success: true }> {
  const db = createDb(env.DB);
  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(feeds).values({
    id,
    title: data.title || data.url,
    url: data.url,
    siteUrl: data.siteUrl || null,
    description: data.description || null,
    folderId: data.folderId || null,
    refreshInterval: 30,
    autoRefresh: true,
    lastFetched: null,
    createdAt: now,
    updatedAt: now,
  }).run();

  if (data.tagIds?.length) {
    for (const tagId of data.tagIds) {
      await db.insert(feedTags).values({ feedId: id, tagId }).run();
    }
  }

  await invalidateCache(env, ["/api/public/feeds", "/api/public/articles", "/api/public/folders", "/api/public/tags"]);
  return { id, success: true };
}

/**
 * Update a feed. Only overwrites fields present in `data`.
 * Uses raw D1 prepare() to avoid drizzle .run() silently failing on local D1.
 * Fetches the current row BEFORE update and merges changes to avoid stale reads.
 */
export async function updateFeed(env: Bindings, id: string, data: Record<string, any>): Promise<any> {
  const db = createDb(env.DB);
  const current = await db.select().from(feeds).where(eq(feeds.id, id)).get();
  if (!current) return null;

  const columnMap: Record<string, string> = {
    title: "title",
    siteUrl: "site_url",
    description: "description",
    folderId: "folder_id",
    refreshInterval: "refresh_interval",
    autoRefresh: "auto_refresh",
  };

  const setClauses: string[] = ["updated_at = ?"];
  const setValues: any[] = [new Date().toISOString()];

  for (const [key, col] of Object.entries(columnMap)) {
    if (data[key] !== undefined) {
      setClauses.push(`${col} = ?`);
      setValues.push(data[key]);
    }
  }

  setValues.push(id);
  await env.DB.prepare(`UPDATE feeds SET ${setClauses.join(", ")} WHERE id = ?`).bind(...setValues).run();

  // Update tags if provided
  if (data.tagIds && Array.isArray(data.tagIds)) {
    await db.delete(feedTags).where(eq(feedTags.feedId, id)).run();
    for (const tagId of data.tagIds) {
      await db.insert(feedTags).values({ feedId: id, tagId }).run();
    }
  }

  await invalidateCache(env, ["/api/public/feeds", "/api/public/articles", "/api/public/tags"]);

  // Merge updated fields into the pre-update row (avoids stale D1 read cache)
  return { ...current, ...data, updatedAt: new Date() };
}

export async function deleteFeed(env: Bindings, id: string): Promise<void> {
  const db = createDb(env.DB);
  await db.delete(feeds).where(eq(feeds.id, id)).run();
  await invalidateCache(env, ["/api/public/feeds", "/api/public/articles", "/api/public/folders", "/api/public/tags"]);
}

// ─── Articles ─────────────────────────────────────────────────────────────────

export async function listArticles(env: Bindings, params: { feedId?: string; limit?: number; offset?: number }): Promise<any[]> {
  const db = createDb(env.DB);
  const conditions = [];
  if (params.feedId) conditions.push(eq(articles.feedId, params.feedId));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  return db.select({
    id: articles.id,
    feedId: articles.feedId,
    feedTitle: feeds.title,
    title: articles.title,
    url: articles.url,
    author: articles.author,
    summary: articles.summary,
    content: articles.content,
    publishedAt: articles.publishedAt,
    read: articles.read,
    bookmarked: articles.bookmarked,
    readLater: articles.readLater,
  }).from(articles).leftJoin(feeds, eq(articles.feedId, feeds.id))
    .where(where).orderBy(desc(articles.publishedAt))
    .limit(params.limit || 50).offset(params.offset || 0).all();
}

export async function getArticle(env: Bindings, id: string): Promise<any | null> {
  const db = createDb(env.DB);
  return db.select().from(articles).where(eq(articles.id, id)).get();
}

/**
 * Update article fields (read, bookmarked, readLater).
 * Uses raw D1 prepare() for reliable writes.
 */
export async function updateArticle(env: Bindings, id: string, data: {
  read?: boolean;
  bookmarked?: boolean;
  readLater?: boolean;
}): Promise<void> {
  const setClauses: string[] = [];
  const setValues: any[] = [];

  if (data.read !== undefined) { setClauses.push("`read` = ?"); setValues.push(data.read ? 1 : 0); }
  if (data.bookmarked !== undefined) { setClauses.push("bookmarked = ?"); setValues.push(data.bookmarked ? 1 : 0); }
  if (data.readLater !== undefined) { setClauses.push("read_later = ?"); setValues.push(data.readLater ? 1 : 0); }

  if (setClauses.length > 0) {
    setValues.push(id);
    await env.DB.prepare(`UPDATE articles SET ${setClauses.join(", ")} WHERE id = ?`).bind(...setValues).run();
  }

  await invalidateCache(env, ["/api/public/articles"]);
}

export async function deleteArticle(env: Bindings, id: string): Promise<void> {
  const db = createDb(env.DB);
  await db.delete(articles).where(eq(articles.id, id)).run();
  await invalidateCache(env, ["/api/public/articles"]);
}

// ─── Folders ─────────────────────────────────────────────────────────────────

export async function listFolders(env: Bindings): Promise<any[]> {
  const db = createDb(env.DB);
  const folderRows = await db.select().from(folders).orderBy(folders.order).all();

  // Get feed count per folder
  const counts = await db.select({
    folderId: feeds.folderId,
    count: sql<number>`count(*)`,
  }).from(feeds).where(sql`${feeds.folderId} is not null`).groupBy(feeds.folderId).all();
  const countMap = new Map(counts.map((r) => [r.folderId, r.count]));

  return folderRows.map((f) => ({
    id: f.id,
    name: f.name,
    order: f.order,
    feedCount: countMap.get(f.id) ?? 0,
  }));
}

export async function createFolder(env: Bindings, name: string, order?: number): Promise<{ id: string; success: true }> {
  const db = createDb(env.DB);
  const id = crypto.randomUUID();
  await db.insert(folders).values({ id, name, order: order ?? 0, createdAt: new Date() }).run();
  await invalidateCache(env, ["/api/public/folders"]);
  return { id, success: true };
}

export async function updateFolder(env: Bindings, id: string, data: { name?: string; order?: number }): Promise<void> {
  const setClauses: string[] = [];
  const setValues: any[] = [];

  if (data.name !== undefined) { setClauses.push("name = ?"); setValues.push(data.name); }
  if (data.order !== undefined) { setClauses.push("`order` = ?"); setValues.push(data.order); }

  if (setClauses.length > 0) {
    setValues.push(id);
    await env.DB.prepare(`UPDATE folders SET ${setClauses.join(", ")} WHERE id = ?`).bind(...setValues).run();
  }

  await invalidateCache(env, ["/api/public/folders", "/api/public/feeds"]);
}

export async function deleteFolder(env: Bindings, id: string): Promise<void> {
  const db = createDb(env.DB);
  await db.delete(folders).where(eq(folders.id, id)).run();
  await invalidateCache(env, ["/api/public/folders", "/api/public/feeds"]);
}

// ─── Tags ────────────────────────────────────────────────────────────────────

export async function listTags(env: Bindings): Promise<any[]> {
  const db = createDb(env.DB);
  const tagRows = await db.select().from(tags).all();

  const counts = await db.select({
    tagId: feedTags.tagId,
    count: sql<number>`count(*)`,
  }).from(feedTags).groupBy(feedTags.tagId).all();
  const countMap = new Map(counts.map((r) => [r.tagId, r.count]));

  return tagRows.map((t) => ({
    id: t.id,
    name: t.name,
    feedCount: countMap.get(t.id) ?? 0,
  }));
}

export async function createTag(env: Bindings, name: string): Promise<{ id: string; success: true }> {
  const db = createDb(env.DB);
  const id = crypto.randomUUID();
  await db.insert(tags).values({ id, name }).run();
  await invalidateCache(env, ["/api/public/tags"]);
  return { id, success: true };
}

export async function updateTag(env: Bindings, id: string, name: string): Promise<void> {
  await env.DB.prepare("UPDATE tags SET name = ? WHERE id = ?").bind(name, id).run();
  await invalidateCache(env, ["/api/public/tags"]);
}

export async function deleteTag(env: Bindings, id: string): Promise<void> {
  const db = createDb(env.DB);
  await db.delete(tags).where(eq(tags.id, id)).run();
  await invalidateCache(env, ["/api/public/tags", "/api/public/feeds"]);
}

// ─── Search ──────────────────────────────────────────────────────────────────

export async function searchArticles(env: Bindings, query: string, limit: number = 20): Promise<any[]> {
  const db = createDb(env.DB);
  if (!query) return [];

  return db.select({
    id: articles.id,
    feedId: articles.feedId,
    feedTitle: feeds.title,
    title: articles.title,
    url: articles.url,
    author: articles.author,
    summary: articles.summary,
    publishedAt: articles.publishedAt,
  }).from(articles).leftJoin(feeds, eq(articles.feedId, feeds.id))
    .where(sql`${articles.title} LIKE ${`%${query}%`} OR ${articles.summary} LIKE ${`%${query}%`}`)
    .orderBy(desc(articles.publishedAt)).limit(limit).all();
}

// ─── Stats ──────────────────────────────────────────────────────────────────

export async function getUnreadCounts(env: Bindings): Promise<Record<string, number>> {
  const db = createDb(env.DB);
  const counts = await db.select({
    feedId: articles.feedId,
    unread: sql<number>`count(*)`,
  }).from(articles).where(eq(articles.read, false)).groupBy(articles.feedId).all();

  const map: Record<string, number> = {};
  for (const row of counts as any[]) map[row.feedId] = row.unread;
  return map;
}