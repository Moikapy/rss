import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { feeds, feedTags } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export const runtime = "nodejs";

// GET /api/feeds/[id] — get a single feed
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const feed = db.select().from(feeds).where(eq(feeds.id, id)).get();
  if (!feed) {
    return NextResponse.json({ error: "Feed not found" }, { status: 404 });
  }
  return NextResponse.json(feed);
}

// PATCH /api/feeds/[id] — update a feed
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json()) as Record<string, any>;
  const db = getDb();

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (body.title !== undefined) updates.title = body.title;
  if (body.siteUrl !== undefined) updates.siteUrl = body.siteUrl;
  if (body.description !== undefined) updates.description = body.description;
  if (body.folderId !== undefined) updates.folderId = body.folderId;
  if (body.refreshInterval !== undefined) updates.refreshInterval = body.refreshInterval;
  if (body.autoRefresh !== undefined) updates.autoRefresh = body.autoRefresh;

  db.update(feeds).set(updates).where(eq(feeds.id, id)).run();

  // Update tags if provided
  if (body.tagIds && Array.isArray(body.tagIds)) {
    db.delete(feedTags).where(eq(feedTags.feedId, id)).run();
    for (const tagId of body.tagIds) {
      db.insert(feedTags).values({ feedId: id, tagId }).run();
    }
  }

  const updated = db.select().from(feeds).where(eq(feeds.id, id)).get();
  return NextResponse.json(updated);
}

// DELETE /api/feeds/[id] — delete a feed
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  db.delete(feeds).where(eq(feeds.id, id)).run();
  return NextResponse.json({ success: true });
}