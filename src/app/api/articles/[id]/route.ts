import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { articles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

// GET /api/articles/[id] — get single article with full content
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const article = db.select().from(articles).where(eq(articles.id, id)).get();

  if (!article) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  return NextResponse.json(article);
}

// PATCH /api/articles/[id] — update article triage state
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json()) as Record<string, any>;
  const db = getDb();

  const updates: Record<string, any> = {};
  if (body.read !== undefined) updates.read = body.read;
  if (body.bookmarked !== undefined) updates.bookmarked = body.bookmarked;
  if (body.readLater !== undefined) updates.readLater = body.readLater;

  db.update(articles).set(updates).where(eq(articles.id, id)).run();
  return NextResponse.json({ success: true });
}