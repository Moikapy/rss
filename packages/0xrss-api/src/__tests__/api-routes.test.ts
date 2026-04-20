import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type { Bindings, Variables } from "../types";
import { authMiddleware, adminMiddleware, extractToken } from "../middleware/auth";
import { createAuth } from "../lib/auth";

// ─── Hono App Setup for Testing Auth Middleware ────────────────────────────

function createTestApp() {
  const JWT_SECRET = "test-secret-key-for-unit-tests-min-32-chars";
  const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
  const auth = createAuth({ JWT_SECRET });

  // Inject JWT_SECRET into env for auth middleware
  app.use("/api/*", async (c, next) => {
    c.env = { ...c.env, JWT_SECRET } as any;
    await next();
  });

  app.use("/api/user/*", authMiddleware);
  app.use("/api/admin/*", authMiddleware, adminMiddleware);

  app.get("/api/user/me", (c) =>
    c.json({ userId: c.get("userId"), role: c.get("role") })
  );

  app.get("/api/admin/dashboard", (c) =>
    c.json({ userId: c.get("userId"), role: c.get("role") })
  );

  app.get("/api/public/status", (c) => c.json({ ok: true }));

  return { app, auth };
}

// ─── Auth Middleware Integration ──────────────────────────────────────────

describe("authMiddleware (integration)", () => {
  const { app, auth } = createTestApp();

  it("allows access with valid admin token on user routes", async () => {
    const token = await auth.signToken("admin-1", "admin", "password");
    const res = await app.request("/api/user/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe("admin-1");
    expect(body.role).toBe("admin");
  });

  it("allows access with valid user token on user routes", async () => {
    const token = await auth.signToken("user-1", "user", "nostr");
    const res = await app.request("/api/user/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe("user-1");
    expect(body.role).toBe("user");
  });

  it("rejects requests without token (401)", async () => {
    const res = await app.request("/api/user/me");
    expect(res.status).toBe(401);
  });

  it("rejects requests with invalid token (401)", async () => {
    const res = await app.request("/api/user/me", {
      headers: { Authorization: "Bearer invalid-token" },
    });
    expect(res.status).toBe(401);
  });
});

describe("adminMiddleware (integration)", () => {
  const { app, auth } = createTestApp();

  it("allows admin token on admin routes", async () => {
    const token = await auth.signToken("admin-1", "admin", "password");
    const res = await app.request("/api/admin/dashboard", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it("rejects user token on admin routes (403)", async () => {
    const token = await auth.signToken("user-1", "user", "nostr");
    const res = await app.request("/api/admin/dashboard", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  it("rejects no token on admin routes (401)", async () => {
    const res = await app.request("/api/admin/dashboard");
    expect(res.status).toBe(401);
  });
});

describe("public routes (no auth)", () => {
  const { app } = createTestApp();

  it("allows unauthenticated access to public routes", async () => {
    const res = await app.request("/api/public/status");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

describe("cookie-based auth", () => {
  const { app, auth } = createTestApp();

  it("accepts valid token via cookie", async () => {
    const token = await auth.signToken("user-cookie", "user", "password");
    const res = await app.request("/api/user/me", {
      headers: { cookie: `0xrss-token=${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe("user-cookie");
  });

  it("rejects invalid cookie token", async () => {
    const res = await app.request("/api/user/me", {
      headers: { cookie: "0xrss-token=invalid-jwt-token" },
    });
    expect(res.status).toBe(401);
  });
});