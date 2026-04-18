import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { folders } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";

export const runtime = "nodejs";

// GET /api/folders
export async function GET() {
  const db = getDb();
  const allFolders = db.select().from(folders).orderBy(asc(folders.order)).all();
  return NextResponse.json(allFolders);
}

// POST /api/folders
export async function POST(request: NextRequest) {
  const body = (await request.json()) as Record<string, any>;
  const { name, order } = body;

  if (!name) {
    return NextResponse.json({ error: "Folder name is required" }, { status: 400 });
  }

  const db = getDb();
  const id = crypto.randomUUID();

  db.insert(folders).values({
    id,
    name,
    order: order ?? 0,
    createdAt: new Date(),
  }).run();

  return NextResponse.json({ id, success: true }, { status: 201 });
}