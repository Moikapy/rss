import { Hono } from "hono";
import type { Bindings, Variables } from "../types";
import { createDb } from "../db/client";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import { createAuth } from "../lib/auth";
import { hashPassword, verifyPassword } from "../lib/password";
import { verifyNostrEvent } from "../lib/nostr";
import { extractToken, authMiddleware, adminMiddleware } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const authRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ─── Rate limiting ──────────────────────────────────────────────────────
authRoutes.use("/api/auth/login", rateLimit({ maxRequests: 10, windowSeconds: 60, keyPrefix: "rl:login" }));
authRoutes.use("/api/auth/user-login", rateLimit({ maxRequests: 10, windowSeconds: 60, keyPrefix: "rl:ulogin" }));
authRoutes.use("/api/auth/register", rateLimit({ maxRequests: 5, windowSeconds: 60, keyPrefix: "rl:register" }));
authRoutes.use("/api/auth/nostr", rateLimit({ maxRequests: 10, windowSeconds: 60, keyPrefix: "rl:nostr" }));
authRoutes.use("/api/auth/setup", rateLimit({ maxRequests: 3, windowSeconds: 300, keyPrefix: "rl:setup" }));
authRoutes.use("/api/auth/change-password", rateLimit({ maxRequests: 5, windowSeconds: 300, keyPrefix: "rl:chpw" }));

// Auth responses must never be cached — recreate Response to ensure headers persist
authRoutes.use("/api/auth/*", async (c, next) => {
  await next();
  const headers = new Headers(c.res.headers);
  headers.set("Cache-Control", "private, no-store, no-cache, max-age=0, must-revalidate");
  headers.set("Pragma", "no-cache");
  headers.set("Vary", "Authorization, Cookie");
  headers.delete("X-Cache");
  c.res = new Response(c.res.body, {
    status: c.res.status,
    statusText: c.res.statusText,
    headers,
  });
});

// ─── Check setup ──────────────────────────────────────────────────────────
authRoutes.get("/api/auth/check-setup", async (c) => {
  const db = createDb(c.env.DB);
  const user = await db.select({ id: users.id }).from(users).get();
  return c.json({ needsSetup: !user });
});

// ─── Setup (first admin) ─────────────────────────────────────────────────
authRoutes.post("/api/auth/setup", async (c) => {
  const db = createDb(c.env.DB);
  const existingUser = await db.select().from(users).get();
  if (existingUser) return c.json({ error: "Setup already complete" }, 400);

  const { username, password } = await c.req.json();
  if (!username || !password) return c.json({ error: "Username and password required" }, 400);
  if (password.length < 8) return c.json({ error: "Password must be at least 8 characters" }, 400);

  const hashedPassword = await hashPassword(password);
  const id = crypto.randomUUID();
  await db.insert(users).values({ id, username, password: hashedPassword, createdAt: new Date() }).run();

  const auth = createAuth(c.env);
  const token = await auth.signToken(id, "admin");
  return c.json({ success: true, token, role: "admin" });
});

// ─── Admin login ──────────────────────────────────────────────────────────
authRoutes.post("/api/auth/login", async (c) => {
  const db = createDb(c.env.DB);
  const { username, password } = await c.req.json();
  if (!username || !password) return c.json({ error: "Username and password required" }, 400);

  const user = await db.select().from(users).where(eq(users.username, username)).get();
  if (!user) return c.json({ error: "Invalid credentials" }, 401);

  const valid = await verifyPassword(password, user.password);
  if (!valid) return c.json({ error: "Invalid credentials" }, 401);

  const auth = createAuth(c.env);
  const token = await auth.signToken(user.id, "admin");
  return c.json({
    success: true, token, role: "admin",
    user: { id: user.id, username: user.username },
  });
});

// ─── Nostr register/login ─────────────────────────────────────────────────
authRoutes.post("/api/auth/nostr", async (c) => {
  const { pubkey, signedEvent } = await c.req.json();
  if (!pubkey) return c.json({ error: "pubkey required" }, 400);
  if (!signedEvent) return c.json({ error: "signedEvent required" }, 400);

  // Verify NIP-07 signed event (Schnorr signature on secp256k1)
  const verification = await verifyNostrEvent(
    signedEvent,
    pubkey,
    "rss.moikapy.dev",
  );
  if (!verification.valid) {
    return c.json({ error: verification.error || "Invalid Nostr signature" }, 401);
  }

  // Store pubkey in KV as a user account (no D1)
  const userId = `nostr:${pubkey}`;
  const existing = await c.env.CACHE.get(`user:${userId}`, "json");

  const auth = createAuth(c.env);
  const token = await auth.signToken(userId, "user", "nostr");

  if (!existing) {
    // First time — register
    await c.env.CACHE.put(`user:${userId}`, JSON.stringify({
      pubkey,
      method: "nostr",
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString(),
    }));
    return c.json({
      success: true, token, role: "user", method: "nostr",
      pubkey, isNew: true,
    });
  }

  // Returning user — update last login
  const userData = typeof existing === "string" ? JSON.parse(existing) : existing;
  await c.env.CACHE.put(`user:${userId}`, JSON.stringify({
    ...userData,
    lastLogin: new Date().toISOString(),
  }));

  return c.json({
    success: true, token, role: "user", method: "nostr",
    pubkey, isNew: false,
  });
});

// ─── Password user register ───────────────────────────────────────────────
authRoutes.post("/api/auth/register", async (c) => {
  const { username, password } = await c.req.json();
  if (!username || !password) return c.json({ error: "Username and password required" }, 400);
  if (password.length < 8) return c.json({ error: "Password must be at least 8 characters" }, 400);

  const userId = `pwd:${username}`;
  const existing = await c.env.CACHE.get(`user:${userId}`, "json");
  if (existing) return c.json({ error: "Username already taken" }, 409);

  const hashedPassword = await hashPassword(password);
  await c.env.CACHE.put(`user:${userId}`, JSON.stringify({
    userId,
    username,
    method: "password",
    password: hashedPassword,
    createdAt: new Date().toISOString(),
  }));

  const auth = createAuth(c.env);
  const token = await auth.signToken(userId, "user", "password");
  return c.json({ success: true, token, role: "user", method: "password", username });
});

// ─── Password user login ──────────────────────────────────────────────────
authRoutes.post("/api/auth/user-login", async (c) => {
  const { username, password } = await c.req.json();
  if (!username || !password) return c.json({ error: "Username and password required" }, 400);

  const userId = `pwd:${username}`;
  const raw = await c.env.CACHE.get(`user:${userId}`, "json");
  if (!raw) return c.json({ error: "Invalid credentials" }, 401);

  const userData = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (userData.method !== "password" || !userData.password) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  const valid = await verifyPassword(password, userData.password);
  if (!valid) return c.json({ error: "Invalid credentials" }, 401);

  // Update last login
  await c.env.CACHE.put(`user:${userId}`, JSON.stringify({
    ...userData,
    lastLogin: new Date().toISOString(),
  }));

  const auth = createAuth(c.env);
  const token = await auth.signToken(userId, "user", "password");
  return c.json({ success: true, token, role: "user", method: "password", username });
});

// ─── Auth status ──────────────────────────────────────────────────────────
// Uses authMiddleware but catches 401 to return {authenticated: false} instead
authRoutes.use("/api/auth/session", async (c, next) => {
  const token = extractToken(c);
  if (!token) {
    return c.json({ authenticated: false }, 200, { "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate", "Vary": "Authorization, Cookie" });
  }
  const auth = createAuth(c.env);
  const payload = await auth.verifyToken(token);
  if (!payload) {
    return c.json({ authenticated: false }, 200, { "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate", "Vary": "Authorization, Cookie" });
  }
  c.set("userId", payload.sub);
  c.set("role", payload.role);
  c.set("method", payload.method);
  await next();
});

authRoutes.get("/api/auth/session", async (c) => {
  const userId = c.get("userId") as string;
  const role = c.get("role") as string || "user";
  const method = c.get("method") as string || "unknown";

  let username: string | null = null;
  let pubkey: string | null = null;

  if (role === "admin") {
    const db = createDb(c.env.DB);
    const user = await db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) return c.json({ authenticated: false });
    username = user.username;
  } else if (userId.startsWith("nostr:")) {
    pubkey = userId.replace("nostr:", "");
  } else if (userId.startsWith("pwd:")) {
    username = userId.replace("pwd:", "");
  }

  return c.json({ authenticated: true, role, method, pubkey, username });
});
authRoutes.use("/api/auth/change-password", authMiddleware);
authRoutes.use("/api/auth/change-password", adminMiddleware);

authRoutes.post("/api/auth/change-password", async (c) => {
  const userId = c.get("userId") as string;
  const { currentPassword, newPassword } = await c.req.json();

  if (!currentPassword || !newPassword) {
    return c.json({ error: "currentPassword and newPassword required" }, 400);
  }

  if (newPassword.length < 8) {
    return c.json({ error: "New password must be at least 8 characters" }, 400);
  }

  const db = createDb(c.env.DB);
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  // Verify current password
  const valid = await verifyPassword(currentPassword, user.password);
  if (!valid) {
    return c.json({ error: "Current password is incorrect" }, 401);
  }

  // Hash and save new password
  const hashedPassword = await hashPassword(newPassword);
  await db.update(users).set({ password: hashedPassword }).where(eq(users.id, userId)).run();

  return c.json({ success: true });
});

// ─── Logout ──────────────────────────────────────────────────────────────
authRoutes.post("/api/auth/logout", async (c) => {
  return c.json({ success: true });
});