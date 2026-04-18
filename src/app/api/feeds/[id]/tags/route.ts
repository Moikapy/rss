import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { feeds, feedTags } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export const runtime = "nodejs";

// GET /api/feeds/[id]/tags — get tags for a feed
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const tags = db.select({ tagId: feedTags.tagId })
    .from(feedTags)
    .where(eq(feedTags.feedId, id))
    .all();
  return NextResponse.json(tags);
}

// POST /api/feeds/[id]/tags — add tag to feed
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json()) as Record<string, any>;
  const { tagId } = body;

  if (!tagId) {
    return NextResponse.json({ error: "Tag ID required" }, { status: 400 });
  }

  const db = getDb();
  try {
    db.insert(feedTags).values({ feedId: id, tagId }).run();
    return NextResponse.json({ success: true }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Tag already assigned or not found" }, { status: 409 });
  }
}

// DELETE /api/feeds/[id]/tags — remove tag from feed
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json()) as Record<string, any>;
  const { tagId } = body;

  if (!tagId) {
    return NextResponse.json({ error: "Tag ID required" }, { status: 400 });
  }

  const db = getDb();
  db.delete(feedTags)
    .where(and(eq(feedTags.feedId, id), eq(feedTags.tagId, tagId)))
    .run();
  return NextResponse.json({ success: true });
}