import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { hashPassword, signToken, setTokenCookie } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const db = getDb();

  // Check if any user already exists
  const existingUser = db.select().from(users).get();
  if (existingUser) {
    return NextResponse.json({ error: "Setup already complete" }, { status: 400 });
  }

  const body = (await request.json()) as Record<string, any>;
  const { username, password } = body;

  if (!username || !password) {
    return NextResponse.json({ error: "Username and password required" }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const hashedPassword = await hashPassword(password);
  const id = crypto.randomUUID();

  db.insert(users).values({
    id,
    username,
    password: hashedPassword,
    createdAt: new Date(),
  }).run();

  const token = await signToken(id);
  const response = NextResponse.json({ success: true });
  return setTokenCookie(response, token);
}