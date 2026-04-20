import { describe, it, expect, beforeAll } from "vitest";
import { createAuth } from "../lib/auth";

// ─── createAuth / JWT ───────────────────────────────────────────────────────

describe("createAuth", () => {
  const auth = createAuth({ JWT_SECRET: "test-secret-key-for-unit-tests-min-32-chars" });

  it("signs and verifies a valid admin token", async () => {
    const token = await auth.signToken("user-123", "admin", "password");
    const payload = await auth.verifyToken(token);

    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe("user-123");
    expect(payload!.role).toBe("admin");
    expect(payload!.method).toBe("password");
  });

  it("signs and verifies a valid user token", async () => {
    const token = await auth.signToken("user-456", "user", "nostr");
    const payload = await auth.verifyToken(token);

    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe("user-456");
    expect(payload!.role).toBe("user");
    expect(payload!.method).toBe("nostr");
  });

  it("defaults role to 'user' and method to 'unknown'", async () => {
    const token = await auth.signToken("user-789");
    const payload = await auth.verifyToken(token);

    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe("user-789");
    expect(payload!.role).toBe("user");
    expect(payload!.method).toBe("unknown");
  });

  it("rejects expired tokens", async () => {
    // Create a token with a different auth instance that expires immediately
    // We'll manually construct an expired JWT
    const { SignJWT } = await import("jose");
    const secret = new TextEncoder().encode("test-secret-key-for-unit-tests-min-32-chars");

    const expiredToken = await new SignJWT({ sub: "user-exp", role: "user", method: "password" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt() // now
      .setExpirationTime("0s") // expires immediately
      .sign(secret);

    // Wait a tick for the token to actually be expired
    await new Promise((r) => setTimeout(r, 1000));

    const payload = await auth.verifyToken(expiredToken);
    expect(payload).toBeNull();
  });

  it("rejects malformed tokens", async () => {
    const payload = await auth.verifyToken("not-a-valid-jwt");
    expect(payload).toBeNull();
  });

  it("rejects empty tokens", async () => {
    const payload = await auth.verifyToken("");
    expect(payload).toBeNull();
  });

  it("rejects tokens signed with wrong secret", async () => {
    const wrongAuth = createAuth({ JWT_SECRET: "wrong-secret-key-for-unit-tests-32ch" });
    const token = await wrongAuth.signToken("user-123", "admin");
    const payload = await auth.verifyToken(token); // different secret
    expect(payload).toBeNull();
  });
});

// ─── extractToken ───────────────────────────────────────────────────────────

describe("extractToken", () => {
  // Import the middleware module
  let extractToken: (c: { req: { raw: Request } }) => string | null;

  beforeAll(async () => {
    const mod = await import("../middleware/auth");
    extractToken = mod.extractToken;
  });

  it("extracts token from Authorization header", () => {
    const req = new Request("https://example.com", {
      headers: { Authorization: "Bearer my-token-123" },
    });
    expect(extractToken({ req: { raw: req } })).toBe("my-token-123");
  });

  it("extracts token from cookie", () => {
    const req = new Request("https://example.com", {
      headers: { cookie: "0xrss-token=cookie-token-456" },
    });
    expect(extractToken({ req: { raw: req } })).toBe("cookie-token-456");
  });

  it("extracts token from cookie with other cookies", () => {
    const req = new Request("https://example.com", {
      headers: { cookie: "other=value; 0xrss-token=my-token; third=val" },
    });
    expect(extractToken({ req: { raw: req } })).toBe("my-token");
  });

  it("prefers Authorization header over cookie", () => {
    const req = new Request("https://example.com", {
      headers: {
        Authorization: "Bearer header-token",
        cookie: "0xrss-token=cookie-token",
      },
    });
    expect(extractToken({ req: { raw: req } })).toBe("header-token");
  });

  it("returns null when no auth present", () => {
    const req = new Request("https://example.com");
    expect(extractToken({ req: { raw: req } })).toBeNull();
  });

  it("returns null for malformed Authorization header", () => {
    const req = new Request("https://example.com", {
      headers: { Authorization: "Basic abc123" },
    });
    expect(extractToken({ req: { raw: req } })).toBeNull();
  });
});