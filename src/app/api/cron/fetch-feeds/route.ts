import { NextRequest, NextResponse } from "next/server";
import { fetchAllFeeds } from "@/lib/feeds/fetcher";

// POST /api/cron/fetch-feeds
export async function POST() {
  const results = await fetchAllFeeds();

  const totalNew = results.reduce((sum, r) => sum + r.newArticles, 0);
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

  return NextResponse.json({
    feedsProcessed: results.length,
    totalNewArticles: totalNew,
    totalErrors,
    results,
  });
}