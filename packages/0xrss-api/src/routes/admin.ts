import { Hono } from "hono";
import type { Bindings, Variables } from "../types";
import { authMiddleware, adminMiddleware } from "../middleware/auth";
import { createDb } from "../db/client";
import { feeds, articles, folders, tags, feedTags } from "../db/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { invalidateCache } from "../middleware/cache";

export const adminRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// All admin routes require admin authentication
adminRoutes.use("/api/admin/*", authMiddleware, adminMiddleware);

// Admin responses must not be cached by Cloudflare CDN
// Must recreate Response object — c.res.headers.set() doesn't reliably persist
adminRoutes.use("/api/admin/*", async (c, next) => {
  await next();
  const headers = new Headers(c.res.headers);
  headers.set("Cache-Control", "no-store, no-transform");
  headers.set("Pragma", "no-cache");
  headers.set("Vary", "Authorization, Origin, Cookie");
  c.res = new Response(c.res.body, {
    status: c.res.status,
    statusText: c.res.statusText,
    headers,
  });
});

// ─── Feeds ─────────────────────────────────────────────────────────────────
adminRoutes.get("/api/admin/feeds", async (c) => {
  const db = createDb(c.env.DB);
  const allFeeds = await db.select().from(feeds).orderBy(desc(feeds.createdAt)).all();
  return c.json(allFeeds);
});

adminRoutes.post("/api/admin/feeds", async (c) => {
  const db = createDb(c.env.DB);
  const { title, url, siteUrl, description, folderId, tagIds } = await c.req.json();
  if (!url) return c.json({ error: "Feed URL is required" }, 400);

  const id = crypto.randomUUID();
  const now = new Date();
  try {
    await db.insert(feeds).values({
      id, title: title || url, url, siteUrl: siteUrl || null,
      description: description || null, folderId: folderId || null,
      refreshInterval: 30, autoRefresh: true, lastFetched: null,
      createdAt: now, updatedAt: now,
    }).run();

    if (tagIds && Array.isArray(tagIds)) {
      for (const tagId of tagIds) {
        await db.insert(feedTags).values({ feedId: id, tagId }).run();
      }
    }

    // Invalidate public cache
    await invalidateCache(c.env, ["/api/public/feeds", "/api/public/articles", "/api/public/folders", "/api/public/tags"]);

    return c.json({ id, success: true }, 201);
  } catch (err: any) {
    if (err.message?.includes("UNIQUE")) return c.json({ error: "Feed URL already exists" }, 409);
    return c.json({ error: "Failed to create feed" }, 500);
  }
});

adminRoutes.get("/api/admin/feeds/:id", async (c) => {
  const db = createDb(c.env.DB);
  const feed = await db.select().from(feeds).where(eq(feeds.id, c.req.param("id"))).get();
  if (!feed) return c.json({ error: "Feed not found" }, 404);
  return c.json(feed);
});

adminRoutes.patch("/api/admin/feeds/:id", async (c) => {
  const db = createDb(c.env.DB);
  const body = await c.req.json();
  const updates: Record<string, any> = { updatedAt: new Date() };
  for (const key of ["title", "siteUrl", "description", "folderId", "refreshInterval", "autoRefresh"]) {
    if (body[key] !== undefined) updates[key] = body[key];
  }

  // D1 requires .returning().all() for UPDATEs to persist
  const result = await db.update(feeds).set(updates).where(eq(feeds.id, c.req.param("id"))).returning().all();
  console.log(`[admin] PATCH feeds/${c.req.param("id")} updates:`, JSON.stringify(updates), `result rows:`, result.length);

  if (body.tagIds && Array.isArray(body.tagIds)) {
    await db.delete(feedTags).where(eq(feedTags.feedId, c.req.param("id"))).run();
    for (const tagId of body.tagIds) {
      await db.insert(feedTags).values({ feedId: c.req.param("id"), tagId }).run();
    }
  }

  await invalidateCache(c.env, ["/api/public/feeds", "/api/public/articles", "/api/public/tags"]);

  const updated = await db.select().from(feeds).where(eq(feeds.id, c.req.param("id"))).get();
  return c.json(updated);
});

adminRoutes.delete("/api/admin/feeds/:id", async (c) => {
  const db = createDb(c.env.DB);
  await db.delete(feeds).where(eq(feeds.id, c.req.param("id"))).run();
  await invalidateCache(c.env, ["/api/public/feeds", "/api/public/articles", "/api/public/folders", "/api/public/tags"]);
  return c.json({ success: true });
});

// ─── Articles ──────────────────────────────────────────────────────────────
adminRoutes.get("/api/admin/articles", async (c) => {
  const db = createDb(c.env.DB);
  const feedId = c.req.query("feedId");
  const limit = parseInt(c.req.query("limit") || "50");
  const offset = parseInt(c.req.query("offset") || "0");

  const conditions = [];
  if (feedId) conditions.push(eq(articles.feedId, feedId));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const result = await db.select().from(articles)
    .where(where).orderBy(desc(articles.publishedAt)).limit(limit).offset(offset).all();
  return c.json(result);
});

adminRoutes.get("/api/admin/articles/:id", async (c) => {
  const db = createDb(c.env.DB);
  const article = await db.select().from(articles).where(eq(articles.id, c.req.param("id"))).get();
  if (!article) return c.json({ error: "Article not found" }, 404);
  return c.json(article);
});

adminRoutes.patch("/api/admin/articles/:id", async (c) => {
  const db = createDb(c.env.DB);
  const body = await c.req.json();
  const updates: Record<string, any> = {};
  if (body.read !== undefined) updates.read = body.read;
  if (body.bookmarked !== undefined) updates.bookmarked = body.bookmarked;
  if (body.readLater !== undefined) updates.readLater = body.readLater;
  await db.update(articles).set(updates).where(eq(articles.id, c.req.param("id"))).returning().all();
  return c.json({ success: true });
});

adminRoutes.delete("/api/admin/articles/:id", async (c) => {
  const db = createDb(c.env.DB);
  await db.delete(articles).where(eq(articles.id, c.req.param("id"))).run();
  await invalidateCache(c.env, ["/api/public/articles"]);
  return c.json({ success: true });
});

// ─── Folders ───────────────────────────────────────────────────────────────
adminRoutes.get("/api/admin/folders", async (c) => {
  const db = createDb(c.env.DB);
  return c.json(await db.select().from(folders).orderBy(folders.order).all());
});

adminRoutes.post("/api/admin/folders", async (c) => {
  const db = createDb(c.env.DB);
  const { name, order } = await c.req.json();
  if (!name) return c.json({ error: "Folder name is required" }, 400);
  const id = crypto.randomUUID();
  await db.insert(folders).values({ id, name, order: order ?? 0, createdAt: new Date() }).run();
  await invalidateCache(c.env, ["/api/public/folders"]);
  return c.json({ id, success: true }, 201);
});

adminRoutes.patch("/api/admin/folders/:id", async (c) => {
  const db = createDb(c.env.DB);
  const body = await c.req.json();
  const updates: Record<string, any> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.order !== undefined) updates.order = body.order;
  await db.update(folders).set(updates).where(eq(folders.id, c.req.param("id"))).returning().all();
  await invalidateCache(c.env, ["/api/public/folders", "/api/public/feeds"]);
  return c.json({ success: true });
});

adminRoutes.delete("/api/admin/folders/:id", async (c) => {
  const db = createDb(c.env.DB);
  await db.delete(folders).where(eq(folders.id, c.req.param("id"))).run();
  await invalidateCache(c.env, ["/api/public/folders", "/api/public/feeds"]);
  return c.json({ success: true });
});

// ─── Tags ──────────────────────────────────────────────────────────────────
adminRoutes.get("/api/admin/tags", async (c) => {
  const db = createDb(c.env.DB);
  return c.json(await db.select().from(tags).all());
});

adminRoutes.post("/api/admin/tags", async (c) => {
  const db = createDb(c.env.DB);
  const { name } = await c.req.json();
  if (!name) return c.json({ error: "Tag name is required" }, 400);
  const id = crypto.randomUUID();
  try {
    await db.insert(tags).values({ id, name }).run();
    await invalidateCache(c.env, ["/api/public/tags"]);
    return c.json({ id, success: true }, 201);
  } catch (err: any) {
    if (err.message?.includes("UNIQUE")) return c.json({ error: "Tag already exists" }, 409);
    return c.json({ error: "Failed to create tag" }, 500);
  }
});

adminRoutes.delete("/api/admin/tags/:id", async (c) => {
  const db = createDb(c.env.DB);
  await db.delete(tags).where(eq(tags.id, c.req.param("id"))).run();
  await invalidateCache(c.env, ["/api/public/tags", "/api/public/feeds"]);
  return c.json({ success: true });
});

// ─── Feed tags ────────────────────────────────────────────────────────────────
adminRoutes.get("/api/admin/feeds/:id/tags", async (c) => {
  const db = createDb(c.env.DB);
  const feedId = c.req.param("id");
  const result = await db.select({ tagId: feedTags.tagId }).from(feedTags)
    .where(eq(feedTags.feedId, feedId)).all();
  return c.json(result);
});

adminRoutes.post("/api/admin/feeds/:id/tags", async (c) => {
  const db = createDb(c.env.DB);
  const feedId = c.req.param("id");
  const { tagIds } = await c.req.json();
  if (!Array.isArray(tagIds)) return c.json({ error: "tagIds array required" }, 400);

  await db.delete(feedTags).where(eq(feedTags.feedId, feedId)).run();
  for (const tagId of tagIds) {
    await db.insert(feedTags).values({ feedId, tagId }).run();
  }

  await invalidateCache(c.env, ["/api/public/feeds", "/api/public/tags"]);
  return c.json({ success: true });
});

// ─── OPML export ──────────────────────────────────────────────────────────────
function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

adminRoutes.get("/api/admin/opml", async (c) => {
  const db = createDb(c.env.DB);
  const allFeeds = await db.select().from(feeds).all();
  const allFolders = await db.select().from(folders).all();

  const folderMap = new Map<string, typeof allFeeds>();
  allFolders.forEach((f) => folderMap.set(f.id, []));
  const uncategorized: typeof allFeeds = [];
  for (const feed of allFeeds) {
    if (feed.folderId && folderMap.has(feed.folderId)) {
      folderMap.get(feed.folderId)!.push(feed);
    } else {
      uncategorized.push(feed);
    }
  }

  const xmlParts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head>',
    '    <title>0xRSS Subscriptions</title>',
    `    <dateCreated>${new Date().toISOString()}</dateCreated>`,
    '  </head>',
    '  <body>',
  ];

  for (const folder of allFolders) {
    const folderFeeds = folderMap.get(folder.id) || [];
    xmlParts.push(`    <outline text="${escapeXml(folder.name)}" title="${escapeXml(folder.name)}">`);
    for (const feed of folderFeeds) {
      xmlParts.push(`      <outline type="rss" text="${escapeXml(feed.title)}" title="${escapeXml(feed.title)}" xmlUrl="${escapeXml(feed.url)}"${feed.siteUrl ? ` htmlUrl="${escapeXml(feed.siteUrl)}"` : ''} />`);
    }
    xmlParts.push('    </outline>');
  }

  for (const feed of uncategorized) {
    xmlParts.push(`    <outline type="rss" text="${escapeXml(feed.title)}" title="${escapeXml(feed.title)}" xmlUrl="${escapeXml(feed.url)}"${feed.siteUrl ? ` htmlUrl="${escapeXml(feed.siteUrl)}"` : ''} />`);
  }

  xmlParts.push('  </body>', '</opml>');

  c.header('Content-Type', 'text/xml; charset=utf-8');
  c.header('Content-Disposition', 'attachment; filename="0xrss-subscriptions.opml"');
  return c.body(xmlParts.join('\n'));
});

adminRoutes.post("/api/admin/opml", async (c) => {
  const db = createDb(c.env.DB);
  const body = await c.req.parseBody();
  const file = body['file'] as File | undefined;
  if (!file) return c.json({ error: "File required" }, 400);

  const text = await file.text();
  const imported = { feeds: 0, skipped: 0, folders: 0 };

  // Simple OPML parser
  const outlineRegex = /<outline[^>]*>/gi;
  const xmlUrlRegex = /xmlUrl="([^"]+)"/i;
  const titleRegex = /(?:text|title)="([^"]*)"/i;
  const htmlUrlRegex = /htmlUrl="([^"]*)"/i;

  for (const match of text.matchAll(outlineRegex)) {
    const line = match[0];
    const xmlUrlMatch = line.match(xmlUrlRegex);
    if (!xmlUrlMatch) continue;

    const url = xmlUrlMatch[1];
    const title = line.match(titleRegex)?.[1] || url;
    const siteUrl = line.match(htmlUrlRegex)?.[1] || null;

    try {
      const id = crypto.randomUUID();
      await db.insert(feeds).values({
        id, title, url, siteUrl, folderId: null,
        refreshInterval: 30, autoRefresh: true, lastFetched: null,
        createdAt: new Date(), updatedAt: new Date(),
      }).run();
      imported.feeds++;
    } catch (err: any) {
      if (err.message?.includes('UNIQUE')) imported.skipped++;
    }
  }

  await invalidateCache(c.env, ["/api/public/feeds", "/api/public/articles"]);
  return c.json(imported);
});

// ─── Search ──────────────────────────────────────────────────────────────────
adminRoutes.get("/api/admin/search", async (c) => {
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

  return c.json(results);
});

// ─── Stats ─────────────────────────────────────────────────────────────────
adminRoutes.get("/api/admin/stats/unread-counts", async (c) => {
  const db = createDb(c.env.DB);
  const counts = await db.select({
    feedId: articles.feedId,
    unread: sql<number>`count(*)`,
  }).from(articles).where(eq(articles.read, false)).groupBy(articles.feedId).all();

  const map: Record<string, number> = {};
  for (const row of counts as any[]) map[row.feedId] = row.unread;
  return c.json(map);
});

// ─── Cron trigger ──────────────────────────────────────────────────────────
adminRoutes.post("/api/admin/fetch-feeds", async (c) => {
  const db = createDb(c.env.DB);
  const allFeeds = await db.select().from(feeds).all();
  let queued = 0;
  for (const feed of allFeeds) {
    if (!feed.autoRefresh) continue;
    await c.env.FEED_QUEUE.send({ feedId: feed.id });
    queued++;
  }
  return c.json({ success: true, feedsQueued: queued });
});