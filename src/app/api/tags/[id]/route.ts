import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { tags } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

// DELETE /api/tags/[id]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  db.delete(tags).where(eq(tags.id, id)).run();
  return NextResponse.json({ success: true });
}