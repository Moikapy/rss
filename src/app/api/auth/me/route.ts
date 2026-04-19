import { NextRequest, NextResponse } from "next/server";
import { verifyToken, getTokenFromRequest } from "@/lib/auth/jwt";
import { getDatabase } from "@/lib/db/get-db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// GET /api/auth/me — returns current user or null
export async function GET(request: NextRequest) {
  const token = getTokenFromRequest(request);

  if (!token) {
    return NextResponse.json({ authenticated: false });
  }

  const payload = await verifyToken(token);
  if (!payload) {
    return NextResponse.json({ authenticated: false });
  }

  try {
    const db = await getDatabase();
    const user = await db.select().from(users).where(eq(users.id, payload.sub)).get();
    if (!user) {
      return NextResponse.json({ authenticated: false });
    }
    return NextResponse.json({
      authenticated: true,
      user: {
        id: user.id,
        username: user.username,
      },
    });
  } catch {
    return NextResponse.json({ authenticated: false });
  }
}