import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/db/get-db";
import { articles } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

// GET /api/stats/unread-counts — unread counts per feed
export async function GET() {
  const db = await getDatabase();

  const counts = await db.select({
    feedId: articles.feedId,
    unread: sql<number>`count(*)`.as("unread"),
  })
    .from(articles)
    .where(eq(articles.read, false))
    .groupBy(articles.feedId)
    .all();

  // Convert to a map
  const map: Record<string, number> = {};
  for (const row of counts) {
    map[row.feedId] = row.unread;
  }

  return NextResponse.json(map);
}