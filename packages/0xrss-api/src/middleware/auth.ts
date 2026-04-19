import { createMiddleware } from "hono/factory";
import type { Bindings, Variables } from "../types";
import { createAuth } from "../lib/auth";

/** Extract token from Authorization header or cookie */
export function extractToken(c: { req: { raw: Request } }): string | null {
  const authHeader = c.req.raw.headers.get("Authorization") || "";
  if (authHeader.startsWith("Bearer ")) return authHeader.slice(7);

  const cookie = c.req.raw.headers.get("cookie") || "";
  const match = cookie.split(";").find((s) => s.trim().startsWith("0xrss-token="));
  if (match) {
    const val = match.trim().split("=").slice(1).join("=");
    // Remove any trailing cookie attributes
    const parts = val.split(";");
    return parts[0] || null;
  }

  return null;
}

/**
 * Auth middleware — sets userId, role, method on the context.
 * Routes choose their own auth level:
 * - Public routes: skip this middleware entirely
 * - User routes: require any valid JWT
 * - Admin routes: require JWT with role="admin"
 */
export const authMiddleware = createMiddleware<{ Bindings: Bindings; Variables: Variables }>(
  async (c, next) => {
    const token = extractToken(c);
    if (!token) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const auth = createAuth(c.env);
    const payload = await auth.verifyToken(token);
    if (!payload) {
      return c.json({ error: "Invalid token" }, 401);
    }

    c.set("userId", payload.sub);
    c.set("role", payload.role);
    c.set("method", payload.method);
    return next();
  }
);

/**
 * Admin-only middleware — must be used AFTER authMiddleware
 */
export const adminMiddleware = createMiddleware<{ Bindings: Bindings; Variables: Variables }>(
  async (c, next) => {
    const role = c.get("role");
    if (role !== "admin") {
      return c.json({ error: "Forbidden" }, 403);
    }
    return next();
  }
);