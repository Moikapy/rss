import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { articles } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export const runtime = "nodejs";

// GET /api/stats/unread-counts — unread counts per feed
export async function GET() {
  const db = getDb();

  const counts = db.select({
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