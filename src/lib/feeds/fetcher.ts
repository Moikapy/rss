import { getDatabase } from "@/lib/db/get-db";
import { feeds, articles as articlesTable } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { fetchAndParseFeed, ParsedArticle } from "./parser";
import { extractContent } from "./extractor";

export interface FetchResult {
  feedId: string;
  feedTitle: string;
  newArticles: number;
  errors: string[];
}

/**
 * Fetch a single feed and store new articles.
 */
export async function fetchFeed(feedId: string): Promise<FetchResult> {
  const db = await getDatabase();
  const feed = await db.select().from(feeds).where(eq(feeds.id, feedId)).get();

  if (!feed) {
    return { feedId, feedTitle: "Unknown", newArticles: 0, errors: ["Feed not found"] };
  }

  const result: FetchResult = {
    feedId,
    feedTitle: feed.title,
    newArticles: 0,
    errors: [],
  };

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

    for (const item of parsed.items) {
      try {
        // Check for duplicate — scoped to (feedId, url) to allow same URL across different feeds
        const existing = await db.select({ id: articlesTable.id })
          .from(articlesTable)
          .where(and(eq(articlesTable.feedId, feedId), eq(articlesTable.url, item.url)))
          .get();

        if (existing) continue;

        // Use content from feed first, then try full extraction, then summary fallback
        let content = item.content;
        let author = item.author;

        if (!content && item.url) {
          const extracted = await extractContent(item.url);
          if (extracted.content) {
            content = extracted.content;
          }
          if (extracted.byline && !author) {
            author = extracted.byline;
          }
        }

        // If still no content, use summary as fallback content
        if (!content && item.summary) {
          content = item.summary.includes("<") ? item.summary : `<p>${item.summary}</p>`;
        }

        // Insert article
        await db.insert(articlesTable).values({
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
        result.errors.push(`Article "${item.title}": ${err.message}`);
      }
    }
  } catch (err: any) {
    result.errors.push(`Feed fetch: ${err.message}`);
  }

  return result;
}

/**
 * Fetch all feeds that have autoRefresh enabled and are due for a refresh.
 */
export async function fetchAllFeeds(): Promise<FetchResult[]> {
  const db = await getDatabase();
  const allFeeds = await db.select().from(feeds).all();
  const results: FetchResult[] = [];

  for (const feed of allFeeds) {
    if (!feed.autoRefresh) continue;

    // Check if feed is due for refresh
    if (feed.lastFetched) {
      const elapsed = Date.now() - feed.lastFetched.getTime();
      const intervalMs = feed.refreshInterval * 60 * 1000;
      if (elapsed < intervalMs) continue;
    }

    const result = await fetchFeed(feed.id);
    results.push(result);
  }

  return results;
}