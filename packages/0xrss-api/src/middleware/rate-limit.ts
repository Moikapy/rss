import { createMiddleware } from "hono/factory";
import type { Bindings, Variables } from "../types";

interface RateLimitOptions {
  maxRequests: number; // max requests in window
  windowSeconds: number; // time window in seconds
  keyPrefix?: string; // KV key prefix
}

/**
 * Rate limiting middleware using Cloudflare KV.
 * Uses client IP (from x-forwarded-for or x-real-ip) as the rate limit key.
 * Sliding window: tracks count + first-request timestamp in KV.
 */
export function rateLimit(options: RateLimitOptions) {
  const { maxRequests, windowSeconds, keyPrefix = "rl" } = options;

  return createMiddleware<{ Bindings: Bindings; Variables: Variables }>(async (c, next) => {
    // Get client IP (Cloudflare provides x-forwarded-for and cf-connecting-ip)
    const ip =
      c.req.raw.headers.get("cf-connecting-ip") ||
      c.req.raw.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      c.req.raw.headers.get("x-real-ip") ||
      "unknown";

    const kvKey = `${keyPrefix}:${ip}`;
    const now = Math.floor(Date.now() / 1000);

    const raw = await c.env.CACHE.get(kvKey, "json");
    const record = typeof raw === "string" ? JSON.parse(raw) : raw;

    let count: number;
    let windowStart: number;

    if (!record || (now - record.windowStart) > windowSeconds) {
      // New window
      count = 1;
      windowStart = now;
    } else {
      // Existing window
      count = record.count + 1;
      windowStart = record.windowStart;
    }

    if (count > maxRequests) {
      c.header("Retry-After", String(windowSeconds - (now - windowStart)));
      return c.json({ error: "Too many requests. Please try again later." }, 429);
    }

    // Store with TTL slightly longer than window to auto-clean
    await c.env.CACHE.put(kvKey, JSON.stringify({ count, windowStart }), {
      expirationTtl: Math.max(windowSeconds * 2, 60),
    });

    // Add rate limit headers
    c.header("X-RateLimit-Limit", String(maxRequests));
    c.header("X-RateLimit-Remaining", String(maxRequests - count));
    c.header("X-RateLimit-Reset", String(windowStart + windowSeconds));

    await next();
  });
}