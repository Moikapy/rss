import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { articles, feeds } from "@/lib/db/schema";
import { sql, eq, desc, or, like } from "drizzle-orm";

export const runtime = "nodejs";

// GET /api/search?q=query
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q");

  if (!q || q.trim().length === 0) {
    return NextResponse.json({ results: [] });
  }

  const db = getDb();

  // Try FTS5 first (local SQLite)
  try {
    const ftsResults = db.all(sql`
      SELECT a.id, a.feed_id, a.title, a.url, a.author, a.summary, a.published_at, a.read, a.bookmarked, a.read_later, f.title as feed_title
      FROM articles a
      LEFT JOIN feeds f ON a.feed_id = f.id
      JOIN articles_fts fts ON a.rowid = fts.rowid
      WHERE articles_fts MATCH ${q.trim()}
      ORDER BY rank
      LIMIT 50
    `);

    if (ftsResults.length > 0) {
      return NextResponse.json({ results: ftsResults });
    }
  } catch {
    // FTS5 not available (D1), fall through to LIKE
  }

  // Fallback: LIKE queries on title and summary (D1 compatible)
  const searchTerm = `%${q.trim().toLowerCase()}%`;

  const likeResults = db.select({
    id: articles.id,
    feedId: articles.feedId,
    title: articles.title,
    url: articles.url,
    author: articles.author,
    summary: articles.summary,
    publishedAt: articles.publishedAt,
    read: articles.read,
    bookmarked: articles.bookmarked,
    readLater: articles.readLater,
    feedTitle: feeds.title,
  })
    .from(articles)
    .leftJoin(feeds, eq(articles.feedId, feeds.id))
    .where(
      or(
        like(sql`LOWER(${articles.title})`, searchTerm),
        like(sql`LOWER(${articles.summary})`, searchTerm)
      )
    )
    .orderBy(desc(articles.publishedAt))
    .limit(50)
    .all();

  return NextResponse.json({ results: likeResults });
}