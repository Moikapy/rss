import { Hono } from "hono";
import type { Bindings, Variables } from "../types";
import { cacheMiddleware, CACHE_TTL } from "../middleware/cache";
import { createDb } from "../db/client";
import { feeds, articles, folders, tags, feedTags } from "../db/schema";
import { eq, desc, and, sql, like } from "drizzle-orm";

export const publicRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ─── Apply cache middleware to all public routes ────────────────────────────
publicRoutes.use("*", cacheMiddleware);

// ─── Feeds ────────────────────────────────────────────────────────────────
publicRoutes.get("/api/public/feeds", async (c) => {
  const db = createDb(c.env.DB);

  const allFeeds = await db.select({
    id: feeds.id,
    title: feeds.title,
    url: feeds.url,
    siteUrl: feeds.siteUrl,
    description: feeds.description,
    folderId: feeds.folderId,
    lastFetched: feeds.lastFetched,
  }).from(feeds).orderBy(desc(feeds.createdAt)).all();

  // Get folder names and tag names for each feed
  const folderRows = await db.select().from(folders).all();
  const folderMap = new Map(folderRows.map((f) => [f.id, f.name]));

  const tagRows = await db.select({
    feedId: feedTags.feedId,
    tagName: tags.name,
  }).from(feedTags).leftJoin(tags, eq(feedTags.tagId, tags.id)).all();
  const tagMap = new Map<string, string[]>();
  for (const row of tagRows) {
    if (!tagMap.has(row.feedId)) tagMap.set(row.feedId, []);
    if (row.tagName) tagMap.get(row.feedId)!.push(row.tagName);
  }

  // Get article counts per feed
  const counts = await db.select({
    feedId: articles.feedId,
    count: sql<number>`count(*)`,
  }).from(articles).groupBy(articles.feedId).all();
  const countMap = new Map(counts.map((r) => [r.feedId, r.count]));

  const result = allFeeds.map((f) => ({
    ...f,
    folderName: f.folderId ? folderMap.get(f.folderId) ?? null : null,
    tagNames: tagMap.get(f.id) ?? [],
    articleCount: countMap.get(f.id) ?? 0,
  }));

  c.header("X-Cache-TTL", String(CACHE_TTL.FEEDS));
  return c.json(result);
});

// ─── Articles ──────────────────────────────────────────────────────────────
publicRoutes.get("/api/public/articles", async (c) => {
  const db = createDb(c.env.DB);
  const feedId = c.req.query("feedId");
  const limit = parseInt(c.req.query("limit") || "50");
  const offset = parseInt(c.req.query("offset") || "0");

  const conditions = [];
  if (feedId) conditions.push(eq(articles.feedId, feedId));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const result = await db.select({
    id: articles.id,
    feedId: articles.feedId,
    feedTitle: feeds.title,
    title: articles.title,
    url: articles.url,
    author: articles.author,
    summary: articles.summary,
    publishedAt: articles.publishedAt,
  }).from(articles).leftJoin(feeds, eq(articles.feedId, feeds.id))
    .where(where).orderBy(desc(articles.publishedAt)).limit(limit).offset(offset).all();

  c.header("X-Cache-TTL", String(CACHE_TTL.ARTICLES));
  return c.json(result);
});

// ─── Article detail ────────────────────────────────────────────────────────
publicRoutes.get("/api/public/articles/:id", async (c) => {
  const db = createDb(c.env.DB);
  const article = await db.select().from(articles)
    .where(eq(articles.id, c.req.param("id"))).get();

  if (!article) return c.json({ error: "Article not found" }, 404);

  c.header("X-Cache-TTL", String(CACHE_TTL.ARTICLE_DETAIL));
  return c.json(article);
});

// ─── Folders ───────────────────────────────────────────────────────────────
publicRoutes.get("/api/public/folders", async (c) => {
  const db = createDb(c.env.DB);

  const folderRows = await db.select().from(folders).orderBy(folders.order).all();

  // Get feed count per folder
  const counts = await db.select({
    folderId: feeds.folderId,
    count: sql<number>`count(*)`,
  }).from(feeds).where(sql`${feeds.folderId} is not null`).groupBy(feeds.folderId).all();
  const countMap = new Map(counts.map((r) => [r.folderId, r.count]));

  const result = folderRows.map((f) => ({
    id: f.id,
    name: f.name,
    feedCount: countMap.get(f.id) ?? 0,
  }));

  c.header("X-Cache-TTL", String(CACHE_TTL.FOLDERS));
  return c.json(result);
});

// ─── Tags ──────────────────────────────────────────────────────────────────
publicRoutes.get("/api/public/tags", async (c) => {
  const db = createDb(c.env.DB);

  const tagRows = await db.select().from(tags).all();

  // Get feed count per tag
  const counts = await db.select({
    tagId: feedTags.tagId,
    count: sql<number>`count(*)`,
  }).from(feedTags).groupBy(feedTags.tagId).all();
  const countMap = new Map(counts.map((r) => [r.tagId, r.count]));

  const result = tagRows.map((t) => ({
    id: t.id,
    name: t.name,
    feedCount: countMap.get(t.id) ?? 0,
  }));

  c.header("X-Cache-TTL", String(CACHE_TTL.TAGS));
  return c.json(result);
});

// ─── Search ───────────────────────────────────────────────────────────────
publicRoutes.get("/api/public/search", async (c) => {
  const db = createDb(c.env.DB);
  const q = c.req.query("q") || "";
  const limit = parseInt(c.req.query("limit") || "20");
  if (!q) return c.json([]);

  const results = await db.select({
    id: articles.id,
    feedId: articles.feedId,
    feedTitle: feeds.title,
    title: articles.title,
    url: articles.url,
    author: articles.author,
    summary: articles.summary,
    publishedAt: articles.publishedAt,
  }).from(articles).leftJoin(feeds, eq(articles.feedId, feeds.id))
    .where(sql`${articles.title} LIKE ${`%${q}%`} OR ${articles.summary} LIKE ${`%${q}%`}`)
    .orderBy(desc(articles.publishedAt)).limit(limit).all();

  c.header("X-Cache-TTL", String(CACHE_TTL.ARTICLES));
  return c.json(results);
});