/**
 * RAG tools for the AI chat agent.
 *
 * These tools give the LLM access to the user's feeds, articles, and search
 * — all running against D1 directly on the Worker.
 */

import { createDb } from "../db/client";
import { feeds, articles, folders } from "../db/schema";
import { eq, desc, and, sql } from "drizzle-orm";

// ─── Tool Definitions (Ollama format) ──────────────────────────────────────

export const RSS_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "search_articles",
      description:
        "Search articles by keyword. Returns matching articles with title, URL, summary, publish date, and feed name. Use this to find articles about a topic.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query — keywords to find in article titles and summaries",
          },
          limit: {
            type: "number",
            description: "Max results to return (default 5, max 20)",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_feeds",
      description:
        "List all subscribed RSS feeds with their titles, URLs, and unread counts. Use this when the user asks about their subscriptions or feed overview.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_recent_articles",
      description:
        "List recent articles, optionally filtered by feed. Returns title, URL, summary, date, read status, and feed name. Use this for 'what's new' or 'show me recent articles' type questions.",
      parameters: {
        type: "object",
        properties: {
          feed_id: {
            type: "string",
            description: "Optional feed ID to filter by",
          },
          limit: {
            type: "number",
            description: "Max results to return (default 10, max 30)",
          },
          unread_only: {
            type: "boolean",
            description: "Only return unread articles (default false)",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "read_article",
      description:
        "Read the full content of an article by its ID. Returns the article title, URL, author, summary, content (plain text), publish date, and feed name.",
      parameters: {
        type: "object",
        properties: {
          article_id: {
            type: "string",
            description: "The article ID to read",
          },
        },
        required: ["article_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_unread_counts",
      description:
        "Get unread article counts per feed. Use this when the user asks how many unread articles they have.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
];

// ─── Tool Execution ────────────────────────────────────────────────────────

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  db: ReturnType<typeof createDb>,
): Promise<string> {
  switch (name) {
    case "search_articles":
      return await toolSearchArticles(db, args.query as string, (args.limit as number) || 5);
    case "list_feeds":
      return await toolListFeeds(db);
    case "list_recent_articles":
      return await toolListRecentArticles(db, {
        feedId: args.feed_id as string | undefined,
        limit: (args.limit as number) || 10,
        unreadOnly: args.unread_only as boolean | undefined,
      });
    case "read_article":
      return await toolReadArticle(db, args.article_id as string);
    case "get_unread_counts":
      return await toolGetUnreadCounts(db);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// ─── Tool Implementations ──────────────────────────────────────────────────

async function toolSearchArticles(
  db: ReturnType<typeof createDb>,
  query: string,
  limit: number,
): Promise<string> {
  const searchTerm = `%${query}%`;
  const cappedLimit = Math.min(limit, 20);

  const rows = await db
    .select({
      id: articles.id,
      title: articles.title,
      url: articles.url,
      summary: articles.summary,
      publishedAt: articles.publishedAt,
      read: articles.read,
      feedId: articles.feedId,
    })
    .from(articles)
    .where(
      sql`(${articles.title} LIKE ${searchTerm} OR ${articles.summary} LIKE ${searchTerm})`
    )
    .orderBy(desc(articles.publishedAt))
    .limit(cappedLimit)
    .all();

  const results = [];
  for (const row of rows as any[]) {
    const feed = await db
      .select({ title: feeds.title })
      .from(feeds)
      .where(eq(feeds.id, row.feedId))
      .get();
    results.push({
      id: row.id,
      title: row.title,
      url: row.url,
      summary: (row.summary || "").substring(0, 200),
      publishedAt: row.publishedAt?.toISOString?.() || row.publishedAt,
      read: row.read,
      feed: feed?.title || "Unknown",
    });
  }

  return JSON.stringify({ results, count: results.length });
}

async function toolListFeeds(
  db: ReturnType<typeof createDb>,
): Promise<string> {
  const feedRows = await db.select().from(feeds).all();

  const unreadRows = await db
    .select({
      feedId: articles.feedId,
      count: sql<number>`count(*)`,
    })
    .from(articles)
    .where(eq(articles.read, false))
    .groupBy(articles.feedId)
    .all();

  const unreadMap = new Map<string, number>();
  for (const r of unreadRows as any[]) {
    unreadMap.set(r.feedId, r.count);
  }

  const result = (feedRows as any[]).map((f) => ({
    id: f.id,
    title: f.title,
    url: f.url,
    unreadCount: unreadMap.get(f.id) || 0,
  }));

  return JSON.stringify({ feeds: result, total: result.length });
}

async function toolListRecentArticles(
  db: ReturnType<typeof createDb>,
  opts: { feedId?: string; limit: number; unreadOnly?: boolean },
): Promise<string> {
  const { feedId, limit, unreadOnly } = opts;
  const cappedLimit = Math.min(limit, 30);

  const conditions = [];
  if (feedId) conditions.push(eq(articles.feedId, feedId));
  if (unreadOnly) conditions.push(eq(articles.read, false));

  const rows = await db
    .select({
      id: articles.id,
      title: articles.title,
      url: articles.url,
      summary: articles.summary,
      publishedAt: articles.publishedAt,
      read: articles.read,
      bookmarked: articles.bookmarked,
      feedId: articles.feedId,
    })
    .from(articles)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(articles.publishedAt))
    .limit(cappedLimit)
    .all();

  const results = [];
  for (const row of rows as any[]) {
    const feed = await db
      .select({ title: feeds.title })
      .from(feeds)
      .where(eq(feeds.id, row.feedId))
      .get();
    results.push({
      id: row.id,
      title: row.title,
      url: row.url,
      summary: (row.summary || "").substring(0, 200),
      publishedAt: row.publishedAt?.toISOString?.() || row.publishedAt,
      read: row.read,
      bookmarked: row.bookmarked,
      feed: feed?.title || "Unknown",
    });
  }

  return JSON.stringify({ articles: results, count: results.length });
}

async function toolReadArticle(
  db: ReturnType<typeof createDb>,
  articleId: string,
): Promise<string> {
  const row = await db
    .select({
      id: articles.id,
      title: articles.title,
      url: articles.url,
      author: articles.author,
      summary: articles.summary,
      content: articles.content,
      publishedAt: articles.publishedAt,
      read: articles.read,
      bookmarked: articles.bookmarked,
      readLater: articles.readLater,
      feedId: articles.feedId,
    })
    .from(articles)
    .where(eq(articles.id, articleId))
    .get();

  if (!row) {
    return JSON.stringify({ error: "Article not found" });
  }

  const feed = await db
    .select({ title: feeds.title })
    .from(feeds)
    .where(eq(feeds.id, row.feedId))
    .get();

  // Strip HTML for the LLM
  const plainContent = (row.content || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 8000);

  return JSON.stringify({
    id: row.id,
    title: row.title,
    url: row.url,
    author: row.author,
    summary: row.summary,
    content: plainContent,
    publishedAt: row.publishedAt?.toISOString?.() || row.publishedAt,
    read: row.read,
    bookmarked: row.bookmarked,
    readLater: row.readLater,
    feed: feed?.title || "Unknown",
  });
}

async function toolGetUnreadCounts(
  db: ReturnType<typeof createDb>,
): Promise<string> {
  const rows = await db
    .select({
      feedId: articles.feedId,
      count: sql<number>`count(*)`,
    })
    .from(articles)
    .where(eq(articles.read, false))
    .groupBy(articles.feedId)
    .all();

  const total = await db
    .select({ count: sql<number>`count(*)` })
    .from(articles)
    .where(eq(articles.read, false))
    .get();

  const feedUnreads = [];
  for (const r of rows as any[]) {
    const feed = await db
      .select({ title: feeds.title })
      .from(feeds)
      .where(eq(feeds.id, r.feedId))
      .get();
    feedUnreads.push({ feedId: r.feedId, feed: feed?.title || "Unknown", unread: r.count });
  }

  return JSON.stringify({ total: (total as any)?.count || 0, feeds: feedUnreads });
}