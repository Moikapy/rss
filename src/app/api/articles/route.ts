import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { articles, feeds } from "@/lib/db/schema";
import { eq, desc, and, sql } from "drizzle-orm";

export const runtime = "nodejs";

// GET /api/articles — list articles with filters
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const feedId = searchParams.get("feedId");
  const filter = searchParams.get("filter"); // unread, bookmarked, read-later
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = parseInt(searchParams.get("offset") || "0");

  const db = getDb();

  const conditions = [];

  if (feedId) {
    conditions.push(eq(articles.feedId, feedId));
  }

  if (filter === "unread") {
    conditions.push(eq(articles.read, false));
  } else if (filter === "bookmarked") {
    conditions.push(eq(articles.bookmarked, true));
  } else if (filter === "read-later") {
    conditions.push(eq(articles.readLater, true));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const result = db.select({
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
    .where(where)
    .orderBy(desc(articles.publishedAt))
    .limit(limit)
    .offset(offset)
    .all();

  return NextResponse.json(result);
}