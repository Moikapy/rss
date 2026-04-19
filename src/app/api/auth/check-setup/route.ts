import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/db/get-db";
import { users } from "@/lib/db/schema";

export async function GET() {
  const db = await getDatabase();
  const user = await db.select({ id: users.id }).from(users).get();

  return NextResponse.json({ needsSetup: !user });
}