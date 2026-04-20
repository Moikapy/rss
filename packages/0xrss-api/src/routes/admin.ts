import { Hono } from "hono";
import type { Bindings, Variables } from "../types";
import { authMiddleware, adminMiddleware } from "../middleware/auth";
import { invalidateCache } from "../middleware/cache";
import { createDb } from "../db/client";
import { feedTags } from "../db/schema";
import { eq } from "drizzle-orm";
import {
  listFeeds, getFeed, createFeed, updateFeed, deleteFeed,
  listArticles, getArticle, updateArticle, deleteArticle,
  listFolders, createFolder, updateFolder, deleteFolder,
  listTags, createTag, updateTag, deleteTag,
  searchArticles, getUnreadCounts,
} from "../lib/db-sdk";
import { refreshFeedsInline } from "../lib/feed-processor";

export const adminRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// All admin routes require admin authentication
adminRoutes.use("/api/admin/*", authMiddleware, adminMiddleware);

// Admin responses must not be cached by Cloudflare CDN
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
adminRoutes.get("/api/admin/feeds", async (c) => c.json(await listFeeds(c.env)));

adminRoutes.post("/api/admin/feeds", async (c) => {
  const { title, url, siteUrl, description, folderId, tagIds } = await c.req.json();
  if (!url) return c.json({ error: "Feed URL is required" }, 400);
  try {
    return c.json(await createFeed(c.env, { title, url, siteUrl, description, folderId, tagIds }), 201);
  } catch (err: any) {
    if (err.message?.includes("UNIQUE")) return c.json({ error: "Feed URL already exists" }, 409);
    return c.json({ error: "Failed to create feed" }, 500);
  }
});

adminRoutes.get("/api/admin/feeds/:id", async (c) => {
  const feed = await getFeed(c.env, c.req.param("id"));
  if (!feed) return c.json({ error: "Feed not found" }, 404);
  return c.json(feed);
});

adminRoutes.patch("/api/admin/feeds/:id", async (c) => {
  const body = await c.req.json();
  const result = await updateFeed(c.env, c.req.param("id"), body);
  if (!result) return c.json({ error: "Feed not found" }, 404);
  return c.json(result);
});

adminRoutes.delete("/api/admin/feeds/:id", async (c) => {
  await deleteFeed(c.env, c.req.param("id"));
  return c.json({ success: true });
});

// ─── Articles ──────────────────────────────────────────────────────────────
adminRoutes.get("/api/admin/articles", async (c) => {
  const feedId = c.req.query("feedId");
  const limit = parseInt(c.req.query("limit") || "50");
  const offset = parseInt(c.req.query("offset") || "0");
  return c.json(await listArticles(c.env, { feedId, limit, offset }));
});

adminRoutes.get("/api/admin/articles/:id", async (c) => {
  const article = await getArticle(c.env, c.req.param("id"));
  if (!article) return c.json({ error: "Article not found" }, 404);
  return c.json(article);
});

adminRoutes.patch("/api/admin/articles/:id", async (c) => {
  const body = await c.req.json();
  await updateArticle(c.env, c.req.param("id"), body);
  return c.json({ success: true });
});

adminRoutes.delete("/api/admin/articles/:id", async (c) => {
  await deleteArticle(c.env, c.req.param("id"));
  return c.json({ success: true });
});

// ─── Folders ───────────────────────────────────────────────────────────────
adminRoutes.get("/api/admin/folders", async (c) => c.json(await listFolders(c.env)));

adminRoutes.post("/api/admin/folders", async (c) => {
  const { name, order } = await c.req.json();
  if (!name) return c.json({ error: "Folder name is required" }, 400);
  return c.json(await createFolder(c.env, name, order), 201);
});

adminRoutes.patch("/api/admin/folders/:id", async (c) => {
  const body = await c.req.json();
  await updateFolder(c.env, c.req.param("id"), body);
  return c.json({ success: true });
});

adminRoutes.delete("/api/admin/folders/:id", async (c) => {
  await deleteFolder(c.env, c.req.param("id"));
  return c.json({ success: true });
});

// ─── Tags ──────────────────────────────────────────────────────────────────
adminRoutes.get("/api/admin/tags", async (c) => c.json(await listTags(c.env)));

adminRoutes.post("/api/admin/tags", async (c) => {
  const { name } = await c.req.json();
  if (!name) return c.json({ error: "Tag name is required" }, 400);
  try {
    return c.json(await createTag(c.env, name), 201);
  } catch (err: any) {
    if (err.message?.includes("UNIQUE")) return c.json({ error: "Tag already exists" }, 409);
    return c.json({ error: "Failed to create tag" }, 500);
  }
});

adminRoutes.patch("/api/admin/tags/:id", async (c) => {
  const { name } = await c.req.json();
  if (!name) return c.json({ error: "Tag name is required" }, 400);
  await updateTag(c.env, c.req.param("id"), name);
  return c.json({ success: true });
});

adminRoutes.delete("/api/admin/tags/:id", async (c) => {
  await deleteTag(c.env, c.req.param("id"));
  return c.json({ success: true });
});

// ─── Feed tags ────────────────────────────────────────────────────────────────
adminRoutes.get("/api/admin/feeds/:id/tags", async (c) => {
  const db = createDb(c.env.DB);
  const result = await db.select({ tagId: feedTags.tagId }).from(feedTags)
    .where(eq(feedTags.feedId, c.req.param("id"))).all();
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
  const allFeeds = await listFeeds(c.env);
  const allFolders = await listFolders(c.env);

  const folderMap = new Map<string, typeof allFeeds>();
  allFolders.forEach((f: any) => folderMap.set(f.id, []));
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
      await createFeed(c.env, { title, url, siteUrl });
      imported.feeds++;
    } catch (err: any) {
      if (err.message?.includes('UNIQUE')) imported.skipped++;
    }
  }

  return c.json(imported);
});

// ─── Search ──────────────────────────────────────────────────────────────────
adminRoutes.get("/api/admin/search", async (c) => {
  const q = c.req.query("q") || "";
  const limit = parseInt(c.req.query("limit") || "20");
  return c.json(await searchArticles(c.env, q, limit));
});

// ─── Stats ─────────────────────────────────────────────────────────────────
adminRoutes.get("/api/admin/stats/unread-counts", async (c) => {
  return c.json(await getUnreadCounts(c.env));
});

// ─── Cron trigger ──────────────────────────────────────────────────────────
adminRoutes.post("/api/admin/fetch-feeds", async (c) => {
  try {
    const result = await refreshFeedsInline(c.env);
    return c.json({
      success: true,
      feedsProcessed: result.feedsProcessed,
      totalNewArticles: result.totalNewArticles,
      skipped: result.skipped,
      errors: result.errors.length > 0 ? result.errors : undefined,
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});