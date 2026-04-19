import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/db/get-db";
import { feeds } from "@/lib/db/schema";
import { feedTags } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

// GET /api/feeds — list all feeds
export async function GET() {
  const db = await getDatabase();
  const allFeeds = await db.select().from(feeds).orderBy(desc(feeds.createdAt)).all();
  return NextResponse.json(allFeeds);
}

// POST /api/feeds — add a new feed
export async function POST(request: NextRequest) {
  const body = (await request.json()) as Record<string, any>;
  const { title, url, siteUrl, description, folderId, tagIds } = body;

  if (!url) {
    return NextResponse.json({ error: "Feed URL is required" }, { status: 400 });
  }

  const db = await getDatabase();
  const id = crypto.randomUUID();
  const now = new Date();

  try {
    await db.insert(feeds).values({
      id,
      title: title || url,
      url,
      siteUrl: siteUrl || null,
      description: description || null,
      folderId: folderId || null,
      refreshInterval: 30,
      autoRefresh: true,
      lastFetched: null,
      createdAt: now,
      updatedAt: now,
    }).run();

    // Assign tags if provided
    if (tagIds && Array.isArray(tagIds)) {
      for (const tagId of tagIds) {
        await db.insert(feedTags).values({ feedId: id, tagId }).run();
      }
    }

    return NextResponse.json({ id, success: true }, { status: 201 });
  } catch (err: any) {
    if (err.message?.includes("UNIQUE")) {
      return NextResponse.json({ error: "Feed URL already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to create feed" }, { status: 500 });
  }
}