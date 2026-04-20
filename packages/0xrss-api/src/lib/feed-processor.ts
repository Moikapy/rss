/**
 * Feed fetching, parsing, and content extraction for Cloudflare Workers.
 * Handles RSS, Atom, and JSON Feed formats.
 */

import { createDb } from "../db/client";
import { feeds, articles } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { invalidateCache } from "../middleware/cache";
import type { Bindings } from "../types";

export interface ParsedFeed {
  title: string;
  siteUrl: string | null;
  description: string | null;
  items: ParsedArticle[];
}

export interface ParsedArticle {
  title: string;
  url: string;
  author: string | null;
  summary: string | null;
  content: string | null;
  publishedAt: Date;
}

export interface FeedResult {
  feedId: string;
  feedTitle: string;
  newArticles: number;
  errors: string[];
  skipped?: boolean; // true if feed was not modified (ETag/Last-Modified)
}

// ─── KV helpers for ETag/conditional caching ───────────────────────────────

function etagCacheKey(feedId: string): string {
  return `feed:etag:${feedId}`;
}

async function getCachedEtags(env: Bindings, feedIds: string[]): Promise<Map<string, { etag?: string; lastModified?: string }>> {
  const map = new Map<string, { etag?: string; lastModified?: string }>();
  // KV list is not available in all contexts, so we get keys individually
  const results = await Promise.all(
    feedIds.map(async (id) => {
      try {
        const raw = await env.CACHE.get(etagCacheKey(id));
        if (raw) return { id, ...JSON.parse(raw) };
      } catch { /* ignore */ }
      return null;
    })
  );
  for (const r of results) {
    if (r) map.set(r.id, { etag: r.etag, lastModified: r.lastModified });
  }
  return map;
}

async function cacheEtag(env: Bindings, feedId: string, etag?: string, lastModified?: string): Promise<void> {
  if (!etag && !lastModified) return;
  await env.CACHE.put(etagCacheKey(feedId), JSON.stringify({ etag, lastModified }), { expirationTtl: 86400 * 7 }); // 7 day TTL
}

// ─── Fetch + Parse (with ETag/conditional support) ────────────────────────

export interface FeedFetchOptions {
  etag?: string;
  lastModified?: string;
}

export interface FetchAndParseResult {
  parsed: ParsedFeed;
  etag?: string;
  lastModified?: string;
  notModified: boolean;
}

export async function fetchAndParseFeed(
  feedUrl: string,
  options?: FeedFetchOptions,
): Promise<FetchAndParseResult> {
  const headers: Record<string, string> = {
    "User-Agent": "0xRSS/1.0 (Feed Reader; https://rss.moikapy.dev)",
    Accept: "application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml, */*",
  };

  // Conditional request — skip download if feed hasn't changed
  if (options?.etag) headers["If-None-Match"] = options.etag;
  if (options?.lastModified) headers["If-Modified-Since"] = options.lastModified;

  const response = await fetch(feedUrl, {
    headers,
    signal: AbortSignal.timeout(15000),
  });

  // 304 Not Modified — feed hasn't changed, no need to re-parse
  if (response.status === 304) {
    return { parsed: { title: "", siteUrl: null, description: null, items: [] }, notModified: true };
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${feedUrl}`);
  }

  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();

  let parsed: ParsedFeed;
  if (contentType.includes("json") || text.trim().startsWith("{")) {
    parsed = parseJsonFeed(text);
  } else {
    parsed = parseXmlFeed(text);
  }

  return {
    parsed,
    etag: response.headers.get("etag") || undefined,
    lastModified: response.headers.get("last-modified") || undefined,
    notModified: false,
  };
}

// ─── JSON Feed ──────────────────────────────────────────────────────────────

export function parseJsonFeed(text: string): ParsedFeed {
  const data = JSON.parse(text);
  return {
    title: stripHtmlTags(decodeHTMLEntities(data.title || "Untitled Feed")),
    siteUrl: data.home_page_url || null,
    description: data.description ? stripHtmlTags(decodeHTMLEntities(data.description)) : null,
    items: (data.items || []).map((item: any) => ({
      title: stripHtmlTags(decodeHTMLEntities(item.title || "Untitled")),
      url: item.url || "",
      author: item.author?.name || null,
      summary: item.summary ? stripHtmlTags(decodeHTMLEntities(item.summary)) : null,
      content: item.content_html || item.content_text || null,
      publishedAt: item.date_published ? new Date(item.date_published) : new Date(),
    })),
  };
}

// ─── XML Feed (RSS/Atom) ───────────────────────────────────────────────────

export function parseXmlFeed(text: string): ParsedFeed {
  const feed: ParsedFeed = {
    title: stripHtmlTags(decodeHTMLEntities(extractText(text, "title") || "")) || "Untitled Feed",
    siteUrl:
      extractAlternateLink(text) ||
      extractAttr(text, "link", "href") ||
      extractText(text, "link") ||
      null,
    description: extractText(text, "description") || null,
    items: [],
  };

  // Extract items (RSS <item> or Atom <entry>)
  const itemRegex = /<(?:item|entry)[\s>]([\s\S]*?)(?:<\/(?:item|entry)>)/gi;
  let match;

  while ((match = itemRegex.exec(text)) !== null) {
    const itemXml = match[1];

    // Prefer Atom <link rel="alternate"> for the article URL
    const url =
      extractAlternateLink(itemXml) ||
      extractText(itemXml, "link") ||
      "";

    const article: ParsedArticle = {
      title: stripHtmlTags(decodeHTMLEntities(extractText(itemXml, "title") || "")) || "Untitled",
      url,
      author:
        extractText(itemXml, "author > name") ||
        extractText(itemXml, "dc:creator") ||
        extractText(itemXml, "author") ||
        null,
      summary:
        extractText(itemXml, "summary") ||
        extractText(itemXml, "description") ||
        null,
      content:
        extractText(itemXml, "content:encoded") ||
        extractText(itemXml, "content") ||
        null,
      publishedAt: parseDate(
        extractText(itemXml, "published") ||
        extractText(itemXml, "updated") ||
        extractText(itemXml, "pubDate") ||
        ""
      ),
    };

    if (article.url) {
      feed.items.push(article);
    }
  }

  return feed;
}

// ─── Content Extraction ────────────────────────────────────────────────────

export async function extractContent(url: string): Promise<{ content: string | null; byline: string | null }> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "0xRSS/1.0 (Feed Reader; https://rss.moikapy.dev)",
        Accept: "text/html,application/xhtml+xml,*/*",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) return { content: null, byline: null };

    const html = await response.text();
    const { document } = parseHTML(html);
    const reader = new Readability(document as any);
    const article = reader.parse();

    if (!article?.content) return { content: null, byline: article?.byline ?? null };

    return {
      content: sanitizeHtml(article.content),
      byline: article.byline ?? null,
    };
  } catch {
    return { content: null, byline: null };
  }
}

export function sanitizeHtml(html: string): string {
  return decodeHTMLEntities(html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/on\w+="[^"]*"/gi, "")
    .replace(/on\w+='[^']*'/gi, "")
    .replace(/javascript:/gi, ""));
}

// ─── Feed Processing (with ETag caching) ─────────────────────────────────────

export async function processFeed(feedId: string, env: Bindings): Promise<FeedResult> {
  const db = createDb(env.DB);
  const feed = await db.select().from(feeds).where(eq(feeds.id, feedId)).get();

  const result: FeedResult = {
    feedId,
    feedTitle: feed?.title ?? "Unknown",
    newArticles: 0,
    errors: [],
  };

  if (!feed) {
    result.errors.push("Feed not found");
    return result;
  }

  try {
    // Check KV for cached ETag/Last-Modified
    let cachedEtag: string | undefined;
    let cachedLastModified: string | undefined;
    try {
      const raw = await env.CACHE.get(etagCacheKey(feedId));
      if (raw) {
        const cached = JSON.parse(raw);
        cachedEtag = cached.etag;
        cachedLastModified = cached.lastModified;
      }
    } catch { /* ignore cache read errors */ }

    const { parsed, etag, lastModified, notModified } = await fetchAndParseFeed(feed.url, {
      etag: cachedEtag,
      lastModified: cachedLastModified,
    });

    // Feed not modified — skip entirely
    if (notModified) {
      console.log(`Feed ${feedId}: not modified (304), skipping`);
      return { feedId, feedTitle: feed.title, newArticles: 0, errors: [], skipped: true };
    }

    // Cache the new ETag/Last-Modified for next time
    await cacheEtag(env, feedId, etag, lastModified);

    // Update feed metadata — only overwrite fields the user hasn't customized
    await db.update(feeds)
      .set({
        siteUrl: parsed.siteUrl || feed.siteUrl,
        description: parsed.description || feed.description,
        lastFetched: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(feeds.id, feedId))
      .run();

    // Process articles — pre-fetch all existing URLs to avoid O(n) queries
    const existingUrls = new Set(
      (await db.select({ url: articles.url })
        .from(articles)
        .where(eq(articles.feedId, feedId))
        .all()).map((r: any) => r.url)
    );

    for (const item of parsed.items) {
      try {
        // Check for duplicate using pre-fetched URL set
        if (existingUrls.has(item.url)) continue;

        // Use content from feed first, then try full extraction
        let content = item.content;
        let author = item.author;

        if (!content && item.url) {
          const extracted = await extractContent(item.url);
          if (extracted.content) content = extracted.content;
          if (extracted.byline && !author) author = extracted.byline;
        }

        // If still no content, use summary as fallback
        if (!content && item.summary) {
          content = item.summary.includes("<") ? item.summary : `<p>${item.summary}</p>`;
        }

        await db.insert(articles).values({
          id: crypto.randomUUID(),
          feedId,
          title: item.title,
          url: item.url,
          author: author || null,
          summary: item.summary || null,
          content: content || null,
          publishedAt: item.publishedAt,
          read: false,
          bookmarked: false,
          readLater: false,
          createdAt: new Date(),
        }).run();

        result.newArticles++;
        existingUrls.add(item.url); // Track inserted URLs to avoid retrying
      } catch (err: any) {
        // Ignore unique constraint violations (race condition on duplicate)
        if (err.message?.includes("UNIQUE") || err.message?.includes("ConstraintError")) continue;
        result.errors.push(`Article "${item.title}": ${err.message}`);
      }
    }

    // Invalidate cached article lists if we found new articles
    if (result.newArticles > 0) {
      await invalidateCache(env, ["/api/public/articles", "/api/public/feeds"]);
    }
  } catch (err: any) {
    result.errors.push(`Feed fetch: ${err.message}`);
  }

  return result;
}

// ─── Inline Batch Refresh (for manual "Refresh all") ───────────────────────

/**
 * Process feeds inline with ETag caching and concurrency control.
 * Used by the "Refresh all" button for immediate feedback.
 * Returns results as they complete — caller can stream or aggregate.
 */
export async function refreshFeedsInline(
  env: Bindings,
): Promise<{ feedsProcessed: number; totalNewArticles: number; errors: string[]; skipped: number }> {
  const db = createDb(env.DB);
  const allFeeds = await db.select().from(feeds).all();
  const activeFeeds = allFeeds.filter((f) => f.autoRefresh);

  // Get cached ETags in batch
  const etagMap = await getCachedEtags(env, activeFeeds.map((f) => f.id));

  let feedsProcessed = 0;
  let totalNewArticles = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Process feeds concurrently (max 5 at a time to avoid D1 concurrency limits)
  const CONCURRENCY = 5;
  for (let i = 0; i < activeFeeds.length; i += CONCURRENCY) {
    const batch = activeFeeds.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((feed) =>
        processFeed(feed.id, env).catch((err) => ({
          feedId: feed.id,
          feedTitle: feed.title,
          newArticles: 0,
          errors: [err.message],
          skipped: false,
        }))
      ),
    );

    for (const r of results) {
      if (r.status === "fulfilled") {
        feedsProcessed++;
        totalNewArticles += r.value.newArticles;
        if (r.value.skipped) skipped++;
        errors.push(...r.value.errors);
      } else {
        errors.push(r.reason?.message || "Unknown error");
      }
    }
  }

  return { feedsProcessed, totalNewArticles, errors, skipped };
}

// ─── XML Helpers ───────────────────────────────────────────────────────────

export function extractText(xml: string, tag: string): string | null {
  const escapedTag = tag.replace(":", "\\:");
  const regex = new RegExp(`<${escapedTag}[^>]*>([\\s\\S]*?)<\\/${escapedTag}>`, "i");
  const match = xml.match(regex);
  if (!match) return null;

  let content = match[1].trim();
  // Decode CDATA
  if (content.startsWith("<![CDATA[") && content.endsWith("]]>")) {
    content = content.slice(9, -3);
  }
  // Decode HTML entities (RSS feeds often have &#8217; &amp; etc.)
  content = decodeHTMLEntities(content);
  return content || null;
}

/** Decode common HTML entities found in RSS/Atom feeds */
export function decodeHTMLEntities(str: string): string {
  return str
    // Named entities (process &amp; FIRST to avoid double-decoding)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // Numeric entities (decimal) &#8217; → '
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    // Numeric entities (hex) &#x2019; → '
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

/** Strip HTML tags from a string — some RSS feeds put HTML in title/summary fields */
export function stripHtmlTags(str: string): string {
  return str.replace(/<[^\u003e]*>/g, "").trim();
}

export function extractAttr(xml: string, tag: string, attr: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*${attr}=["']([^"']*)["']`, "i");
  const match = xml.match(regex);
  return match ? match[1] : null;
}

/**
 * Extract the correct article URL from Atom <link rel="alternate">.
 * Falls back to first href link, then text content.
 */
export function extractAlternateLink(xml: string): string | null {
  // Atom: <link rel="alternate" href="..." />
  const altMatch = xml.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']*)["']/i) ||
    xml.match(/<link[^>]*href=["']([^"']*)["'][^>]*rel=["']alternate["']/i);
  if (altMatch) return altMatch[1];

  // No alternate link — try first href (may not be correct but better than nothing)
  const firstHref = extractAttr(xml, "link", "href");
  return firstHref;
}

export function parseDate(dateStr: string): Date {
  if (!dateStr) return new Date();
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? new Date() : date;
}