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
}

// ─── Fetch + Parse ─────────────────────────────────────────────────────────

export async function fetchAndParseFeed(feedUrl: string): Promise<ParsedFeed> {
  const response = await fetch(feedUrl, {
    headers: {
      "User-Agent": "0xRSS/1.0 (Feed Reader; https://rss.moikapy.dev)",
      Accept: "application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml, */*",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${feedUrl}`);
  }

  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();

  // JSON Feed
  if (contentType.includes("json") || text.trim().startsWith("{")) {
    return parseJsonFeed(text);
  }

  // RSS or Atom (XML)
  return parseXmlFeed(text);
}

// ─── JSON Feed ──────────────────────────────────────────────────────────────

function parseJsonFeed(text: string): ParsedFeed {
  const data = JSON.parse(text);
  return {
    title: data.title || "Untitled Feed",
    siteUrl: data.home_page_url || null,
    description: data.description || null,
    items: (data.items || []).map((item: any) => ({
      title: item.title || "Untitled",
      url: item.url || "",
      author: item.author?.name || null,
      summary: item.summary || null,
      content: item.content_html || item.content_text || null,
      publishedAt: item.date_published ? new Date(item.date_published) : new Date(),
    })),
  };
}

// ─── XML Feed (RSS/Atom) ───────────────────────────────────────────────────

function parseXmlFeed(text: string): ParsedFeed {
  const feed: ParsedFeed = {
    title: extractText(text, "title") || "Untitled Feed",
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
      title: extractText(itemXml, "title") || "Untitled",
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

function sanitizeHtml(html: string): string {
  return decodeHTMLEntities(html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/on\w+="[^"]*"/gi, "")
    .replace(/on\w+='[^']*'/gi, "")
    .replace(/javascript:/gi, ""));
}

// ─── Feed Processing (queue handler) ───────────────────────────────────────

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
    const parsed = await fetchAndParseFeed(feed.url);

    // Update feed metadata
    await db.update(feeds)
      .set({
        title: parsed.title || feed.title,
        siteUrl: parsed.siteUrl || feed.siteUrl,
        description: parsed.description || feed.description,
        lastFetched: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(feeds.id, feedId))
      .run();

    // Process articles
    for (const item of parsed.items) {
      try {
        // Check for duplicate using the (feedId, url) unique index
        const existing = await db.select({ id: articles.id })
          .from(articles)
          .where(and(eq(articles.feedId, feedId), eq(articles.url, item.url)))
          .get();

        if (existing) continue;

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
          // Wrap summary in a paragraph if it's plain text
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

// ─── XML Helpers ───────────────────────────────────────────────────────────

function extractText(xml: string, tag: string): string | null {
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
function decodeHTMLEntities(str: string): string {
  return str
    // Named entities
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

function extractAttr(xml: string, tag: string, attr: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*${attr}=["']([^"']*)["']`, "i");
  const match = xml.match(regex);
  return match ? match[1] : null;
}

/**
 * Extract the correct article URL from Atom <link rel="alternate">.
 * Falls back to first href link, then text content.
 */
function extractAlternateLink(xml: string): string | null {
  // Atom: <link rel="alternate" href="..." />
  const altMatch = xml.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']*)["']/i) ||
    xml.match(/<link[^>]*href=["']([^"']*)["'][^>]*rel=["']alternate["']/i);
  if (altMatch) return altMatch[1];

  // No alternate link — try first href (may not be correct but better than nothing)
  const firstHref = extractAttr(xml, "link", "href");
  return firstHref;
}

function parseDate(dateStr: string): Date {
  if (!dateStr) return new Date();
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? new Date() : date;
}