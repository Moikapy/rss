import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { folders } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

// PATCH /api/folders/[id]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json()) as Record<string, any>;
  const db = getDb();

  const updates: Record<string, any> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.order !== undefined) updates.order = body.order;

  db.update(folders).set(updates).where(eq(folders.id, id)).run();
  return NextResponse.json({ success: true });
}

// DELETE /api/folders/[id]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  db.delete(folders).where(eq(folders.id, id)).run();
  return NextResponse.json({ success: true });
}