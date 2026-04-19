import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/db/get-db";
import { tags } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// DELETE /api/tags/[id]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = await getDatabase();
  await db.delete(tags).where(eq(tags.id, id)).run();
  return NextResponse.json({ success: true });
}