import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { verifyPassword, signToken, setTokenCookie } from "@/lib/auth";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as Record<string, any>;
  const { username, password } = body;

  if (!username || !password) {
    return NextResponse.json({ error: "Username and password required" }, { status: 400 });
  }

  const db = getDb();
  const user = db.select().from(users).where(eq(users.username, username)).get();

  if (!user) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const valid = await verifyPassword(password, user.password);
  if (!valid) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = await signToken(user.id);
  const response = NextResponse.json({ success: true });
  return setTokenCookie(response, token);
}