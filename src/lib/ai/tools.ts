import { getDatabase } from "@/lib/db/get-db";
import { articles, feeds, folders, tags, feedTags } from "@/lib/db/schema";
import { eq, desc, sql, and, like } from "drizzle-orm";
import { search as ddgSearch, searchNews as ddgSearchNews } from "duck-duck-scrape";

// ─── Tool Definitions (Ollama format) ──────────────────────────────────────

export const RSS_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "read_article",
      description:
        "Read the full content of an article by its ID. Returns the article title, URL, author, summary, full HTML content, publish date, and feed name. Use this when the user asks about a specific article or wants details.",
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
        "List all subscribed RSS feeds with their titles, URLs, folder, and unread counts. Use this when the user asks about their subscriptions or feed overview.",
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
        "List recent articles, optionally filtered by feed, folder, or tag. Returns title, URL, summary, date, read status, and feed name. Use this for 'what's new' or 'show me recent articles' type questions.",
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
      name: "get_unread_counts",
      description:
        "Get unread article counts per feed. Use this when the user asks how many unread articles they have.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "web_search",
      description:
        "Search the web using DuckDuckGo. Returns top search results with titles, URLs, and descriptions. Use this when the user asks about something not covered by their RSS feeds, current events, or general knowledge questions.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query",
          },
          limit: {
            type: "number",
            description: "Max results to return (default 5, max 10)",
          },
          search_news: {
            type: "boolean",
            description: "Search news instead of general web results (default false)",
          },
        },
        required: ["query"],
      },
    },
  },
] as const;

// ─── Tool Implementations ──────────────────────────────────────────────────

export async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "read_article":
      return await toolReadArticle(args.article_id as string);
    case "search_articles":
      return await toolSearchArticles(
        args.query as string,
        (args.limit as number) || 5
      );
    case "list_feeds":
      return await toolListFeeds();
    case "list_recent_articles":
      return await toolListRecentArticles({
        feedId: args.feed_id as string | undefined,
        limit: (args.limit as number) || 10,
        unreadOnly: args.unread_only as boolean | undefined,
      });
    case "get_unread_counts":
      return await toolGetUnreadCounts();
    case "web_search":
      return await toolWebSearch(
        args.query as string,
        (args.limit as number) || 5,
        args.search_news as boolean | undefined
      );
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// ─── Individual Tool Handlers ───────────────────────────────────────────────

async function toolReadArticle(articleId: string): Promise<string> {
  const db = await getDatabase();
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

  // Get feed name
  const feed = await db
    .select({ title: feeds.title })
    .from(feeds)
    .where(eq(feeds.id, row.feedId))
    .get();

  // Strip HTML for the LLM — it doesn't need raw HTML
  const plainContent = (row.content || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 8000); // Cap content at 8k chars to stay in context

  return JSON.stringify({
    id: row.id,
    title: row.title,
    url: row.url,
    author: row.author,
    summary: row.summary,
    content: plainContent,
    publishedAt: row.publishedAt.toISOString(),
    read: row.read,
    bookmarked: row.bookmarked,
    readLater: row.readLater,
    feed: feed?.title || "Unknown",
  });
}

async function toolSearchArticles(query: string, limit: number): Promise<string> {
  const db = await getDatabase();
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

  const rowsWithFeed = [];
  for (const row of rows as any[]) {
    const feed = await db
      .select({ title: feeds.title })
      .from(feeds)
      .where(eq(feeds.id, row.feedId))
      .get();
    rowsWithFeed.push({
      id: row.id,
      title: row.title,
      url: row.url,
      summary: (row.summary || "").substring(0, 200),
      publishedAt: row.publishedAt.toISOString(),
      read: row.read,
      feed: feed?.title || "Unknown",
    });
  }

  return JSON.stringify({ results: rowsWithFeed, count: rowsWithFeed.length });
}

async function toolListFeeds(): Promise<string> {
  const db = await getDatabase();
  const feedRows = await db.select().from(feeds).all();

  // Get unread counts
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

  // Get folder names
  const folderMap = new Map<string, string>();
  for (const f of feedRows as any[]) {
    if (f.folderId) {
      const folder = await db
        .select({ name: folders.name })
        .from(folders)
        .where(eq(folders.id, f.folderId))
        .get();
      folderMap.set(f.id, folder?.name || "");
    }
  }

  const result = feedRows.map((f: any) => ({
    id: f.id,
    title: f.title,
    url: f.url,
    folder: folderMap.get(f.id) || null,
    unreadCount: unreadMap.get(f.id) || 0,
  }));

  return JSON.stringify({ feeds: result, total: result.length });
}

async function toolListRecentArticles(opts: {
  feedId?: string;
  limit: number;
  unreadOnly?: boolean;
}): Promise<string> {
  const db = await getDatabase();
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

  const rowsWithFeed = [];
  for (const row of rows as any[]) {
    const feed = await db
      .select({ title: feeds.title })
      .from(feeds)
      .where(eq(feeds.id, row.feedId))
      .get();
    rowsWithFeed.push({
      id: row.id,
      title: row.title,
      url: row.url,
      summary: (row.summary || "").substring(0, 200),
      publishedAt: row.publishedAt.toISOString(),
      read: row.read,
      bookmarked: row.bookmarked,
      feed: feed?.title || "Unknown",
    });
  }

  return JSON.stringify({ articles: rowsWithFeed, count: rowsWithFeed.length });
}

async function toolGetUnreadCounts(): Promise<string> {
  const db = await getDatabase();
  const rows = await db
    .select({
      feedId: articles.feedId,
      count: sql<number>`count(*)`,
    })
    .from(articles)
    .where(eq(articles.read, false))
    .groupBy(articles.feedId)
    .all();

  // Total
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

// ─── Web Search via DuckDuckGo ──────────────────────────────────────────────

async function toolWebSearch(query: string, limit: number, searchNews?: boolean): Promise<string> {
  const cappedLimit = Math.min(limit, 10);

  try {
    if (searchNews) {
      const results = await ddgSearchNews(query);
      const items = results.results.slice(0, cappedLimit).map((r: any) => ({
        title: r.title,
        url: r.url,
        description: r.excerpt || r.body || "",
        source: r.syndicate || "",
        date: r.relativeTime || "",
      }));
      return JSON.stringify({ results: items, count: items.length, type: "news" });
    }

    const results = await ddgSearch(query);
    const items = results.results.slice(0, cappedLimit).map((r: any) => ({
      title: r.title,
      url: r.url,
      description: r.description || "",
    }));
    return JSON.stringify({ results: items, count: items.length, type: "web" });
  } catch (err: any) {
    return JSON.stringify({ error: `Web search failed: ${err.message}` });
  }
}