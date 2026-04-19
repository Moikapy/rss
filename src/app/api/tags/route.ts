import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/db/get-db";
import { tags } from "@/lib/db/schema";

// GET /api/tags
export async function GET() {
  const db = await getDatabase();
  const allTags = await db.select().from(tags).all();
  return NextResponse.json(allTags);
}

// POST /api/tags
export async function POST(request: NextRequest) {
  const body = (await request.json()) as Record<string, any>;
  const { name } = body;

  if (!name) {
    return NextResponse.json({ error: "Tag name is required" }, { status: 400 });
  }

  const db = await getDatabase();
  const id = crypto.randomUUID();

  try {
    await db.insert(tags).values({ id, name }).run();
    return NextResponse.json({ id, success: true }, { status: 201 });
  } catch (err: any) {
    if (err.message?.includes("UNIQUE")) {
      return NextResponse.json({ error: "Tag already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to create tag" }, { status: 500 });
  }
}