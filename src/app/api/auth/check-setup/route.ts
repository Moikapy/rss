import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";

export const runtime = "nodejs";

export async function GET() {
  const db = getDb();
  const user = db.select({ id: users.id }).from(users).get();

  return NextResponse.json({ needsSetup: !user });
}