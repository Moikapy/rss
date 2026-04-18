import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "0xrss-token";
const PUBLIC_PATHS = ["/login", "/setup", "/api/auth/login", "/api/auth/setup", "/api/auth/check-setup", "/api/auth/me"];

// API routes that are public (read-only) even without auth
const PUBLIC_API_READ = [
  "/api/feeds",      // GET feeds list
  "/api/articles",   // GET articles list
  "/api/search",      // GET search
  "/api/folders",     // GET folders list
  "/api/tags",        // GET tags list
  "/api/stats/",      // GET stats
  "/api/cron/",       // cron fetch
  "/api/chat/health", // Ollama health check (read-only)
];

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Allow static assets and Next.js internals
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;

  // API routes: public GETs for read, auth required for mutations
  if (pathname.startsWith("/api/")) {
    // Allow GET on public read routes without auth
    if (request.method === "GET" && PUBLIC_API_READ.some((p) => pathname.startsWith(p))) {
      return NextResponse.next();
    }

    // All other API routes require auth
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.next();
  }

  // Dashboard pages are public (read-only view) — auth state handled client-side
  return NextResponse.next();
}