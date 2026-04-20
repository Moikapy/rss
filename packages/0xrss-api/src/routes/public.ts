import { Hono } from "hono";
import type { Bindings, Variables } from "../types";
import { cacheMiddleware, CACHE_TTL } from "../middleware/cache";
import {
  listFeeds, listArticles, getArticle, listFolders, listTags, searchArticles,
} from "../lib/db-sdk";
import { eq, desc, sql } from "drizzle-orm";
import { articles, feeds } from "../db/schema";
import { createDb } from "../db/client";

export const publicRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ─── Apply cache middleware to all public routes ────────────────────────────
publicRoutes.use("*", cacheMiddleware);

// ─── Feeds ────────────────────────────────────────────────────────────────
publicRoutes.get("/api/public/feeds", async (c) => {
  const result = await listFeeds(c.env);
  c.header("X-Cache-TTL", String(CACHE_TTL.FEEDS));
  return c.json(result);
});

// ─── Articles ──────────────────────────────────────────────────────────────
publicRoutes.get("/api/public/articles", async (c) => {
  const feedId = c.req.query("feedId");
  const limit = parseInt(c.req.query("limit") || "50");
  const offset = parseInt(c.req.query("offset") || "0");

  const result = await listArticles(c.env, { feedId, limit, offset });
  c.header("X-Cache-TTL", String(CACHE_TTL.ARTICLES));
  return c.json(result);
});

// ─── Article detail ────────────────────────────────────────────────────────
publicRoutes.get("/api/public/articles/:id", async (c) => {
  const article = await getArticle(c.env, c.req.param("id"));
  if (!article) return c.json({ error: "Article not found" }, 404);
  c.header("X-Cache-TTL", String(CACHE_TTL.ARTICLE_DETAIL));
  return c.json(article);
});

// ─── Folders ───────────────────────────────────────────────────────────────
publicRoutes.get("/api/public/folders", async (c) => {
  const result = await listFolders(c.env);
  c.header("X-Cache-TTL", String(CACHE_TTL.FOLDERS));
  return c.json(result);
});

// ─── Tags ──────────────────────────────────────────────────────────────────
publicRoutes.get("/api/public/tags", async (c) => {
  const result = await listTags(c.env);
  c.header("X-Cache-TTL", String(CACHE_TTL.TAGS));
  return c.json(result);
});

// ─── Search ───────────────────────────────────────────────────────────────
publicRoutes.get("/api/public/search", async (c) => {
  const q = c.req.query("q") || "";
  const limit = parseInt(c.req.query("limit") || "20");
  const result = await searchArticles(c.env, q, limit);
  c.header("X-Cache-TTL", String(CACHE_TTL.ARTICLES));
  return c.json(result);
});