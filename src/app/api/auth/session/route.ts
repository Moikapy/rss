import { NextRequest, NextResponse } from "next/server";
import { verifyToken, getTokenFromRequest } from "@/lib/auth/jwt";
import { getDatabase } from "@/lib/db/get-db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const NO_CACHE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
  "Pragma": "no-cache",
  "Vary": "Authorization, Cookie",
};

// GET /api/auth/session — returns current user or null
export async function GET(request: NextRequest) {
  const token = getTokenFromRequest(request);

  if (!token) {
    return NextResponse.json({ authenticated: false }, { headers: NO_CACHE_HEADERS });
  }

  const payload = await verifyToken(token);
  if (!payload) {
    return NextResponse.json({ authenticated: false }, { headers: NO_CACHE_HEADERS });
  }

  try {
    const db = await getDatabase();
    const user = await db.select().from(users).where(eq(users.id, payload.sub)).get();
    if (!user) {
      return NextResponse.json({ authenticated: false }, { headers: NO_CACHE_HEADERS });
    }
    return NextResponse.json({
      authenticated: true,
      role: "admin",
      username: user.username,
    }, { headers: NO_CACHE_HEADERS });
  } catch {
    return NextResponse.json({ authenticated: false }, { headers: NO_CACHE_HEADERS });
  }
}